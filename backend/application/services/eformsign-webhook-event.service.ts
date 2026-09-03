import { Injectable, Logger } from "@nestjs/common";

import {
    EFORMSIGN_WEBHOOK_DROPPED_OUTCOMES,
    EFORMSIGN_WEBHOOK_OUTCOME,
    type EformsignWebhookOutcome,
} from "domain/constants/eformsign-webhook-outcome.constants";
import { PrismaService } from "infrastructure/database/prisma.service";

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
 * Modelled on AdminAuditEventWriter: a thin writer over PrismaService rather
 * than a domain repository, because nothing reads these rows back into domain
 * objects.
 */
@Injectable()
export class EformsignWebhookEventWriter {
    private readonly logger = new Logger(EformsignWebhookEventWriter.name);

    constructor(private readonly prisma: PrismaService) {}

    /**
     * Never throws. A webhook that eformsign cannot get a 200 for is retried or
     * marked failed on their side, and losing the delivery to fix bookkeeping
     * would be a far worse trade than losing one ledger row.
     */
    async append(input: EformsignWebhookEventInput): Promise<void> {
        try {
            await this.prisma.eformsign_webhook_event.create({
                data: {
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
                },
            });
        } catch (error) {
            this.logger.warn(
                `Failed to record eformsign webhook event for ${input.documentId ?? "unknown document"}: ${error}`,
            );
        }
    }

    /**
     * Received and dropped counts since `since`. "Received" alone is not worth
     * showing anyone — the pair is what makes a silent drop visible.
     */
    async countSince(since: Date): Promise<EformsignWebhookEventCounts> {
        try {
            const grouped = await this.prisma.eformsign_webhook_event.groupBy({
                by: ["outcome"],
                where: { createdAt: { gte: since } },
                _count: { _all: true },
            });
            let received = 0;
            let dropped = 0;
            for (const row of grouped) {
                const count = row._count._all;
                received += count;
                if (EFORMSIGN_WEBHOOK_DROPPED_OUTCOMES.has(row.outcome as EformsignWebhookOutcome)) {
                    dropped += count;
                }
            }
            return { received, dropped };
        } catch (error) {
            this.logger.warn(`Failed to count eformsign webhook events: ${error}`);
            return { received: 0, dropped: 0 };
        }
    }

    /** Retention sweep. Returns how many rows were removed. */
    async purgeOlderThan(cutoff: Date): Promise<number> {
        const { count } = await this.prisma.eformsign_webhook_event.deleteMany({
            where: { createdAt: { lt: cutoff } },
        });
        return count;
    }
}
