import { ConfigService } from "@nestjs/config";

import {
    LEASE_RENEW_INTERVAL_MS,
    LEASE_SHUTDOWN_TIMEOUT_MS,
    LEASE_STARTUP_TIMEOUT_MS,
    LEASE_TAKEOVER_AFTER_SECONDS,
    LEASE_TTL_SECONDS,
    resolveSchedulerLeaseMode,
    SCHEDULER_LEASE_NAME,
    SchedulerLeaseService,
} from "application/services/scheduler-lease.service";
import type {
    ISchedulerLeaseRepository,
    SchedulerLeaseAcquireResult,
} from "domain/repositories/scheduler-lease.repository.interface";

function acquireResult(overrides: Partial<SchedulerLeaseAcquireResult> = {}): SchedulerLeaseAcquireResult {
    return {
        acquired: true,
        expiresAt: new Date("2030-01-01T00:00:00.000Z"),
        dbNow: new Date("2030-01-01T00:00:00.000Z"),
        ...overrides,
    };
}

function createConfigService(values: Record<string, string | undefined>): ConfigService {
    return { get: (key: string) => values[key] } as unknown as ConfigService;
}

function createRepositoryMock(): jest.Mocked<ISchedulerLeaseRepository> {
    return {
        acquireOrRenew: jest.fn(),
        release: jest.fn().mockResolvedValue(true),
        read: jest.fn().mockResolvedValue(null),
    };
}

describe("resolveSchedulerLeaseMode", () => {
    it("standby beats everything, even an explicit lease mode in production", () => {
        expect(
            resolveSchedulerLeaseMode({ leaseMode: "required", nodeEnv: "production", schedulersEnabled: false }),
        ).toBe("standby");
    });

    it.each([
        ["required", "required"],
        ["REQUIRED", "required"],
        ["  required  ", "required"],
        ["off", "off"],
        ["OFF", "off"],
        ["  off  ", "off"],
    ])("explicit lease mode %s resolves to %s (case-insensitive, trimmed)", (leaseMode, expected) => {
        expect(resolveSchedulerLeaseMode({ leaseMode, nodeEnv: "development", schedulersEnabled: true })).toBe(
            expected,
        );
    });

    it("defaults to required in production when unset", () => {
        expect(
            resolveSchedulerLeaseMode({ leaseMode: undefined, nodeEnv: "production", schedulersEnabled: true }),
        ).toBe("required");
    });

    it("defaults to off outside production when unset", () => {
        expect(
            resolveSchedulerLeaseMode({ leaseMode: undefined, nodeEnv: "development", schedulersEnabled: true }),
        ).toBe("off");
        expect(
            resolveSchedulerLeaseMode({ leaseMode: undefined, nodeEnv: undefined, schedulersEnabled: true }),
        ).toBe("off");
    });

    it("an invalid non-empty value falls back to the nodeEnv default", () => {
        expect(
            resolveSchedulerLeaseMode({ leaseMode: "bogus", nodeEnv: "production", schedulersEnabled: true }),
        ).toBe("required");
        expect(
            resolveSchedulerLeaseMode({ leaseMode: "bogus", nodeEnv: "development", schedulersEnabled: true }),
        ).toBe("off");
    });

    it("treats an empty (or whitespace-only) string as unset", () => {
        expect(resolveSchedulerLeaseMode({ leaseMode: "", nodeEnv: "production", schedulersEnabled: true })).toBe(
            "required",
        );
        expect(
            resolveSchedulerLeaseMode({ leaseMode: "   ", nodeEnv: "production", schedulersEnabled: true }),
        ).toBe("required");
    });
});

describe("SchedulerLeaseService", () => {
    let repository: jest.Mocked<ISchedulerLeaseRepository>;

    beforeEach(() => {
        jest.useFakeTimers();
        repository = createRepositoryMock();
    });

    afterEach(() => {
        jest.useRealTimers();
    });

    function createService(
        values: Record<string, string | undefined>,
        schedulersEnabled: boolean,
    ): SchedulerLeaseService {
        return new SchedulerLeaseService(repository, createConfigService(values), schedulersEnabled);
    }

    describe("standby mode (SCHEDULERS_ENABLED=false)", () => {
        it("never touches the repository, holdsLease() is always false, and no timer is created", async () => {
            const service = createService({}, false);
            await service.onModuleInit();

            expect(service.mode).toBe("standby");
            expect(service.holdsLease()).toBe(false);
            expect(repository.acquireOrRenew).not.toHaveBeenCalled();

            await jest.advanceTimersByTimeAsync(LEASE_RENEW_INTERVAL_MS * 3);
            expect(repository.acquireOrRenew).not.toHaveBeenCalled();
            expect(service.holdsLease()).toBe(false);

            await service.onModuleDestroy();
            expect(repository.release).not.toHaveBeenCalled();
        });
    });

    describe("off mode", () => {
        it("holdsLease() is always true; repository is never called even after 3 renew intervals; no timer", async () => {
            const service = createService({ SCHEDULER_LEASE_MODE: "off" }, true);
            await service.onModuleInit();

            expect(service.mode).toBe("off");
            expect(service.holdsLease()).toBe(true);
            expect(repository.acquireOrRenew).not.toHaveBeenCalled();

            await jest.advanceTimersByTimeAsync(LEASE_RENEW_INTERVAL_MS * 3);
            expect(repository.acquireOrRenew).not.toHaveBeenCalled();
            expect(service.holdsLease()).toBe(true);
        });
    });

    describe("required mode", () => {
        it("onModuleInit awaits the first acquire; acquired -> holdsLease() true", async () => {
            repository.acquireOrRenew.mockResolvedValue(acquireResult({ acquired: true }));
            const service = createService({ SCHEDULER_LEASE_MODE: "required" }, true);

            await service.onModuleInit();

            expect(repository.acquireOrRenew).toHaveBeenCalledTimes(1);
            expect(repository.acquireOrRenew).toHaveBeenCalledWith(
                expect.objectContaining({
                    name: SCHEDULER_LEASE_NAME,
                    holderId: service.holderId,
                    instanceId: service.instanceId,
                    ttlSeconds: LEASE_TTL_SECONDS,
                    takeoverAfterSeconds: LEASE_TAKEOVER_AFTER_SECONDS,
                }),
            );
            expect(service.holdsLease()).toBe(true);
        });

        it("repository throws at init -> init resolves (no throw), holdsLease() false", async () => {
            repository.acquireOrRenew.mockRejectedValue(new Error("boom"));
            const service = createService({ SCHEDULER_LEASE_MODE: "required" }, true);

            await expect(service.onModuleInit()).resolves.toBeUndefined();
            expect(service.holdsLease()).toBe(false);
        });

        it("acquired, then a renew returns acquired:false -> holdsLease() false immediately", async () => {
            repository.acquireOrRenew.mockResolvedValueOnce(acquireResult({ acquired: true }));
            const service = createService({ SCHEDULER_LEASE_MODE: "required" }, true);
            await service.onModuleInit();
            expect(service.holdsLease()).toBe(true);

            repository.acquireOrRenew.mockResolvedValueOnce(
                acquireResult({ acquired: false, expiresAt: null, dbNow: null }),
            );

            await jest.advanceTimersByTimeAsync(LEASE_RENEW_INTERVAL_MS);

            expect(service.holdsLease()).toBe(false);
        });

        it("renew throws twice (20s apart) tolerates the grace window; a third failure / 60s elapsed crosses it", async () => {
            repository.acquireOrRenew.mockResolvedValueOnce(acquireResult({ acquired: true }));
            const service = createService({ SCHEDULER_LEASE_MODE: "required" }, true);
            await service.onModuleInit();
            expect(service.holdsLease()).toBe(true);

            repository.acquireOrRenew.mockRejectedValue(new Error("transient failure"));

            await jest.advanceTimersByTimeAsync(LEASE_RENEW_INTERVAL_MS);
            expect(repository.acquireOrRenew).toHaveBeenCalledTimes(2); // the failed renew actually ran
            expect(service.holdsLease()).toBe(true); // 20s since last successful renew

            await jest.advanceTimersByTimeAsync(LEASE_RENEW_INTERVAL_MS);
            expect(repository.acquireOrRenew).toHaveBeenCalledTimes(3);
            expect(service.holdsLease()).toBe(true); // 40s since last successful renew, still tolerated

            await jest.advanceTimersByTimeAsync(LEASE_RENEW_INTERVAL_MS);
            expect(repository.acquireOrRenew).toHaveBeenCalledTimes(4);
            expect(service.holdsLease()).toBe(false); // 60s elapsed, grace window crossed
        });

        it("onModuleDestroy: holdsLease() false, release called with name + identity; destroy resolves even if release rejects", async () => {
            repository.acquireOrRenew.mockResolvedValueOnce(acquireResult({ acquired: true }));
            repository.release.mockRejectedValue(new Error("release failed"));
            const service = createService({ SCHEDULER_LEASE_MODE: "required" }, true);
            await service.onModuleInit();
            expect(service.holdsLease()).toBe(true);

            await expect(service.onModuleDestroy()).resolves.toBeUndefined();

            expect(service.holdsLease()).toBe(false);
            expect(repository.release).toHaveBeenCalledWith(SCHEDULER_LEASE_NAME, {
                holderId: service.holderId,
                instanceId: service.instanceId,
            });
        });

        it("first acquire hangs longer than the startup timeout -> init resolves within the timeout, holdsLease() false", async () => {
            let resolveAcquire: (result: SchedulerLeaseAcquireResult) => void = () => {};
            repository.acquireOrRenew.mockImplementation(
                () =>
                    new Promise((resolve) => {
                        resolveAcquire = resolve;
                    }),
            );
            const service = createService({ SCHEDULER_LEASE_MODE: "required" }, true);

            // Do NOT await onModuleInit() before advancing — it would deadlock under fake timers
            // since the mock never resolves on its own.
            const initPromise = service.onModuleInit();
            await jest.advanceTimersByTimeAsync(LEASE_STARTUP_TIMEOUT_MS);
            await initPromise;

            expect(service.holdsLease()).toBe(false);

            // Let the still-pending mock settle so it doesn't leak an unresolved promise.
            resolveAcquire(acquireResult({ acquired: true }));
        });

        it("renew does not overlap: a pending unresolved renew is not retried on the next tick", async () => {
            repository.acquireOrRenew.mockResolvedValueOnce(acquireResult({ acquired: true }));
            const service = createService({ SCHEDULER_LEASE_MODE: "required" }, true);
            await service.onModuleInit();
            expect(repository.acquireOrRenew).toHaveBeenCalledTimes(1);

            let resolveSecond: (result: SchedulerLeaseAcquireResult) => void = () => {};
            repository.acquireOrRenew.mockImplementation(
                () =>
                    new Promise((resolve) => {
                        resolveSecond = resolve;
                    }),
            );

            await jest.advanceTimersByTimeAsync(LEASE_RENEW_INTERVAL_MS);
            expect(repository.acquireOrRenew).toHaveBeenCalledTimes(2);

            // A second renew interval elapses while the first renew is still in flight — must
            // not call the repository again.
            await jest.advanceTimersByTimeAsync(LEASE_RENEW_INTERVAL_MS);
            expect(repository.acquireOrRenew).toHaveBeenCalledTimes(2);

            resolveSecond(acquireResult({ acquired: true }));
        });

        it("renew in flight when onModuleDestroy runs: resolving it after destroy leaves holdsLease() false and calls acquireOrRenew no further", async () => {
            repository.acquireOrRenew.mockResolvedValueOnce(acquireResult({ acquired: true }));
            const service = createService({ SCHEDULER_LEASE_MODE: "required" }, true);
            await service.onModuleInit();
            expect(service.holdsLease()).toBe(true);

            let resolveSecond: (result: SchedulerLeaseAcquireResult) => void = () => {};
            repository.acquireOrRenew.mockImplementation(
                () =>
                    new Promise((resolve) => {
                        resolveSecond = resolve;
                    }),
            );

            await jest.advanceTimersByTimeAsync(LEASE_RENEW_INTERVAL_MS);
            expect(repository.acquireOrRenew).toHaveBeenCalledTimes(2);

            // Destroy while the second renew is still in flight — do NOT await before
            // advancing, since onModuleDestroy bounds the wait with a real timer.
            const destroyPromise = service.onModuleDestroy();
            await jest.advanceTimersByTimeAsync(LEASE_SHUTDOWN_TIMEOUT_MS);
            await destroyPromise;

            expect(service.holdsLease()).toBe(false);

            resolveSecond(acquireResult({ acquired: true }));
            await jest.advanceTimersByTimeAsync(0);

            expect(service.holdsLease()).toBe(false);
            expect(repository.acquireOrRenew).toHaveBeenCalledTimes(2);
        });
    });
});
