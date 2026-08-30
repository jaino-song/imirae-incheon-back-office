import { Injectable, Logger } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import { PrismaService } from "infrastructure/database/prisma.service";
import {
    CALL_PROCESSING_CLAIM_LEASE_MS,
    CallProcessingService,
} from "application/services/call-processing.service";
import { SchedulerExecutionGuard } from "./scheduler-execution.guard";
import {
    isTransientPrismaConnectivityError,
    summarizePrismaError,
} from "infrastructure/database/prisma-error.utils";

const MAX_ATTEMPTS = 3;
const STUCK_RECEIVED_MS = 10 * 60 * 1000;
const STUCK_CONFIRMING_MS = 10 * 60 * 1000;
const EXPIRED_PROCESSING_FAILURE_REASON = "processing claim lease expired after retry limit";
const MAX_RUN_MS = 10 * 60 * 1000;
const DB_COOLDOWN_MS = 5 * 60 * 1000;

@Injectable()
export class CallExtractionRetrySchedulerService {
    private readonly logger = new Logger(CallExtractionRetrySchedulerService.name);
    private readonly executionGuard = new SchedulerExecutionGuard({
        logger: this.logger,
        runningWarning: "[CallRetry] Previous cycle still running; skipping tick",
        staleRunError: "[CallRetry] Previous cycle exceeded max runtime",
        cooldownWarning: "[CallRetry] DB connectivity issue during retry cycle",
        maxRunMs: MAX_RUN_MS,
        cooldownMs: DB_COOLDOWN_MS,
    });

    constructor(
        private readonly prismaService: PrismaService,
        private readonly processingService: CallProcessingService,
    ) {}

    @Cron("*/10 * * * *", { timeZone: "Asia/Seoul" })
    async retryFailedExtractions(): Promise<void> {
        const runToken = this.executionGuard.tryStart();
        if (!runToken) return;

        try {
            const now = Date.now();
            const processingClaimExpiry = new Date(now - CALL_PROCESSING_CLAIM_LEASE_MS);
            const stuckReceivedThreshold = new Date(now - STUCK_RECEIVED_MS);
            const candidates = await this.prismaService.call_record.findMany({
                where: {
                    OR: [
                        { processingStatus: "FAILED", extractionRetryCount: { lt: MAX_ATTEMPTS } },
                        // crash recovery: RECEIVED rows whose fire-and-forget kickoff died
                        {
                            processingStatus: "RECEIVED",
                            createdAt: { lt: stuckReceivedThreshold },
                        },
                        // A PROCESSING row is recoverable only after its explicit lease
                        // expires.  The timestamp is nullable for pre-migration rows;
                        // those remain untouched until an operator verifies ownership.
                        {
                            processingStatus: "PROCESSING",
                            processingClaimedAt: { lt: processingClaimExpiry },
                        },
                    ],
                },
                select: {
                    id: true,
                    extractionRetryCount: true,
                    processingStatus: true,
                    processingClaimedAt: true,
                },
                orderBy: { createdAt: "asc" },
                take: 8,
            });

            if (candidates.length > 0) {
                this.logger.log(`[CallRetry] Retrying ${candidates.length} call records`);

                for (const candidate of candidates) {
                    try {
                        // Only FAILED rows need their counter incremented and status reset;
                        // stuck RECEIVED rows are already in the correct status — incrementing
                        // their attempt count would burn retries they never actually consumed.
                        if (candidate.processingStatus === "FAILED") {
                            // retryCount counts scheduler pickups, not completed extraction attempts; stuck-RECEIVED recovery (no count filter) guarantees records are never permanently lost
                            const reset = await this.prismaService.call_record.updateMany({
                                where: {
                                    id: candidate.id,
                                    processingStatus: "FAILED",
                                    extractionRetryCount: candidate.extractionRetryCount,
                                },
                                data: {
                                    extractionRetryCount: { increment: 1 },
                                    processingStatus: "RECEIVED",
                                    processingClaimedAt: null,
                                },
                            });
                            // The candidate list is a snapshot.  If another worker already
                            // claimed or retried this row, do not hand it to the processor
                            // from stale state and risk stealing its generation.
                            if (reset.count !== 1) continue;
                        } else if (candidate.processingStatus === "PROCESSING") {
                            // The query excludes NULL timestamps, but retain a guard here
                            // so a malformed/pre-migration row can never be reset by a
                            // broad scheduler update.
                            if (
                                !candidate.processingClaimedAt
                                || candidate.processingClaimedAt >= processingClaimExpiry
                            ) {
                                continue;
                            }

                            const reclaimed = await this.prismaService.call_record.updateMany({
                                where: {
                                    id: candidate.id,
                                    processingStatus: "PROCESSING",
                                    processingClaimedAt: candidate.processingClaimedAt,
                                    extractionRetryCount: candidate.extractionRetryCount,
                                },
                                data: candidate.extractionRetryCount < MAX_ATTEMPTS
                                    ? {
                                        extractionRetryCount: { increment: 1 },
                                        processingStatus: "RECEIVED",
                                        processingClaimedAt: null,
                                    }
                                    : {
                                        processingStatus: "FAILED",
                                        processingClaimedAt: null,
                                        failureReason: EXPIRED_PROCESSING_FAILURE_REASON,
                                    },
                            });

                            // The candidate list is a snapshot.  If the live owner
                            // completed or another scheduler reclaimed it first, do not
                            // invoke processing from stale state.
                            if (reclaimed.count !== 1) continue;
                            if (candidate.extractionRetryCount >= MAX_ATTEMPTS) continue;
                        }
                        await this.processingService.processCallRecord(candidate.id);
                    } catch (error) {
                        this.logger.warn(
                            `[CallRetry] Unexpected error processing candidate ${candidate.id}; skipping`,
                            error instanceof Error ? error.stack : String(error),
                        );
                    }
                }
            }

            // confirm() crashed mid-flight (Railway restart etc.): CONFIRMING drafts are
            // invisible to every list — sweep them back to PENDING so staff can re-review.
            // Under the confirm flow's ordering, clientId+CONFIRMED land in one atomic update,
            // so a swept draft never has a client silently attached; re-confirm shows the
            // phoneMatchesExistingClient warning if a client did get created.
            //
            // Compare against confirmingStartedAt (set on PENDING→CONFIRMING) rather than
            // createdAt — otherwise an in-flight confirm on a draft created hours ago would
            // be immediately eligible for revert, racing the live confirm and allowing
            // duplicate client-change application. Pre-migration CONFIRMING rows
            // (confirmingStartedAt IS NULL) fall back to createdAt so they aren't stranded.
            const staleThreshold = new Date(Date.now() - STUCK_CONFIRMING_MS);
            const sweptDrafts = await this.prismaService.client_draft.updateMany({
                where: {
                    status: "CONFIRMING",
                    OR: [
                        { confirmingStartedAt: { lt: staleThreshold } },
                        { confirmingStartedAt: null, createdAt: { lt: staleThreshold } },
                    ],
                },
                data: { status: "PENDING", confirmingStartedAt: null },
            });
            if (sweptDrafts.count > 0) {
                this.logger.warn(
                    `[CallRetry] Swept ${sweptDrafts.count} stuck CONFIRMING draft(s) back to PENDING — a confirm crashed mid-flight; check recent clients for possible orphans`,
                );
            }
        } catch (error) {
            if (isTransientPrismaConnectivityError(error)) {
                this.executionGuard.enterCooldown(summarizePrismaError(error));
                return;
            }

            this.logger.error(
                "[CallRetry] Failed to load or retry call records",
                error instanceof Error ? error.stack : String(error),
            );
        } finally {
            this.executionGuard.finish(runToken);
        }
    }
}
