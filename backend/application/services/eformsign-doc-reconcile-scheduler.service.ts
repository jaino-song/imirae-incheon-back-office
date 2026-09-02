import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Cron } from "@nestjs/schedule";

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
import { createEformsignGlobalWorkerPrincipal } from "./eformsign-credential-boundary.service";
import { describeEformsignBackfillError } from "../utils/eformsign-backfill-error";
import { SchedulerExecutionGuard } from "./scheduler-execution.guard";
import { SchedulerLeaseService } from "./scheduler-lease.service";

const KOREA_TIME_ZONE = "Asia/Seoul";

/** The sweep pages the whole document list; give it room without letting it wedge. */
const RECONCILE_MAX_RUN_MS = 30 * 60 * 1000;
const DB_COOLDOWN_MS = 5 * 60 * 1000;
/**
 * Runs in a row that may fail before the log stops being a warning. A sweep that
 * cannot finish is normal once — a document moved mid-pagination, the vendor blipped.
 * Several nights running means the mirror is drifting and nobody has noticed.
 */
const RECONCILE_FAILURE_ALERT_THRESHOLD = 3;

/**
 * Keeps the local `eformsign_doc` mirror honest between webhooks.
 *
 * A dropped webhook is the main thing this fixes. It runs at 00:00, 06:00, 12:00 and
 * 18:00 Korea time, re-reading changed documents and their files from eformsign. Expiry
 * comes along for free — the vendor reports status 080 — which is why there is no
 * separate time-based pass over `expiredDate`.
 *
 * It is enabled automatically when the eformsign credentials are configured. Set
 * `EFORMSIGN_RECONCILE_ENABLED=false` for an explicit operational pause.
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
    private warnedMissingLockApproval = false;
    private warnedUnlockedRun = false;
    private consecutiveFailures = 0;

    constructor(
        private readonly configService: ConfigService,
        private readonly backfillUsecase: BackfillEformsignDocsUsecase,
        private readonly lockService: EformsignBackfillLockService,
        private readonly schedulerLease: SchedulerLeaseService,
    ) {}

    @Cron("0 */6 * * *", { timeZone: KOREA_TIME_ZONE })
    async reconcileDocuments(): Promise<void> {
        if (!this.schedulerLease.holdsLease()) {
            return;
        }

        if (!this.isEnabled()) {
            return;
        }

        if (!this.lockService.isAvailable() && !this.isUnlockedRunAllowed()) {
            if (!this.warnedMissingLockApproval) {
                this.warnedMissingLockApproval = true;
                this.logger.warn(
                    "[Eformsign Reconcile] VALKEY_URL is unset; skipping the sweep because"
                    + " a cross-instance lock cannot be acquired. Set VALKEY_URL, or set"
                    + " EFORMSIGN_RECONCILE_ALLOW_UNLOCKED=true only when the deployment"
                    + " is guaranteed to run a single scheduler replica.",
                );
            }
            return;
        }

        const runToken = this.reconcileGuard.tryStart();
        if (!runToken) {
            return;
        }

        try {
            const summary = await this.runSweep();
            this.consecutiveFailures = 0;
            this.logger.log(
                "[Eformsign Reconcile] Sweep completed"
                + ` fetched=${summary.fetched} created=${summary.created}`
                + ` updated=${summary.updated} skipped=${summary.skipped}`
                + ` duplicates=${summary.duplicates}`,
            );
        } catch (error) {
            if (error instanceof EformsignBackfillAlreadyRunningError) {
                this.logger.log("[Eformsign Reconcile] Another sweep holds the lock; skipping");
                return;
            }

            // A sweep that fails closed — incomplete coverage, a document it could not
            // write — is telling us this run did not fully reconcile, not that anything
            // is broken. Tomorrow's run starts from whatever this one managed to land.
            // But a run that fails every night is drift nobody is watching, and this job
            // has no other operator signal: Sentry here is filtered to service-records
            // only, so an error-level log is the loudest thing available.
            this.consecutiveFailures += 1;

            if (isTransientPrismaConnectivityError(error)) {
            // The cooldown is shorter than the six-hour interval, so it cannot be what surfaces a
                // database outage lasting days. The streak below is. Counting these is
                // the whole point — an outage that never lets a sweep finish is exactly
                // the drift the escalation exists to report.
                this.reconcileGuard.enterCooldown(summarizePrismaError(error));
            }

            const message = `[Eformsign Reconcile] Sweep did not complete`
                + ` (${this.consecutiveFailures} in a row): ${describeEformsignBackfillError(error)}`;
            if (this.consecutiveFailures >= RECONCILE_FAILURE_ALERT_THRESHOLD) {
                this.logger.error(message);
            } else {
                this.logger.warn(message);
            }
        } finally {
            this.reconcileGuard.finish(runToken);
        }
    }

    private async runSweep(): Promise<EformsignDocsBackfillSummary> {
        // The execution guard only ages a stale token out at the *next* tick, which is a
        // six hours away — it never stops a run already under way. The sweep polls this before
        // every fetch and write, so putting the deadline here is what makes the advertised
        // bound real rather than letting a wedged run meet tomorrow's run still alive.
        const deadline = Date.now() + RECONCILE_MAX_RUN_MS;
        const withinDeadline = () => Date.now() < deadline;

        if (this.lockService.isAvailable()) {
            return this.lockService.runExclusive((lease) =>
                this.backfillUsecase.execute({
                    shouldContinue: () => withinDeadline() && lease.isHeld() && this.schedulerLease.holdsLease(),
                }, createEformsignGlobalWorkerPrincipal("reconciliation")));
        }

        // The caller reached this path only after an explicit single-replica approval.
        // The in-memory guard serialises within this process, while the approval makes
        // the remaining cross-instance assumption visible in deployment configuration.
        if (!this.warnedUnlockedRun) {
            this.warnedUnlockedRun = true;
            this.logger.warn(
                "[Eformsign Reconcile] Running without a cross-instance lock under"
                + " EFORMSIGN_RECONCILE_ALLOW_UNLOCKED=true.",
            );
        }

        return this.backfillUsecase.execute(
            { shouldContinue: () => withinDeadline() && this.schedulerLease.holdsLease() },
            createEformsignGlobalWorkerPrincipal("reconciliation"),
        );
    }

    private isEnabled(): boolean {
        const configured = this.configService.get<string>(
            "EFORMSIGN_RECONCILE_ENABLED",
        );
        if (configured !== undefined && configured !== "") {
            return configured === "true";
        }

        return [
            "EFORMSIGN_USER_EMAIL",
            "EFORMSIGN_API_URL",
            "EFORMSIGN_DOC_API_URL",
            "EFORMSIGN_API_KEY",
            "EFORMSIGN_PRIVATE_KEY",
            "EFORMSIGN_COMPANY_ID",
            "EFORMSIGN_TEMPLATE_ID",
        ].every((key) => Boolean(this.configService.get<string>(key)?.trim()));
    }

    private isUnlockedRunAllowed(): boolean {
        return this.configService.get<string>(
            "EFORMSIGN_RECONCILE_ALLOW_UNLOCKED",
        ) === "true";
    }
}
