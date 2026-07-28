import { Logger } from "@nestjs/common";

import {
    EformsignBackfillAlreadyRunningError,
    EformsignBackfillLockService,
    EformsignBackfillLockUnavailableError,
} from "infrastructure/locking/eformsign-backfill-lock.service";

class FakeRedisLockClient {
    status = "ready";
    private owner: string | null = null;

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
            return Promise.resolve(this.owner === token ? 1 : 0);
        }
        if (script.includes("DEL") && this.owner === token) {
            this.owner = null;
            return Promise.resolve(1);
        }
        return Promise.resolve(0);
    });

    loseOwnership(): void {
        this.owner = "another-run";
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
});
