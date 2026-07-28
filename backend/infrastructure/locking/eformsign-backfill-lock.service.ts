import { randomUUID } from "crypto";

import {
    Inject,
    Injectable,
    Logger,
    OnModuleDestroy,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import Redis from "ioredis";

const BACKFILL_LOCK_KEY = "babyjamjam:eformsign:documents-backfill";
const BACKFILL_LOCK_LEASE_MS = 60_000;
const BACKFILL_LOCK_RENEW_INTERVAL_MS = 20_000;

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

export interface EformsignBackfillRedisClient {
    status: string;
    connect(): Promise<unknown>;
    disconnect(): void;
    set(
        key: string,
        value: string,
        expiryMode: "PX",
        leaseMs: number,
        condition: "NX",
    ): Promise<"OK" | null>;
    eval(
        script: string,
        keyCount: number,
        key: string,
        token: string,
        leaseMs?: number,
    ): Promise<unknown>;
}

export interface EformsignBackfillLease {
    isHeld(): boolean;
}

export class EformsignBackfillAlreadyRunningError extends Error {
    constructor() {
        super("An eformsign document backfill is already running");
        this.name = EformsignBackfillAlreadyRunningError.name;
    }
}

export class EformsignBackfillLockUnavailableError extends Error {
    constructor(message = "Valkey is required for the eformsign document backfill lock") {
        super(message);
        this.name = EformsignBackfillLockUnavailableError.name;
    }
}

export const EFORMSIGN_BACKFILL_REDIS_CLIENT = Symbol(
    "EFORMSIGN_BACKFILL_REDIS_CLIENT",
);

export function createEformsignBackfillRedisClient(
    configService: ConfigService,
): EformsignBackfillRedisClient | null {
    const valkeyUrl = configService.get<string>("VALKEY_URL")?.trim();
    if (!valkeyUrl) {
        return null;
    }

    return new Redis(valkeyUrl, {
        lazyConnect: true,
        enableOfflineQueue: false,
        maxRetriesPerRequest: 1,
        connectTimeout: 2_000,
    }) as EformsignBackfillRedisClient;
}

@Injectable()
export class EformsignBackfillLockService implements OnModuleDestroy {
    private readonly logger = new Logger(EformsignBackfillLockService.name);

    constructor(
        @Inject(EFORMSIGN_BACKFILL_REDIS_CLIENT)
        private readonly redis: EformsignBackfillRedisClient | null,
    ) {}

    async onModuleDestroy(): Promise<void> {
        this.redis?.disconnect();
    }

    async runExclusive<TResult>(
        work: (lease: EformsignBackfillLease) => Promise<TResult>,
    ): Promise<TResult> {
        const redis = this.redis;
        if (!redis) {
            throw new EformsignBackfillLockUnavailableError();
        }

        await this.ensureConnected(redis);
        const token = randomUUID();
        const acquired = await redis.set(
            BACKFILL_LOCK_KEY,
            token,
            "PX",
            BACKFILL_LOCK_LEASE_MS,
            "NX",
        );
        if (acquired !== "OK") {
            throw new EformsignBackfillAlreadyRunningError();
        }

        let held = true;
        let renewalInFlight = false;
        const heartbeat = setInterval(() => {
            if (!held || renewalInFlight) {
                return;
            }
            renewalInFlight = true;
            void this.renew(redis, token)
                .then((renewed) => {
                    if (!renewed) {
                        held = false;
                        this.logger.error(
                            "Lost the distributed eformsign backfill execution lease",
                        );
                    }
                })
                .catch((error: unknown) => {
                    held = false;
                    this.logger.error(
                        `Failed to renew the eformsign backfill execution lease: ${
                            error instanceof Error ? error.message : String(error)
                        }`,
                    );
                })
                .finally(() => {
                    renewalInFlight = false;
                });
        }, BACKFILL_LOCK_RENEW_INTERVAL_MS);
        heartbeat.unref();

        try {
            return await work({ isHeld: () => held });
        } finally {
            clearInterval(heartbeat);
            try {
                await this.release(redis, token);
            } catch (error) {
                this.logger.warn(
                    `Failed to release the eformsign backfill execution lease: ${
                        error instanceof Error ? error.message : String(error)
                    }`,
                );
            }
        }
    }

    private async ensureConnected(redis: EformsignBackfillRedisClient): Promise<void> {
        if (redis.status === "wait") {
            try {
                await redis.connect();
            } catch (error) {
                throw new EformsignBackfillLockUnavailableError(
                    `Unable to connect to Valkey for the eformsign backfill lock: ${
                        error instanceof Error ? error.message : String(error)
                    }`,
                );
            }
        }

        if (redis.status !== "ready") {
            throw new EformsignBackfillLockUnavailableError(
                `Valkey connection is ${redis.status}`,
            );
        }
    }

    private async renew(
        redis: EformsignBackfillRedisClient,
        token: string,
    ): Promise<boolean> {
        const result = await redis.eval(
            RENEW_LOCK_SCRIPT,
            1,
            BACKFILL_LOCK_KEY,
            token,
            BACKFILL_LOCK_LEASE_MS,
        );
        return Number(result) === 1;
    }

    private async release(
        redis: EformsignBackfillRedisClient,
        token: string,
    ): Promise<void> {
        await redis.eval(
            RELEASE_LOCK_SCRIPT,
            1,
            BACKFILL_LOCK_KEY,
            token,
        );
    }
}
