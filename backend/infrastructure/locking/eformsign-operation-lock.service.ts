import { createHash, randomUUID } from "crypto";

import { Inject, Injectable, Logger } from "@nestjs/common";

import { sanitizeEformsignErrorMessage } from "domain/utils/eformsign-error-message";
import {
    EFORMSIGN_BACKFILL_REDIS_CLIENT,
    EformsignBackfillRedisClient,
} from "./eformsign-backfill-lock.service";

const OPERATION_LOCK_PREFIX = "babyjamjam:eformsign:operation";
const OPERATION_LOCK_LEASE_MS = 4 * 60 * 1000;
const OPERATION_LOCK_RENEW_INTERVAL_MS = 60 * 1000;

const RENEW_LOCK_SCRIPT = `
    if redis.call("GET", KEYS[1]) == ARGV[1] then
        return redis.call("PEXPIRE", KEYS[1], ARGV[2])
    end
    return 0
`;

const RELEASE_LOCK_SCRIPT = `
    if redis.call("GET", KEYS[1]) == ARGV[1] then
        return redis.call("DEL", KEYS[1])
    end
    return 0
`;

export interface EformsignOperationLease {
    isHeld(): boolean;
}

export class EformsignOperationAlreadyRunningError extends Error {
    constructor() {
        super("The same eformsign operation is already running");
        this.name = EformsignOperationAlreadyRunningError.name;
    }
}

export class EformsignOperationLockUnavailableError extends Error {
    constructor(message: string) {
        super(message);
        this.name = EformsignOperationLockUnavailableError.name;
    }
}

@Injectable()
export class EformsignOperationLockService {
    private readonly logger = new Logger(EformsignOperationLockService.name);
    private readonly localLocks = new Set<string>();

    constructor(
        @Inject(EFORMSIGN_BACKFILL_REDIS_CLIENT)
        private readonly redis: EformsignBackfillRedisClient | null,
    ) {}

    async runExclusive<TResult>(
        operationKey: string,
        work: (lease: EformsignOperationLease) => Promise<TResult>,
    ): Promise<TResult> {
        const lockKey = this.lockKey(operationKey);
        if (!this.redis) {
            return this.runLocally(lockKey, work);
        }

        const redis = this.redis;
        await this.ensureConnected(redis);
        const token = randomUUID();
        const acquiredAt = Date.now();
        let acquired: "OK" | null;
        try {
            acquired = await redis.set(
                lockKey,
                token,
                "PX",
                OPERATION_LOCK_LEASE_MS,
                "NX",
            );
        } catch (error) {
            throw new EformsignOperationLockUnavailableError(
                "Unable to acquire the eformsign operation lock: "
                + sanitizeEformsignErrorMessage(error),
            );
        }
        if (acquired !== "OK") {
            throw new EformsignOperationAlreadyRunningError();
        }

        let held = true;
        let leaseExpiresAt = acquiredAt + OPERATION_LOCK_LEASE_MS;
        let renewalInFlight = false;
        const heartbeat = setInterval(() => {
            if (!held || renewalInFlight) return;
            renewalInFlight = true;
            const renewalStartedAt = Date.now();
            void redis.eval(
                RENEW_LOCK_SCRIPT,
                1,
                lockKey,
                token,
                OPERATION_LOCK_LEASE_MS,
            ).then((result) => {
                if (Number(result) !== 1) {
                    held = false;
                    this.logger.error("Lost an eformsign operation lease");
                    return;
                }
                leaseExpiresAt = renewalStartedAt + OPERATION_LOCK_LEASE_MS;
            }).catch((error: unknown) => {
                const expired = Date.now() >= leaseExpiresAt;
                if (expired) held = false;
                this.logger[expired ? "error" : "warn"](
                    "Failed to renew an eformsign operation lease: "
                    + sanitizeEformsignErrorMessage(error),
                );
            }).finally(() => {
                renewalInFlight = false;
            });
        }, OPERATION_LOCK_RENEW_INTERVAL_MS);
        heartbeat.unref();

        try {
            return await work({
                isHeld: () => held && Date.now() < leaseExpiresAt,
            });
        } finally {
            clearInterval(heartbeat);
            held = false;
            await redis.eval(RELEASE_LOCK_SCRIPT, 1, lockKey, token).catch((error: unknown) => {
                this.logger.warn(
                    "Failed to release an eformsign operation lease: "
                    + sanitizeEformsignErrorMessage(error),
                );
            });
        }
    }

    private async runLocally<TResult>(
        lockKey: string,
        work: (lease: EformsignOperationLease) => Promise<TResult>,
    ): Promise<TResult> {
        if (this.localLocks.has(lockKey)) {
            throw new EformsignOperationAlreadyRunningError();
        }
        this.localLocks.add(lockKey);
        let held = true;
        try {
            return await work({ isHeld: () => held });
        } finally {
            held = false;
            this.localLocks.delete(lockKey);
        }
    }

    private async ensureConnected(redis: EformsignBackfillRedisClient): Promise<void> {
        if (redis.status === "wait") {
            try {
                await redis.connect();
            } catch (error) {
                throw new EformsignOperationLockUnavailableError(
                    "Unable to connect to Valkey for eformsign operation locking: "
                    + sanitizeEformsignErrorMessage(error),
                );
            }
        }
        if (redis.status !== "ready") {
            throw new EformsignOperationLockUnavailableError(
                `Valkey connection for eformsign operation locking is ${redis.status}`,
            );
        }
    }

    private lockKey(operationKey: string): string {
        const digest = createHash("sha256").update(operationKey).digest("hex");
        return `${OPERATION_LOCK_PREFIX}:${digest}`;
    }
}
