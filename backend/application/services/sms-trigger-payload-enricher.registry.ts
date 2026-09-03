import { Injectable } from "@nestjs/common";
import { MessageTriggerTemplateKey } from "domain/constants/message-trigger-catalog";
import { MessageTriggerJobEntity } from "domain/entities/message-trigger-job.entity";

/**
 * Fills job.payload.templateVariables right before an SMS trigger job is sent.
 * Throw SmsTriggerDeliverySkipError to cancel the job with a human-readable reason
 * instead of failing it (mirrors MissingSmsTemplateVariablesError handling).
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
