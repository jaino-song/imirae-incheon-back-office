import { ConfigService } from "@nestjs/config";

import { EformsignDocReconcileSchedulerService } from "application/services/eformsign-doc-reconcile-scheduler.service";
import { EformsignBackfillAlreadyRunningError } from "infrastructure/locking/eformsign-backfill-lock.service";

function createConfigService(enabled: string | undefined): ConfigService {
    return {
        get: jest.fn((key: string) =>
            key === "EFORMSIGN_RECONCILE_ENABLED" ? enabled : undefined),
    } as unknown as ConfigService;
}

function createSummary(overrides: Record<string, number> = {}) {
    return {
        fetched: 0,
        created: 0,
        updated: 0,
        skipped: 0,
        duplicates: 0,
        failed: 0,
        pages: 0,
        byDocumentType: {},
        ...overrides,
    };
}

describe("EformsignDocReconcileSchedulerService", () => {
    let backfill: { execute: jest.Mock };
    let lockService: { isAvailable: jest.Mock; runExclusive: jest.Mock };

    beforeEach(() => {
        backfill = { execute: jest.fn().mockResolvedValue(createSummary()) };
        lockService = {
            isAvailable: jest.fn().mockReturnValue(true),
            runExclusive: jest.fn((work: (lease: { isHeld: () => boolean }) => Promise<unknown>) =>
                work({ isHeld: () => true })),
        };
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    // No default argument: it.each passes undefined deliberately, and a default would
    // silently turn that case into the enabled one.
    function createService(enabled: string | undefined) {
        return new EformsignDocReconcileSchedulerService(
            createConfigService(enabled),
            backfill as never,
            lockService as never,
        );
    }

    describe("when the feature switch is off", () => {
        // This is the phase where the mirror stops being write-only. Everything stays
        // dormant until an environment opts in, so the step is reversible by config.
        it.each([undefined, "false", "1", "TRUE"])(
            "does nothing with EFORMSIGN_RECONCILE_ENABLED=%s",
            async (value) => {
                const service = createService(value);

                await service.reconcileDocuments();

                expect(backfill.execute).not.toHaveBeenCalled();
                expect(lockService.runExclusive).not.toHaveBeenCalled();
            },
        );
    });

    describe("reconciliation sweep", () => {
        it("runs under the distributed lock and hands the lease to the sweep", async () => {
            const service = createService("true");

            await service.reconcileDocuments();

            expect(lockService.runExclusive).toHaveBeenCalledTimes(1);
            expect(backfill.execute).toHaveBeenCalledWith(
                expect.objectContaining({ shouldContinue: expect.any(Function) }),
            );
        });

        it("skips quietly when another sweep already holds the lock", async () => {
            lockService.runExclusive.mockRejectedValue(
                new EformsignBackfillAlreadyRunningError(),
            );
            const service = createService("true");

            await expect(service.reconcileDocuments()).resolves.toBeUndefined();
        });

        it("sweeps without a lock when VALKEY_URL is unset, warning once", async () => {
            // No Valkey is configured in any environment today, so refusing to run would
            // ship this phase inert. The mirror writes are already safe under concurrency;
            // what we lose is protection against replicas doubling the vendor load.
            lockService.isAvailable.mockReturnValue(false);
            const service = createService("true");
            const warn = jest.spyOn(
                (service as unknown as { logger: { warn: (message: string) => void } }).logger,
                "warn",
            ).mockImplementation(() => undefined);

            await service.reconcileDocuments();
            await service.reconcileDocuments();

            expect(lockService.runExclusive).not.toHaveBeenCalled();
            expect(backfill.execute).toHaveBeenCalledTimes(2);
            expect(backfill.execute).toHaveBeenCalledWith(
                expect.objectContaining({ shouldContinue: expect.any(Function) }),
            );
            expect(warn.mock.calls.filter(([message]) => message.includes("VALKEY_URL")))
                .toHaveLength(1);
        });

        it("stops the sweep once the advertised runtime is spent", async () => {
            // SchedulerExecutionGuard only ages a stale token out on the next tick, a day
            // later, so the 30-minute bound is only real if the sweep itself polls it.
            let shouldContinue: (() => boolean) | undefined;
            backfill.execute.mockImplementation((options: { shouldContinue?: () => boolean }) => {
                shouldContinue = options.shouldContinue;
                return Promise.resolve(createSummary());
            });
            const nowSpy = jest.spyOn(Date, "now");
            nowSpy.mockReturnValue(1_000_000);
            const service = createService("true");

            await service.reconcileDocuments();

            expect(shouldContinue?.()).toBe(true);
            nowSpy.mockReturnValue(1_000_000 + 31 * 60 * 1000);
            expect(shouldContinue?.()).toBe(false);
        });

        it("escalates to error only once the sweep has failed several nights running", async () => {
            // This job has no other operator signal — Sentry here is filtered to
            // service-records — so a single bad night stays a warning and a streak does not.
            lockService.runExclusive.mockRejectedValue(new Error("coverage incomplete"));
            const service = createService("true");
            const logger = (service as unknown as {
                logger: { warn: (message: string) => void; error: (message: string) => void };
            }).logger;
            const warn = jest.spyOn(logger, "warn").mockImplementation(() => undefined);
            const error = jest.spyOn(logger, "error").mockImplementation(() => undefined);

            await service.reconcileDocuments();
            await service.reconcileDocuments();
            expect(error).not.toHaveBeenCalled();
            expect(warn).toHaveBeenCalledTimes(2);

            await service.reconcileDocuments();
            expect(error).toHaveBeenCalledTimes(1);
            expect(error.mock.calls[0]?.[0]).toContain("3 in a row");

            // A good night clears the streak, so the next failure is a warning again.
            lockService.runExclusive.mockImplementationOnce(
                (work: (lease: { isHeld: () => boolean }) => Promise<unknown>) =>
                    work({ isHeld: () => true }),
            );
            await service.reconcileDocuments();
            await service.reconcileDocuments();
            expect(error).toHaveBeenCalledTimes(1);
        });

        it("treats a fail-closed sweep as an incomplete run, not a crash", async () => {
            // The sweep fails closed on incomplete coverage. Nightly, that means "this run
            // did not finish reconciling" — tomorrow's run picks up from what landed.
            lockService.runExclusive.mockRejectedValueOnce(
                new Error("Eformsign document coverage incomplete type=01 missing=2"),
            );
            const service = createService("true");

            await expect(service.reconcileDocuments()).resolves.toBeUndefined();

            lockService.runExclusive.mockImplementationOnce(
                (work: (lease: { isHeld: () => boolean }) => Promise<unknown>) =>
                    work({ isHeld: () => true }),
            );
            await service.reconcileDocuments();
            expect(backfill.execute).toHaveBeenCalledTimes(1);
        });
    });
});
