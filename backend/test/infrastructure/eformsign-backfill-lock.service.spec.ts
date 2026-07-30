import { Logger } from "@nestjs/common";

import {
    EformsignBackfillAlreadyRunningError,
    EformsignBackfillLockService,
    EformsignBackfillLockUnavailableError,
} from "infrastructure/locking/eformsign-backfill-lock.service";

class FakeRedisLockClient {
    status = "ready";
    private owner: string | null = null;
    private readonly renewalOutcomes: Array<Error | number> = [];
    private readonly releaseOutcomes: Error[] = [];

    connect = jest.fn().mockResolvedValue(undefined);
    disconnect = jest.fn();

    set = jest.fn(
        (_key: string, token: string) => {
            if (this.owner !== null) {
                return Promise.resolve(null);
            }
            this.owner = token;
            return Promise.resolve("OK");
        },
    );

    eval = jest.fn((script: string, _keyCount: number, _key: string, token: string) => {
        if (script.includes("PEXPIRE")) {
            const outcome = this.renewalOutcomes.shift();
            if (outcome instanceof Error) {
                return Promise.reject(outcome);
            }
            if (outcome !== undefined) {
                return Promise.resolve(outcome);
            }
            return Promise.resolve(this.owner === token ? 1 : 0);
        }
        if (script.includes("DEL")) {
            const releaseError = this.releaseOutcomes.shift();
            if (releaseError) {
                return Promise.reject(releaseError);
            }
            if (this.owner === token) {
                this.owner = null;
                return Promise.resolve(1);
            }
        }
        return Promise.resolve(0);
    });

    loseOwnership(): void {
        this.owner = "another-run";
    }

    queueRenewalOutcomes(...outcomes: Array<Error | number>): void {
        this.renewalOutcomes.push(...outcomes);
    }

    queueReleaseOutcomes(...outcomes: Error[]): void {
        this.releaseOutcomes.push(...outcomes);
    }
}

describe("EformsignBackfillLockService", () => {
    afterEach(() => {
        jest.useRealTimers();
        jest.restoreAllMocks();
    });

    it("blocks a second concurrent run across service instances sharing the lock store", async () => {
        const redis = new FakeRedisLockClient();
        const firstService = new EformsignBackfillLockService(redis as never);
        const secondService = new EformsignBackfillLockService(redis as never);
        let releaseFirst: (() => void) | undefined;
        const firstRun = firstService.runExclusive(() => new Promise<void>((resolve) => {
            releaseFirst = resolve;
        }));

        await Promise.resolve();

        await expect(
            secondService.runExclusive(() => Promise.resolve()),
        ).rejects.toBeInstanceOf(EformsignBackfillAlreadyRunningError);

        releaseFirst?.();
        await firstRun;
        await expect(
            secondService.runExclusive(() => Promise.resolve("next-run")),
        ).resolves.toBe("next-run");
    });

    it("fails closed when Valkey is not configured", async () => {
        const service = new EformsignBackfillLockService(null);

        await expect(
            service.runExclusive(() => Promise.resolve()),
        ).rejects.toBeInstanceOf(EformsignBackfillLockUnavailableError);
    });

    it("redacts Valkey credentials from connection errors", async () => {
        const redis = new FakeRedisLockClient();
        redis.status = "wait";
        redis.connect.mockRejectedValue(
            new Error("rediss://cache-user:connect-secret@cache.example.test:6380/0 failed"),
        );
        const service = new EformsignBackfillLockService(redis as never);

        let thrown: unknown;
        try {
            await service.runExclusive(() => Promise.resolve());
        } catch (error) {
            thrown = error;
        }

        expect(thrown).toBeInstanceOf(EformsignBackfillLockUnavailableError);
        expect((thrown as Error).message).toContain(
            "rediss://[REDACTED]@cache.example.test:6380/0 failed",
        );
        expect((thrown as Error).message).not.toContain("connect-secret");
    });

    it("marks the lease lost when another owner replaces the lock token", async () => {
        jest.useFakeTimers();
        jest.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
        const redis = new FakeRedisLockClient();
        const service = new EformsignBackfillLockService(redis as never);
        let finishWork: (() => void) | undefined;
        let isHeld = true;
        const run = service.runExclusive(async (lease) => {
            await new Promise<void>((resolve) => {
                finishWork = resolve;
            });
            isHeld = lease.isHeld();
        });
        await Promise.resolve();
        redis.loseOwnership();

        await jest.advanceTimersByTimeAsync(20_000);

        finishWork?.();
        await run;
        expect(isHeld).toBe(false);
    });

    it("keeps the lease held when a transient renewal failure recovers before expiry", async () => {
        jest.useFakeTimers();
        jest.setSystemTime(new Date("2026-07-28T00:00:00.000Z"));
        jest.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
        const redis = new FakeRedisLockClient();
        redis.queueRenewalOutcomes(new Error("temporary network failure"), 1);
        const service = new EformsignBackfillLockService(redis as never);
        let finishWork: (() => void) | undefined;
        let leaseProbe: (() => boolean) | undefined;
        const run = service.runExclusive(async (lease) => {
            leaseProbe = lease.isHeld;
            await new Promise<void>((resolve) => {
                finishWork = resolve;
            });
        });
        await Promise.resolve();

        await jest.advanceTimersByTimeAsync(20_000);
        expect(leaseProbe?.()).toBe(true);
        await jest.advanceTimersByTimeAsync(20_000);
        expect(leaseProbe?.()).toBe(true);

        finishWork?.();
        await run;
    });

    it("marks the lease lost after renewal failures continue through the actual expiry", async () => {
        jest.useFakeTimers();
        jest.setSystemTime(new Date("2026-07-28T00:00:00.000Z"));
        jest.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
        jest.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
        const redis = new FakeRedisLockClient();
        redis.queueRenewalOutcomes(
            new Error("network failure 1"),
            new Error("network failure 2"),
            new Error("network failure 3"),
        );
        const service = new EformsignBackfillLockService(redis as never);
        let finishWork: (() => void) | undefined;
        let leaseProbe: (() => boolean) | undefined;
        const run = service.runExclusive(async (lease) => {
            leaseProbe = lease.isHeld;
            await new Promise<void>((resolve) => {
                finishWork = resolve;
            });
        });
        await Promise.resolve();

        await jest.advanceTimersByTimeAsync(59_999);
        expect(leaseProbe?.()).toBe(true);
        await jest.advanceTimersByTimeAsync(1);
        expect(leaseProbe?.()).toBe(false);

        finishWork?.();
        await run;
    });

    it("redacts Valkey credentials from renewal and release failure logs", async () => {
        jest.useFakeTimers();
        jest.setSystemTime(new Date("2026-07-28T00:00:00.000Z"));
        const warn = jest.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
        const redis = new FakeRedisLockClient();
        redis.queueRenewalOutcomes(
            new Error("rediss://cache-user:renew-secret@cache.example.test:6380/0 failed"),
        );
        redis.queueReleaseOutcomes(
            new Error("redis://:release-secret@cache.example.test:6379/0 failed"),
        );
        const service = new EformsignBackfillLockService(redis as never);
        let finishWork: (() => void) | undefined;
        const run = service.runExclusive(async () => {
            await new Promise<void>((resolve) => {
                finishWork = resolve;
            });
        });
        await Promise.resolve();

        await jest.advanceTimersByTimeAsync(20_000);
        finishWork?.();
        await run;

        const messages = warn.mock.calls.flat().join("\n");
        expect(messages).toContain(
            "rediss://[REDACTED]@cache.example.test:6380/0 failed",
        );
        expect(messages).toContain(
            "redis://[REDACTED]@cache.example.test:6379/0 failed",
        );
        expect(messages).not.toContain("renew-secret");
        expect(messages).not.toContain("release-secret");
    });
});
