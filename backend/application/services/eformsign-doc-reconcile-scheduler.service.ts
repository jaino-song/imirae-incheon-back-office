import { Inject, Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Cron } from "@nestjs/schedule";

import {
    EFORMSIGN_DOC_REPOSITORY,
    IEformsignDocRepository,
} from "domain/repositories/eformsign-doc.repository.interface";
import {
    isTransientPrismaConnectivityError,
    summarizePrismaError,
} from "infrastructure/database/prisma-error.utils";
import {
    EformsignBackfillAlreadyRunningError,
    EformsignBackfillLockService,
} from "infrastructure/locking/eformsign-backfill-lock.service";

import {
    BackfillEformsignDocsUsecase,
    EformsignDocsBackfillSummary,
} from "../usecases/eformsign-doc/backfill-eformsign-docs.usecase";
import { SchedulerExecutionGuard } from "./scheduler-execution.guard";

const KOREA_TIME_ZONE = "Asia/Seoul";

/** The sweep pages the whole document list; give it room without letting it wedge. */
const RECONCILE_MAX_RUN_MS = 30 * 60 * 1000;
const EXPIRY_MAX_RUN_MS = 5 * 60 * 1000;
const DB_COOLDOWN_MS = 5 * 60 * 1000;

/**
 * Keeps the local `eformsign_doc` mirror honest between webhooks.
 *
 * Two jobs with different costs, so they run on different clocks. The expiry flip is a
 * single conditional UPDATE and runs hourly. The reconciliation sweep re-reads every
 * document from eformsign and runs once a night, because a dropped webhook is the only
 * thing it fixes and a day of staleness is the exposure we already accept.
 *
 * Both are off unless `EFORMSIGN_RECONCILE_ENABLED=true`. This is the phase where the
 * mirror stops being write-only, and the switch is what makes that reversible.
 */
@Injectable()
export class EformsignDocReconcileSchedulerService {
    private readonly logger = new Logger(EformsignDocReconcileSchedulerService.name);
    private readonly reconcileGuard = new SchedulerExecutionGuard({
        logger: this.logger,
        runningWarning: "[Eformsign Reconcile] Previous sweep is still running; skipping tick",
        staleRunError: "[Eformsign Reconcile] Previous sweep exceeded the max runtime",
        cooldownWarning: "[Eformsign Reconcile] Database connectivity issue during the sweep",
        maxRunMs: RECONCILE_MAX_RUN_MS,
        cooldownMs: DB_COOLDOWN_MS,
    });
    private readonly expiryGuard = new SchedulerExecutionGuard({
        logger: this.logger,
        runningWarning: "[Eformsign Expiry] Previous expiry pass is still running; skipping tick",
        staleRunError: "[Eformsign Expiry] Previous expiry pass exceeded the max runtime",
        cooldownWarning: "[Eformsign Expiry] Database connectivity issue during the expiry pass",
        maxRunMs: EXPIRY_MAX_RUN_MS,
        cooldownMs: DB_COOLDOWN_MS,
    });
    private warnedLockUnavailable = false;

    constructor(
        private readonly configService: ConfigService,
        private readonly backfillUsecase: BackfillEformsignDocsUsecase,
        private readonly lockService: EformsignBackfillLockService,
        @Inject(EFORMSIGN_DOC_REPOSITORY)
        private readonly eformsignDocRepository: IEformsignDocRepository,
    ) {}

    @Cron("30 * * * *", { timeZone: KOREA_TIME_ZONE })
    async markExpiredDocuments(): Promise<void> {
        if (!this.isEnabled()) {
            return;
        }

        const runToken = this.expiryGuard.tryStart();
        if (!runToken) {
            return;
        }

        try {
            const count = await this.eformsignDocRepository.markExpiredDocuments(new Date());
            if (count > 0) {
                this.logger.log(`[Eformsign Expiry] Marked ${count} documents expired`);
            }
        } catch (error) {
            if (isTransientPrismaConnectivityError(error)) {
                this.expiryGuard.enterCooldown(summarizePrismaError(error));
                return;
            }

            this.logger.error(
                `[Eformsign Expiry] Failed to mark expired documents: ${describeError(error)}`,
            );
        } finally {
            this.expiryGuard.finish(runToken);
        }
    }

    @Cron("0 4 * * *", { timeZone: KOREA_TIME_ZONE })
    async reconcileDocuments(): Promise<void> {
        if (!this.isEnabled()) {
            return;
        }

        const runToken = this.reconcileGuard.tryStart();
        if (!runToken) {
            return;
        }

        try {
            const summary = await this.runSweep();
            this.logger.log(
                "[Eformsign Reconcile] Sweep completed"
                + ` fetched=${summary.fetched} created=${summary.created}`
                + ` updated=${summary.updated} skipped=${summary.skipped}`,
            );
        } catch (error) {
            if (error instanceof EformsignBackfillAlreadyRunningError) {
                this.logger.log("[Eformsign Reconcile] Another sweep holds the lock; skipping");
                return;
            }

            if (isTransientPrismaConnectivityError(error)) {
                this.reconcileGuard.enterCooldown(summarizePrismaError(error));
                return;
            }

            // A sweep that fails closed — incomplete coverage, a document it could not
            // write — is telling us this run did not fully reconcile, not that anything
            // is broken. Tomorrow's run starts from whatever this one managed to land.
            this.logger.warn(
                `[Eformsign Reconcile] Sweep did not complete: ${describeError(error)}`,
            );
        } finally {
            this.reconcileGuard.finish(runToken);
        }
    }

    private async runSweep(): Promise<EformsignDocsBackfillSummary> {
        if (this.lockService.isAvailable()) {
            return this.lockService.runExclusive((lease) =>
                this.backfillUsecase.execute({ shouldContinue: lease.isHeld }));
        }

        // No VALKEY_URL, so there is no cross-instance lock to take. The in-memory guard
        // above still serialises this within the process, which is the single-instance
        // assumption the snapshot cache already makes when Valkey is absent. Concurrent
        // sweeps would still be safe — the mirror writes carry ownership and staleness
        // predicates — but they would multiply the load on eformsign, so say it once.
        if (!this.warnedLockUnavailable) {
            this.warnedLockUnavailable = true;
            this.logger.warn(
                "[Eformsign Reconcile] VALKEY_URL is unset, so the sweep runs without a"
                + " cross-instance lock. Set it to stop replicas sweeping in parallel.",
            );
        }

        return this.backfillUsecase.execute();
    }

    private isEnabled(): boolean {
        return this.configService.get<string>("EFORMSIGN_RECONCILE_ENABLED") === "true";
    }
}

function describeError(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}
