import { Injectable, OnModuleDestroy } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import Redis from "ioredis";
import { randomUUID } from "node:crypto";

const LOCK_KEY = "babyjamjam:agent:action-expiry-sweep";
const LEASE_MS = 45_000;
const RELEASE_SCRIPT = `if redis.call("GET", KEYS[1]) == ARGV[1] then return redis.call("DEL", KEYS[1]) end return 0`;

export interface AgentActionSweepLease { isHeld(): boolean }

@Injectable()
export class AgentActionSweepLockService implements OnModuleDestroy {
    private readonly redis: Redis | null;

    constructor(config: ConfigService) {
        const url = config.get<string>("VALKEY_URL")?.trim();
        this.redis = url ? new Redis(url, { lazyConnect: true, enableOfflineQueue: false, maxRetriesPerRequest: 1 }) : null;
    }

    isAvailable(): boolean { return this.redis !== null; }

    async onModuleDestroy(): Promise<void> { this.redis?.disconnect(); }

    async runExclusive<T>(work: (lease: AgentActionSweepLease) => Promise<T>): Promise<T> {
        const redis = this.redis;
        if (!redis) throw new Error("Valkey is not configured for agent action sweep");
        if (redis.status === "wait") await redis.connect();
        if (redis.status !== "ready") throw new Error(`Valkey connection is ${redis.status}`);
        const token = randomUUID();
        if (await redis.set(LOCK_KEY, token, "PX", LEASE_MS, "NX") !== "OK") return work({ isHeld: () => false });
        let held = true;
        try {
            return await work({ isHeld: () => held });
        } finally {
            held = false;
            await redis.eval(RELEASE_SCRIPT, 1, LOCK_KEY, token).catch(() => undefined);
        }
    }
}
