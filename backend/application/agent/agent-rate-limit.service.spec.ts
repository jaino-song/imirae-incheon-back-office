import { ConfigService } from "@nestjs/config";

import { AgentRateLimitService } from "./agent-rate-limit.service";

describe("AgentRateLimitService", () => {
    it("increments and repairs the TTL in one atomic Valkey script", async () => {
        const redis = {
            status: "ready",
            eval: jest.fn().mockResolvedValue(1),
            disconnect: jest.fn(),
        };
        const service = new AgentRateLimitService(new ConfigService({
            VALKEY_URL: "redis://unused",
            AGENT_RATE_LIMIT_PER_MINUTE: "20",
        }));
        Object.assign(service, { redis });

        await service.check("user-a", "branch-a");

        expect(redis.eval).toHaveBeenCalledWith(expect.stringContaining("redis.call('INCR'"), 1, expect.stringMatching(/^agent:rate-limit:/), 60);
        expect(redis.eval).toHaveBeenCalledWith(expect.stringContaining("redis.call('TTL'"), 1, expect.any(String), 60);
    });
});
