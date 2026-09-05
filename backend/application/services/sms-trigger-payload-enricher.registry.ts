import { Injectable } from "@nestjs/common";
import { MessageTriggerTemplateKey } from "domain/constants/message-trigger-catalog";
import { MessageTriggerJobEntity } from "domain/entities/message-trigger-job.entity";

/**
 * Fills job.payload.templateVariables right before an SMS trigger job is sent.
 * Throw SmsTriggerDeliverySkipError to cancel the job with a human-readable reason
 * instead of failing it (mirrors MissingSmsTemplateVariablesError handling).
 *
 * Not invoked at all when the job already carries a staged delivery snapshot
 * (SMS_DELIVERY_SNAPSHOT_VARIABLE) — that job's message body was already
 * resolved and approved, so sms-trigger-delivery.service.ts's sendJob skips
 * enrichment for it entirely (see hasStagedDeliverySnapshot).
 *
 * MUST be idempotent per job.id for every other job it does run for. sendJob
 * runs enrich() before SmsTriggerDeliveryService's duplicate-dispatch
 * convergence check (the acceptance-service race in sendSmsJob that lets two
 * concurrent dispatches for the same job converge on one already-accepted
 * provider row), and that check happens after enrichment because it requires
 * the resolved message snapshot enrich() itself may complete. So enrich() can
 * run for a delivery that ultimately converges onto an earlier acceptance and
 * never reaches the provider — it must not mint a second real-world side
 * effect (e.g. a second receipt link, a second external write) for the same
 * job.id when that happens; make the side effect itself idempotent per job.id
 * (upsert / find-or-create), not conditional on whether the SMS is actually
 * sent.
 */
export interface SmsTriggerPayloadEnricher {
    enrich(job: MessageTriggerJobEntity): Promise<void>;
}

export class SmsTriggerDeliverySkipError extends Error {
    constructor(
        readonly reason: string,
        message?: string,
    ) {
        super(message ?? reason);
        this.name = "SmsTriggerDeliverySkipError";
    }
}

@Injectable()
export class SmsTriggerPayloadEnricherRegistry {
    private readonly enrichers = new Map<MessageTriggerTemplateKey, SmsTriggerPayloadEnricher>();

    // register() throws on a duplicate key rather than silently overwriting — an enricher
    // registered twice almost certainly indicates two feature modules colliding on one
    // template, which should fail loudly at module-init time, not at delivery time.
    register(templateKey: MessageTriggerTemplateKey, enricher: SmsTriggerPayloadEnricher): void {
        if (this.enrichers.has(templateKey)) {
            throw new Error(`SMS payload enricher already registered for ${templateKey}`);
        }
        this.enrichers.set(templateKey, enricher);
    }

    get(templateKey: MessageTriggerTemplateKey): SmsTriggerPayloadEnricher | null {
        return this.enrichers.get(templateKey) ?? null;
    }
}
