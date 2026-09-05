import { Inject, Injectable, Logger } from "@nestjs/common";

import {
    EFORMSIGN_WEBHOOK_DROPPED_OUTCOMES,
    EFORMSIGN_WEBHOOK_OUTCOME,
    type EformsignWebhookOutcome,
} from "domain/constants/eformsign-webhook-outcome.constants";
import {
    EFORMSIGN_WEBHOOK_EVENT_REPOSITORY,
    IEformsignWebhookEventRepository,
} from "domain/repositories/eformsign-webhook-event.repository.interface";
import { getPrismaErrorCode } from "infrastructure/database/prisma-error.utils";

/**
 * Raw Prisma errors carry invocation metadata, so log lines must summarize
 * them instead of interpolating the error object itself.
 */
function safeDatabaseFailureSummary(error: unknown, operation = "operation"): string {
    const errorCode = getPrismaErrorCode(error);
    return errorCode
        ? `database ${operation} failed (code=${errorCode})`
        : `database ${operation} failed`;
}

export interface EformsignWebhookEventInput {
    webhookId?: string | null;
    eventType?: string | null;
    companyId?: string | null;
    documentId?: string | null;
    rawStatus?: string | null;
    statusType?: string | null;
    statusDetail?: string | null;
    sourceUpdatedDate?: Date | null;
    outcome: EformsignWebhookOutcome;
    outcomeReason?: string | null;
}

export interface EformsignWebhookEventCounts {
    received: number;
    dropped: number;
}

/** Column widths from the migration. A value longer than its column would make
 * the insert throw, and `append` swallows throws — so an over-long reason would
 * silently cost the whole row rather than its own tail. */
const COLUMN_LIMITS = {
    webhookId: 255,
    eventType: 80,
    companyId: 255,
    documentId: 255,
    rawStatus: 120,
    statusType: 8,
    statusDetail: 255,
    outcome: 40,
    outcomeReason: 500,
} as const;

function clip(value: string | null | undefined, limit: number): string | null {
    if (value === null || value === undefined) return null;
    const trimmed = value.trim();
    if (!trimmed) return null;
    return trimmed.length > limit ? trimmed.slice(0, limit) : trimmed;
}

/**
 * Append-only ledger of inbound eformsign webhooks.
 *
 * Nothing reads these rows back into domain objects, so the writer stays thin —
 * but the storage goes through a repository rather than PrismaService, because
 * application/ code importing PrismaService is a lint error and the
 * tenant-freeze allowlist takes no new entries. What the writer keeps is the
 * part that is its own: clipping to column widths, swallowing failures, and
 * deciding which outcomes count as dropped.
 */
@Injectable()
export class EformsignWebhookEventWriter {
    private readonly logger = new Logger(EformsignWebhookEventWriter.name);

    constructor(
        @Inject(EFORMSIGN_WEBHOOK_EVENT_REPOSITORY)
        private readonly repository: IEformsignWebhookEventRepository,
    ) {}

    /**
     * Never throws. A webhook that eformsign cannot get a 200 for is retried or
     * marked failed on their side, and losing the delivery to fix bookkeeping
     * would be a far worse trade than losing one ledger row.
     */
    async append(input: EformsignWebhookEventInput): Promise<void> {
        try {
            await this.repository.append({
                webhookId: clip(input.webhookId, COLUMN_LIMITS.webhookId),
                eventType: clip(input.eventType, COLUMN_LIMITS.eventType),
                companyId: clip(input.companyId, COLUMN_LIMITS.companyId),
                documentId: clip(input.documentId, COLUMN_LIMITS.documentId),
                rawStatus: clip(input.rawStatus, COLUMN_LIMITS.rawStatus),
                statusType: clip(input.statusType, COLUMN_LIMITS.statusType),
                statusDetail: clip(input.statusDetail, COLUMN_LIMITS.statusDetail),
                sourceUpdatedDate: input.sourceUpdatedDate ?? null,
                outcome: clip(input.outcome, COLUMN_LIMITS.outcome)
                    ?? EFORMSIGN_WEBHOOK_OUTCOME.UNRECORDED,
                outcomeReason: clip(input.outcomeReason, COLUMN_LIMITS.outcomeReason),
            });
        } catch (error) {
            this.logger.warn(
                `Failed to record eformsign webhook event for ${input.documentId ?? "unknown document"}: ${safeDatabaseFailureSummary(error, "append")}`,
            );
        }
    }

    /**
     * Received and dropped counts since `since`. "Received" alone is not worth
     * showing anyone — the pair is what makes a silent drop visible.
     */
    async countSince(since: Date): Promise<EformsignWebhookEventCounts> {
        try {
            const tallies = await this.repository.countByOutcomeSince(since);
            let received = 0;
            let dropped = 0;
            for (const tally of tallies) {
                received += tally.count;
                if (EFORMSIGN_WEBHOOK_DROPPED_OUTCOMES.has(tally.outcome as EformsignWebhookOutcome)) {
                    dropped += tally.count;
                }
            }
            return { received, dropped };
        } catch (error) {
            this.logger.warn(`Failed to count eformsign webhook events: ${safeDatabaseFailureSummary(error)}`);
            return { received: 0, dropped: 0 };
        }
    }

    /** Retention sweep. Returns how many rows were removed. */
    async purgeOlderThan(cutoff: Date): Promise<number> {
        return this.repository.deleteOlderThan(cutoff);
    }
}
