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
    BackfillEformsignDocsError,
    BackfillEformsignDocsUsecase,
    EformsignDocsBackfillSummary,
} from "../usecases/eformsign-doc/backfill-eformsign-docs.usecase";
import { SchedulerExecutionGuard } from "./scheduler-execution.guard";

const KOREA_TIME_ZONE = "Asia/Seoul";

/** The sweep pages the whole document list; give it room without letting it wedge. */
const RECONCILE_MAX_RUN_MS = 30 * 60 * 1000;
const DB_COOLDOWN_MS = 5 * 60 * 1000;
/**
 * Nights in a row that may fail before the log stops being a warning. A sweep that
 * cannot finish is normal once — a document moved mid-pagination, the vendor blipped.
 * Several nights running means the mirror is drifting and nobody has noticed.
 */
const RECONCILE_FAILURE_ALERT_THRESHOLD = 3;

/**
 * Keeps the local `eformsign_doc` mirror honest between webhooks.
 *
 * A dropped webhook is the only thing this fixes, so it runs once a night: a day of
 * staleness is the exposure we already carry, and the sweep re-reads every document from
 * eformsign. Expiry comes along for free — the vendor reports status 080 — which is why
 * there is no separate time-based pass over `expiredDate`.
 *
 * Off unless `EFORMSIGN_RECONCILE_ENABLED=true`. This is the phase where the mirror
 * stops being write-only, and the switch is what makes that reversible.
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
    private warnedLockUnavailable = false;
    private consecutiveFailures = 0;

    constructor(
        private readonly configService: ConfigService,
        private readonly backfillUsecase: BackfillEformsignDocsUsecase,
        private readonly lockService: EformsignBackfillLockService,
    ) {}

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
                // The cooldown is built for the minute-by-minute jobs; on a nightly one
                // it has always lapsed by the next tick, so it cannot be what surfaces a
                // database outage lasting days. The streak below is. Counting these is
                // the whole point — an outage that never lets a sweep finish is exactly
                // the drift the escalation exists to report.
                this.reconcileGuard.enterCooldown(summarizePrismaError(error));
            }

            const message = `[Eformsign Reconcile] Sweep did not complete`
                + ` (${this.consecutiveFailures} in a row): ${describeError(error)}`;
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
        // day away — it never stops a run already under way. The sweep polls this before
        // every fetch and write, so putting the deadline here is what makes the advertised
        // bound real rather than letting a wedged run meet tomorrow's run still alive.
        const deadline = Date.now() + RECONCILE_MAX_RUN_MS;
        const withinDeadline = () => Date.now() < deadline;

        if (this.lockService.isAvailable()) {
            return this.lockService.runExclusive((lease) =>
                this.backfillUsecase.execute({
                    shouldContinue: () => withinDeadline() && lease.isHeld(),
                }));
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

        return this.backfillUsecase.execute({ shouldContinue: withinDeadline });
    }

    private isEnabled(): boolean {
        return this.configService.get<string>("EFORMSIGN_RECONCILE_ENABLED") === "true";
    }
}

/**
 * The sweep wraps a vendor failure twice — once per document type, once for the run — so
 * the outermost message is only ever "failed for types=01". The scheduled run passes no
 * onProgress callback, so this log is the only place the HTTP status or root exception
 * can surface; without unwrapping, even the error-level escalation says nothing useful.
 */
function describeError(error: unknown): string {
    const messages: string[] = [];
    const seen = new Set<unknown>();
    const visit = (value: unknown): void => {
        if (value === undefined || value === null || seen.has(value)) {
            return;
        }
        seen.add(value);
        if (Array.isArray(value)) {
            value.forEach(visit);
            return;
        }

        messages.push(value instanceof Error ? value.message : String(value));
        if (value instanceof BackfillEformsignDocsError) {
            visit(value.cause);
        }
    };

    visit(error);
    return messages.join(" <- ") || String(error);
}
