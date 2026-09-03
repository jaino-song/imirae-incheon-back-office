import {
    EFORMSIGN_WEBHOOK_OUTCOME,
    type EformsignWebhookOutcome,
} from "domain/constants/eformsign-webhook-outcome.constants";
import { EformsignWebhookPayloadDto } from "interface/dto/eformsign-webhook.dto";

import type { EformsignWebhookEventInput } from "./eformsign-webhook-event.service";

/**
 * One inbound webhook's ledger row, accumulated as the service decides what to
 * do with it and written once when processing returns.
 *
 * Why an accumulator rather than a write at each exit: `processWebhook` has
 * roughly twenty early returns across five methods, and a per-exit write would
 * produce several rows for one delivery — or none, on the paths someone forgets.
 * One trace per delivery keeps the row count equal to the arrival count, which
 * is what makes "received vs dropped" arithmetic mean anything.
 *
 * The initial outcome is `unrecorded` on purpose. Defaulting to `applied` would
 * make an uninstrumented exit path indistinguishable from a successful one and
 * quietly overstate the success rate; `unrecorded` shows up as what it is, a
 * hole in this instrumentation.
 */
export class EformsignWebhookTrace {
    private readonly webhookId: string | null;
    private readonly eventType: string | null;
    private readonly companyId: string | null;
    private readonly documentId: string | null;
    private readonly rawStatus: string | null;

    private statusType: string | null = null;
    private statusDetail: string | null = null;
    private sourceUpdatedDate: Date | null = null;
    private outcome: EformsignWebhookOutcome = EFORMSIGN_WEBHOOK_OUTCOME.UNRECORDED;
    private outcomeReason: string | null = null;

    constructor(payload: EformsignWebhookPayloadDto) {
        const { webhook_id, event_type, company_id, document, ready_document_pdf, document_action } = payload;
        this.webhookId = webhook_id ?? null;
        this.eventType = event_type ?? null;
        this.companyId = company_id ?? null;
        this.documentId = document?.id
            ?? ready_document_pdf?.document_id
            ?? document_action?.document_id
            ?? null;
        this.rawStatus = document?.status ?? ready_document_pdf?.document_status ?? null;
    }

    /**
     * What mapStatus made of the vendor's status. Recorded even when the event
     * is then dropped — a raw/mapped pair that disagrees in kind is the
     * signature of a mapping defect, and it is only visible if both are stored.
     */
    mapped(statusType: string, statusDetail: string): this {
        this.statusType = statusType;
        this.statusDetail = statusDetail;
        return this;
    }

    source(sourceUpdatedDate: Date | undefined): this {
        this.sourceUpdatedDate = sourceUpdatedDate ?? null;
        return this;
    }

    /** Last call wins: the final decision is the one worth recording. */
    settle(outcome: EformsignWebhookOutcome, reason?: string | null): this {
        this.outcome = outcome;
        this.outcomeReason = reason ?? null;
        return this;
    }

    toInput(): EformsignWebhookEventInput {
        return {
            webhookId: this.webhookId,
            eventType: this.eventType,
            companyId: this.companyId,
            documentId: this.documentId,
            rawStatus: this.rawStatus,
            statusType: this.statusType,
            statusDetail: this.statusDetail,
            sourceUpdatedDate: this.sourceUpdatedDate,
            outcome: this.outcome,
            outcomeReason: this.outcomeReason,
        };
    }
}
