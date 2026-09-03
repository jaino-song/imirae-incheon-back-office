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
import { MANUAL_DEDUPE_MARKER } from "./receipt-link-delivery-enricher.service";
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
        // M4: an eformsign_doc row with no numeric id can never be pinned via preflight's
        // eformsignDocId param (see ReceiptLinkIssueService.findExplicitContractDocument), so
        // silently falling through to the auto-derivation path would pick a DIFFERENT document
        // than the one the caller is looking at — surface this explicitly instead.
        if (doc.id === undefined) {
            throw new BadRequestException({ reason: "no_contract_document", message: "선택한 문서를 찾을 수 없습니다" });
        }

        let preflight;
        try {
            preflight = await this.issueService.preflight({ branchId: params.branchId, clientId: doc.clientId, eformsignDocId: doc.id });
        } catch (error) {
            if (error instanceof ReceiptLinkSkipError) {
                throw new BadRequestException({ reason: error.skipReason, message: error.message });
            }
            throw error;
        }

        const phone = normalizePhone(preflight.client.phone) ?? "";
        if (!phone) throw new BadRequestException({ reason: "missing_phone", message: "산모 연락처가 없거나 형식이 올바르지 않습니다" });

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
            dedupeKey: `${SERVICE_END_NOTICE_RULE_ID}:client:${preflight.client.id}${MANUAL_DEDUPE_MARKER}${randomUUID()}`,
            payload: {
                clientId: preflight.client.id,
                clientName,
                memberId: `client:${preflight.client.id}`,
                recipientName: clientName,
                recipientPhone: phone,
                templateVariables: { name: clientName, clientName, phone },
                sentByUserId: params.userId,
                receiptEformsignDocId: doc.id ?? null,
            },
        });
        const saved = await this.jobRepository.upsertPending(job);

        return { jobId: saved.id, scheduledFor: now, clientName };
    }

    /**
     * Upserts the synthetic branch-less rule row `message_trigger_job.rule_id` points at.
     * Unlike its precedent (service-record-link.service.ts's ensureSystemRule), this takes no
     * automation lock and does not pre-validate the system template's required custom
     * variables — it only guarantees the fence row exists so the scheduler's rule-fence check
     * can claim the job.
     */
    private async ensureSystemRule(): Promise<void> {
        const now = new Date();
        const rule = new MessageTriggerRuleEntity(
            SERVICE_END_NOTICE_RULE_ID,
            null,
            // "(수동 발송)" makes it visibly obvious in every branch's rule list (findAll
            // includes branchId: null rows) that this row is read-only and never fires on its
            // own — a manual send is the only thing that ever writes a job against it.
            `${SERVICE_END_NOTICE_SMS_TITLE} (수동 발송)`,
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
