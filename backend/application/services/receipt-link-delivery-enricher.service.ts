import { Injectable, OnModuleInit } from "@nestjs/common";
import { MessageTriggerTemplateKey } from "domain/constants/message-trigger-catalog";
import { MessageTriggerJobEntity } from "domain/entities/message-trigger-job.entity";
import { ReceiptLinkIssueService, ReceiptLinkSkipError } from "./receipt-link-issue.service";
import { SmsTriggerPayloadEnricher, SmsTriggerPayloadEnricherRegistry } from "./sms-trigger-payload-enricher.registry";

export const MANUAL_DEDUPE_MARKER = ":manual:";

/** Issues the receipt link at delivery time so the 30-day window starts when the SMS goes out. */
@Injectable()
export class ReceiptLinkDeliveryEnricher implements SmsTriggerPayloadEnricher, OnModuleInit {
    constructor(
        private readonly registry: SmsTriggerPayloadEnricherRegistry,
        private readonly issueService: ReceiptLinkIssueService,
    ) {}

    onModuleInit(): void {
        this.registry.register(MessageTriggerTemplateKey.SERVICE_END_NOTICE, this);
    }

    async enrich(job: MessageTriggerJobEntity): Promise<void> {
        if (!job.branchId || !job.clientId) {
            throw new ReceiptLinkSkipError("no_contract_document");
        }
        const existingUrl = job.payload.templateVariables?.["receiptUrl"];
        const issued = await this.issueService.issue({
            branchId: job.branchId,
            clientId: job.clientId,
            source: job.dedupeKey.includes(MANUAL_DEDUPE_MARKER) ? "manual" : "auto_trigger",
            jobId: job.id,
            ...(typeof existingUrl === "string" && existingUrl.length > 0 ? { existingUrl } : {}),
        });
        job.payload.templateVariables["receiptUrl"] = issued.url;
        job.payload.buttonUrl = issued.url;
    }
}
