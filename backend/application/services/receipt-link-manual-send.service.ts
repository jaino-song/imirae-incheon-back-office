import { BadRequestException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import {
    MessageTriggerEventType,
    MessageTriggerOffsetType,
    MessageTriggerRecipientType,
    MessageTriggerTemplateKey,
} from "domain/constants/message-trigger-catalog";
import { SERVICE_END_NOTICE_RULE_ID, SERVICE_END_NOTICE_SMS_TITLE } from "domain/constants/service-end-notice-message";
import { EFORMSIGN_DOC_REPOSITORY, IEformsignDocRepository } from "domain/repositories/eformsign-doc.repository.interface";
import { MessageTriggerRuleEntity } from "domain/entities/message-trigger-rule.entity";
import {
    IMessageTriggerRuleRepository,
    MESSAGE_TRIGGER_RULE_REPOSITORY,
} from "domain/repositories/message-trigger-rule.repository.interface";
import { MessageTriggerJobEntity } from "domain/entities/message-trigger-job.entity";
import { IMessageTriggerJobRepository, MESSAGE_TRIGGER_JOB_REPOSITORY } from "domain/repositories/message-trigger-job.repository.interface";
import { normalizePhone } from "application/utils/normalize-phone";
import { MessageSenderApprovalService } from "./message-sender-approval.service";
import { ReceiptLinkIssueService, ReceiptLinkSkipError } from "./receipt-link-issue.service";

export interface ManualReceiptLinkSendParams {
    branchId: string;
    documentId: string;
    userId: string | null;
}

export interface ManualReceiptLinkSendResult {
    jobId: string;
    scheduledFor: Date;
    clientName: string;
}

@Injectable()
export class ReceiptLinkManualSendService {
    constructor(
        @Inject(EFORMSIGN_DOC_REPOSITORY) private readonly docRepository: IEformsignDocRepository,
        @Inject(MESSAGE_TRIGGER_RULE_REPOSITORY) private readonly ruleRepository: IMessageTriggerRuleRepository,
        private readonly issueService: ReceiptLinkIssueService,
        @Inject(MESSAGE_TRIGGER_JOB_REPOSITORY) private readonly jobRepository: IMessageTriggerJobRepository,
        private readonly senderApproval: MessageSenderApprovalService,
    ) {}

    /**
     * Enqueues a pending job with scheduledFor = now. Delivery happens on the lease holder's
     * own minute-interval scheduler tick (MessageTriggerSchedulerService.dispatchDueJobs),
     * which picks up any due job within 60 seconds — no in-request nudge is needed or
     * attempted here.
     */
    async send(params: ManualReceiptLinkSendParams): Promise<ManualReceiptLinkSendResult> {
        await this.senderApproval.ensureApproved(params.branchId);

        // Branch-scoped lookup: a document that exists but belongs to another branch is
        // indistinguishable from a nonexistent one to this caller, by design.
        const doc = await this.docRepository.findByDocumentId(params.branchId, params.documentId);
        if (!doc) throw new NotFoundException({ reason: "document_not_found" });
        if (!doc.clientId) throw new BadRequestException({ reason: "document_not_linked", message: "계약서에 연결된 산모가 없습니다" });

        let preflight;
        try {
            preflight = await this.issueService.preflight({ branchId: params.branchId, clientId: doc.clientId });
        } catch (error) {
            if (error instanceof ReceiptLinkSkipError) {
                throw new BadRequestException({ reason: error.skipReason, message: error.message });
            }
            throw error;
        }

        const phone = normalizePhone(preflight.client.phone) ?? "";
        if (!phone) throw new BadRequestException({ reason: "missing_phone", message: "산모 연락처가 등록되지 않았습니다" });

        await this.ensureSystemRule();

        const now = new Date();
        const clientName = preflight.client.name;
        const job = MessageTriggerJobEntity.create({
            branchId: params.branchId,
            ruleId: SERVICE_END_NOTICE_RULE_ID,
            scheduledFor: now,
            clientId: preflight.client.id,
            employeeScheduleId: null,
            recipientType: MessageTriggerRecipientType.CLIENT,
            recipientPhone: phone,
            templateKey: MessageTriggerTemplateKey.SERVICE_END_NOTICE,
            dedupeKey: `${SERVICE_END_NOTICE_RULE_ID}:client:${preflight.client.id}:manual:${randomUUID()}`,
            payload: {
                clientId: preflight.client.id,
                clientName,
                memberId: `client:${preflight.client.id}`,
                recipientName: clientName,
                recipientPhone: phone,
                templateVariables: { name: clientName, clientName, phone },
            },
        });
        const saved = await this.jobRepository.upsertPending(job);

        return { jobId: saved.id, scheduledFor: now, clientName };
    }

    /** The synthetic rule row message_trigger_job.rule_id points at (mirrors service-record-link.service.ts ensureSystemRule). */
    private async ensureSystemRule(): Promise<void> {
        const now = new Date();
        const rule = new MessageTriggerRuleEntity(
            SERVICE_END_NOTICE_RULE_ID,
            null,
            SERVICE_END_NOTICE_SMS_TITLE,
            true,
            MessageTriggerEventType.SERVICE_END,
            MessageTriggerOffsetType.SAME_DAY,
            0,
            MessageTriggerRecipientType.CLIENT,
            MessageTriggerTemplateKey.SERVICE_END_NOTICE,
            now,
            now,
            false,
            false,
        );
        await this.ruleRepository.ensureSystemRule(rule);
    }
}
