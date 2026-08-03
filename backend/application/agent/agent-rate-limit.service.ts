import { createHash } from "crypto";
import { HttpException, HttpStatus, Injectable, OnModuleDestroy } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import Redis from "ioredis";

@Injectable()
export class AgentRateLimitService implements OnModuleDestroy {
    private readonly windows = new Map<string, number[]>();
    private readonly redis: Redis | null;

    constructor(private readonly config: ConfigService) {
        const valkeyUrl = config.get<string>("VALKEY_URL")?.trim();
        this.redis = valkeyUrl ? new Redis(valkeyUrl, { lazyConnect: true, enableOfflineQueue: false, maxRetriesPerRequest: 1, connectTimeout: 2_000 }) : null;
        this.redis?.on("error", () => undefined);
    }

    async check(userId: string, branchId: string): Promise<void> {
        const limit = Math.max(1, Number(this.config.get("AGENT_RATE_LIMIT_PER_MINUTE")) || 20);
        const now = Date.now();
        const key = createHash("sha256").update(`${userId}:${branchId}`).digest("hex");

        if (this.redis) {
            try {
                if (this.redis.status === "wait") await this.redis.connect();
                const count = await this.redis.incr(`agent:rate-limit:${key}`);
                if (count === 1) await this.redis.expire(`agent:rate-limit:${key}`, 60);
                if (count > limit) throw new HttpException("Agent rate limit exceeded", HttpStatus.TOO_MANY_REQUESTS);
                return;
            } catch (error) {
                if (error instanceof HttpException) throw error;
                // A Valkey outage must not turn a read-only feature into a hard outage;
                // the bounded process-local fallback still enforces the limit.
            }
        }

        const recent = (this.windows.get(key) ?? []).filter((timestamp) => timestamp > now - 60_000);
        if (recent.length >= limit) {
            throw new HttpException("Agent rate limit exceeded", HttpStatus.TOO_MANY_REQUESTS);
        }
        recent.push(now);
        this.windows.set(key, recent);
    }

    onModuleDestroy(): void {
        this.redis?.disconnect();
    }
}
