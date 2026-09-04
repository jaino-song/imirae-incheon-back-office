import { Injectable, OnModuleInit, Optional } from "@nestjs/common";
import { MessageTriggerTemplateKey } from "domain/constants/message-trigger-catalog";
import { MessageTriggerJobEntity } from "domain/entities/message-trigger-job.entity";
import { ReceiptLinkIssueService, ReceiptLinkSkipError } from "./receipt-link-issue.service";
import { ReceiptLinkTokenService } from "./receipt-link-token.service";
import {
    SmsTriggerDeliverySkipError,
    SmsTriggerPayloadEnricher,
    SmsTriggerPayloadEnricherRegistry,
} from "./sms-trigger-payload-enricher.registry";

export const MANUAL_DEDUPE_MARKER = ":manual:";

/** Issues the receipt link at delivery time so the 30-day window starts when the SMS goes out. */
@Injectable()
export class ReceiptLinkDeliveryEnricher implements SmsTriggerPayloadEnricher, OnModuleInit {
    constructor(
        private readonly registry: SmsTriggerPayloadEnricherRegistry,
        private readonly issueService: ReceiptLinkIssueService,
        @Optional()
        private readonly tokenService?: ReceiptLinkTokenService,
    ) {}

    onModuleInit(): void {
        this.registry.register(MessageTriggerTemplateKey.SERVICE_END_NOTICE, this);
    }

    async enrich(job: MessageTriggerJobEntity): Promise<void> {
        if (!job.branchId || !job.clientId) {
            throw new ReceiptLinkSkipError("no_contract_document");
        }
        const existingUrl = job.payload.templateVariables?.["receiptUrl"];
        const receiptEformsignDocId = job.payload.receiptEformsignDocId;
        const issued = await this.issueService.issue({
            branchId: job.branchId,
            clientId: job.clientId,
            source: job.dedupeKey.includes(MANUAL_DEDUPE_MARKER) ? "manual" : "auto_trigger",
            jobId: job.id,
            createdBy: job.payload.sentByUserId ?? null,
            ...(typeof receiptEformsignDocId === "number" ? { eformsignDocId: receiptEformsignDocId } : {}),
            ...(typeof existingUrl === "string" && existingUrl.length > 0 ? { existingUrl } : {}),
        });
        job.payload.templateVariables["receiptUrl"] = issued.url;
        job.payload.buttonUrl = issued.url;
    }

    async validateStagedSnapshot(job: MessageTriggerJobEntity): Promise<void> {
        const receiptUrl = job.payload.templateVariables["receiptUrl"];
        let linkToken: string | undefined;
        try {
            const match = receiptUrl
                ? new URL(receiptUrl).pathname.match(/^\/receipt\/(efr_[A-Za-z0-9_-]+)\/?$/)
                : null;
            linkToken = match?.[1];
        } catch {
            linkToken = undefined;
        }
        if (!linkToken || !this.tokenService) {
            throw new SmsTriggerDeliverySkipError(
                "receipt_link_unusable",
                "승인된 영수증 링크가 만료되었거나 취소되어 재시도하지 않았습니다",
            );
        }
        const status = await this.tokenService.getStatus(linkToken, new Date());
        if (!status.ok) {
            throw new SmsTriggerDeliverySkipError(
                "receipt_link_unusable",
                "승인된 영수증 링크가 만료되었거나 취소되어 재시도하지 않았습니다",
            );
        }
    }
}
