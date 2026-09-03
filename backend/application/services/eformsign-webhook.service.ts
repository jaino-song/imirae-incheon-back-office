import { Injectable, Logger, Inject, Optional } from "@nestjs/common";
import { UpdateEformsignDocStatusUsecase } from "application/usecases/eformsign-doc/update-eformsign-doc-status.usecase";
import { LinkDocumentToClientUsecase } from "application/usecases/eformsign-doc/link-document-to-client.usecase";
import { MirrorUnassignedEformsignDocUsecase } from "application/usecases/eformsign-doc/mirror-unassigned-eformsign-doc.usecase";
import {
    UNASSIGNED_FORWARD_STATUS_CODES_AFTER_REVIEW_STAGE,
    UNASSIGNED_REVIEW_STAGE_STATUS_CODES,
    UNASSIGNED_TERMINAL_STATUS_CODES,
} from "domain/constants/eformsign-doc-status.constants";
import {
    SyncClientEndDateUsecase,
    type SyncedClientEndDate,
} from "application/usecases/eformsign-doc/sync-client-end-date.usecase";
import { ReconcileCompletedMirroredEformsignDocUsecase } from "application/usecases/eformsign-doc/reconcile-completed-mirrored-eformsign-doc.usecase";
import { sanitizeEformsignErrorMessage } from "application/utils/eformsign-error-message";
import { EformsignWebhookPayloadDto } from "interface/dto/eformsign-webhook.dto";
import { EformsignDocsEventBus } from "./eformsign-docs-event-bus.service";
import { NotificationService } from "./notification.service";
import { CLIENT_REPOSITORY, IClientRepository } from "domain/repositories/client.repository.interface";
import {
    EFORMSIGN_CLIENT_REPOSITORY,
    type EformsignApiDocumentResponse,
    type IEformsignClientRepository,
} from "domain/repositories/eformsign.client.interface";
import {
    EFORMSIGN_DOC_REPOSITORY,
    EformsignDocMappingError,
    EformsignDocOwnershipConflictError,
    EformsignDocStaleUpdateError,
    IEformsignDocRepository,
} from "domain/repositories/eformsign-doc.repository.interface";
import { EMPLOYEE_SCHEDULE_REPOSITORY, IEmployeeScheduleRepository } from "domain/repositories/employee-schedule.repository.interface";
import { EMPLOYEE_REPOSITORY, IEmployeeRepository } from "domain/repositories/employee.repository.interface";
import { EformsignDocEntity, EFORMSIGN_DOCUMENT_KIND } from "domain/entities/eformsign-doc.entity";
import { normalizeEformsignStatusCode } from "domain/utils/eformsign-status-code";
import { PrismaService } from "infrastructure/database/prisma.service";
import { ServiceRecordLifecycleService } from "./service-record-lifecycle.service";
import { EformsignDocumentSnapshotService } from "./eformsign-document-snapshot.service";
import { EformsignDocumentMirrorService } from "./eformsign-document-mirror.service";
import {
    EformsignCredentialBoundary,
    createEformsignGlobalWorkerPrincipal,
    createEformsignWorkerPrincipal,
} from "./eformsign-credential-boundary.service";

/**
 * Eformsign document status codes (from document.status field)
 * Based on: https://eformsignkr.github.io/developers/help/eformsign_webhook.html
 */
const DOCUMENT_STATUS = {
    // Creation and initial states
    DOC_CREATE: "doc_create",                       // 문서 생성
    DOC_TEMPSAVE_PARTICIPANT: "doc_tempsave_participant", // 참여자 임시저장

    // Participant actions
    DOC_REQUEST_PARTICIPANT: "doc_request_participant", // 참여자 요청
    DOC_REQUEST_APPROVAL: "doc_request_approval",       // 결재 요청
    DOC_ACCEPT_PARTICIPANT: "doc_accept_participant",   // 참여자 승인
    DOC_REJECT_PARTICIPANT: "doc_reject_participant",   // 참여자 거부
    DOC_ACCEPT_OUTSIDER: "doc_accept_outsider",        // 외부자 승인

    // Approval actions
    DOC_ACCEPT_APPROVAL: "doc_accept_approval",        // 결재 승인
    DOC_REJECT_APPROVAL: "doc_reject_approval",        // 결재 거부

    // Reviewer actions (제공기관 검토) — see mapStatus for why these matter
    DOC_REQUEST_REVIEWER: "doc_request_reviewer",      // 검토 요청
    DOC_ACCEPT_REVIEWER: "doc_accept_reviewer",        // 검토 완료
    DOC_REJECT_REVIEWER: "doc_reject_reviewer",        // 검토 반려

    // Final states
    DOC_COMPLETE: "doc_complete",                   // 문서 완료
    DOC_DECLINE: "doc_decline",                     // 거부됨
    DOC_DELETED: "doc_deleted",                     // 삭제됨
    DOC_EXPIRED: "doc_expired",                     // 만료됨

    // Revocation
    DOC_REQUEST_REVOKE: "doc_request_revoke",       // 철회 요청
    DOC_REVOKE: "doc_revoke",                       // 철회됨
};

/**
 * Event types for webhook
 */
const EVENT_TYPES = {
    DOCUMENT: "document",                  // Document status change
    DOCUMENT_ACTION: "document_action",    // Document action (open, view, etc.)
    READY_DOCUMENT_PDF: "ready_document_pdf", // PDF generation complete
};

const REVIEW_REQUIRED_NOTIFICATION_TYPE = "eformsign-review-required";

type LocalDocumentLookupResult =
    | { branchId: null; document: EformsignDocEntity }
    | { branchId: string; document?: EformsignDocEntity };

export interface EformsignWebhookProcessingContext {
    mirroredDocument?: EformsignApiDocumentResponse | null;
    /**
     * The controller has already stored and validated the detail/PDF mirror.
     * Keep the live update deferred until the durable status claim succeeds.
     */
    deferCompletionEvent?: boolean;
    /**
     * Durable completion effects are owned by the generation-fenced mirror
     * reconciler, so the webhook status claim must not repeat them.
     */
    deferCompletionEffects?: boolean;
}

export type EformsignWebhookCompletionClaim =
    | "claimed"
    | "duplicate"
    | "missing"
    | "stale";

export interface EformsignWebhookProcessResult {
    completionClaim?: EformsignWebhookCompletionClaim;
    completionBranchId?: string;
    duplicateServiceRecordLifecycleChanged?: boolean;
}

const COMPLETED_STATUS_CODES = new Set(["003", "012", "022", "032", "050", "062", "072", "092"]);
const REJECTED_STATUS_CODES = new Set(["011", "021", "031", "040", "042", "045", "047", "049", "061", "071", "080", "099"]);
const REVIEW_STAGE_STATUS_DETAILS: Record<string, string> = {
    "070": "검토 요청",
    "071": "검토 반려",
    "072": "검토 완료",
};
const PROVIDER_REVIEW_STEP_TYPES = new Set(["06"]);
const PROVIDER_REVIEW_OWNER_KEYWORDS = ["제공기관", "관리자", "담당자"];
const PROVIDER_REVIEW_ACTION_KEYWORDS = ["확인", "검토"];
const CUSTOMER_STEP_KEYWORDS = ["이용자", "고객", "산모"];

@Injectable()
export class EformsignWebhookService {
    private readonly logger = new Logger(EformsignWebhookService.name);

    constructor(
        private readonly updateStatusUsecase: UpdateEformsignDocStatusUsecase,
        private readonly linkDocumentUsecase: LinkDocumentToClientUsecase,
        private readonly syncClientEndDateUsecase: SyncClientEndDateUsecase,
        private readonly eventBus: EformsignDocsEventBus,
        private readonly notificationService: NotificationService,
        @Inject(EFORMSIGN_CLIENT_REPOSITORY)
        private readonly eformsignApiClient: IEformsignClientRepository,
        private readonly credentialBoundary: EformsignCredentialBoundary,
        @Inject(CLIENT_REPOSITORY)
        private readonly clientRepository: IClientRepository,
        @Inject(EFORMSIGN_DOC_REPOSITORY)
        private readonly eformsignDocRepository: IEformsignDocRepository,
        @Inject(EMPLOYEE_SCHEDULE_REPOSITORY)
        private readonly employeeScheduleRepository: IEmployeeScheduleRepository,
        @Inject(EMPLOYEE_REPOSITORY)
        private readonly employeeRepository: IEmployeeRepository,
        private readonly mirrorUnassignedDocUsecase: MirrorUnassignedEformsignDocUsecase,
        @Optional() private readonly prisma?: PrismaService,
        @Optional() private readonly serviceRecordLifecycle?: ServiceRecordLifecycleService,
        @Optional() private readonly documentSnapshotService?: EformsignDocumentSnapshotService,
        private readonly documentMirrorService?: EformsignDocumentMirrorService,
        @Optional()
        private readonly completedMirrorReconciler?: ReconcileCompletedMirroredEformsignDocUsecase,
    ) {}

    /**
     * BJJ-247 gate: is this document the service-record snapshot template?
     * A service-record document's completion must NOT trigger contract-completion side
     * effects (link eDocId / sync endDate). Checks all configured 제공기록지 tiers
     * (BJJ-multi-tier: base 5회 + optional 10/15/20회), not just the base template —
     * no-op (returns false) when none of the 4 env vars are set, preserving existing behavior.
     */
    private isServiceRecordTemplate(templateId?: string): boolean {
        if (!templateId) return false;
        const serviceRecordTemplateIds = new Set(
            [
                process.env["EFORMSIGN_SERVICE_RECORD_TEMPLATE_ID"],
                process.env["EFORMSIGN_SERVICE_RECORD_TEMPLATE_ID_10"],
                process.env["EFORMSIGN_SERVICE_RECORD_TEMPLATE_ID_15"],
                process.env["EFORMSIGN_SERVICE_RECORD_TEMPLATE_ID_20"],
            ].filter((id): id is string => Boolean(id)),
        );
        return serviceRecordTemplateIds.has(templateId);
    }

    async processWebhook(
        payload: EformsignWebhookPayloadDto,
        context: EformsignWebhookProcessingContext = {},
    ): Promise<EformsignWebhookProcessResult | undefined> {
        const { webhook_id, document, ready_document_pdf, document_action } = payload;
        const documentId = document?.id ?? ready_document_pdf?.document_id ?? document_action?.document_id;
        if (!documentId) {
            this.logger.warn(`Ignoring webhook ${webhook_id}: missing document identifier`);
            return;
        }

        const localDocument = await this.findLocalDocument(documentId);
        if (localDocument === undefined) {
            return;
        }

        if (localDocument === null) {
            try {
                if (!context.mirroredDocument) {
                    await this.mirrorUnassignedDocUsecase.execute(
                        documentId,
                        createEformsignGlobalWorkerPrincipal("webhook"),
                    );
                    this.logger.log(
                        `Mirrored external document ${documentId} from webhook ${webhook_id} as unassigned`,
                    );
                } else {
                    await this.mirrorUnassignedDocUsecase.mirrorRemoteDocument(
                        context.mirroredDocument,
                        { fallbackDocumentId: documentId },
                    );
                    this.logger.log(
                        `Mirrored external document ${documentId} from webhook ${webhook_id} as unassigned`,
                    );
                }
            } catch (error) {
                if (error instanceof EformsignDocOwnershipConflictError) {
                    return this.retryBranchOwnedWebhookAfterOwnershipConflict(
                        payload,
                        documentId,
                        context,
                    );
                }
                if (error instanceof EformsignDocStaleUpdateError) {
                    this.logger.log(
                        `Ignoring stale webhook ${webhook_id} for unassigned document ${documentId}`,
                    );
                    return;
                }
                this.logger.warn(
                    `Failed to mirror external document ${documentId} from webhook ${webhook_id}: ` +
                    sanitizeEformsignErrorMessage(error),
                );
            }
            return;
        }

        if (localDocument.branchId === null) {
            try {
                await this.updateUnassignedDocumentFromWebhook(payload, localDocument.document);
            } catch (error) {
                if (error instanceof EformsignDocOwnershipConflictError) {
                    return this.retryBranchOwnedWebhookAfterOwnershipConflict(
                        payload,
                        documentId,
                        context,
                    );
                }
                // The row already holds state at least as new as this event. Retrying it as
                // branch-owned would apply the stale event we just refused.
                if (error instanceof EformsignDocStaleUpdateError) {
                    this.logger.log(
                        `Ignoring stale webhook ${webhook_id} for unassigned document ${documentId}`,
                    );
                    return;
                }
                this.logger.warn(
                    `Failed to update unassigned document ${documentId} from webhook ${webhook_id}: ` +
                    sanitizeEformsignErrorMessage(error),
                );
            }
            return;
        }

        return this.processBranchOwnedWebhook(
            payload,
            localDocument.branchId,
            context,
        );
    }

    async publishCompletionEvent(
        payload: EformsignWebhookPayloadDto,
        readyContext?: {
            branchId: string;
            mirroredDocument: EformsignApiDocumentResponse;
        },
    ): Promise<void> {
        const documentId = payload.document?.id ?? payload.ready_document_pdf?.document_id;
        if (!documentId) {
            return;
        }
        const status = payload.document?.status ?? payload.ready_document_pdf?.document_status;
        if (status !== DOCUMENT_STATUS.DOC_COMPLETE) {
            return;
        }

        let branchId = readyContext?.branchId;
        let mirroredDocument = readyContext?.mirroredDocument;
        if (!branchId || !mirroredDocument) {
            const localDocument = await this.findLocalDocument(documentId);
            if (!localDocument || localDocument.branchId === null) {
                return;
            }
            branchId = localDocument.branchId;
            if (
                !this.documentMirrorService
                || !(await this.documentMirrorService.isDocumentReady(documentId))
            ) {
                throw new Error(
                    `Eformsign mirror is not ready for completion publication ${documentId}`,
                );
            }
            mirroredDocument =
                await this.documentMirrorService.getStoredDetail(documentId) ?? undefined;
        }
        const mirroredStatusType = normalizeEformsignStatusCode(
            mirroredDocument?.current_status?.status_type,
        );
        if (!COMPLETED_STATUS_CODES.has(mirroredStatusType)) {
            this.logger.log(
                `Ignoring stale completion publication for ${documentId}; mirror is ${mirroredStatusType}`,
            );
            return;
        }
        // The SSE is an invalidation signal, not a status-bearing source of truth.
        // Once the controller has supplied a ready mirror snapshot, use a generic
        // reason so a tombstone or newer generation that lands before delivery
        // still triggers the correct action: refetch the current local DB state.
        const reason = readyContext
            ? "mirror:changed"
            : payload.event_type === EVENT_TYPES.READY_DOCUMENT_PDF
                ? `pdf:${status}`
                : `doc:${status}`;
        this.eventBus.emit({ branchId, documentId, reason });
    }

    async publishLocalDocumentChange(documentId: string): Promise<void> {
        const branchId = await this.eformsignDocRepository
            .findBranchIdByDocumentId(documentId);
        if (!branchId) {
            return;
        }

        // A deletion tombstone is committed locally without a fresh vendor detail.
        // Keep the SSE payload generic so clients refetch the current local state.
        this.eventBus.emit({
            branchId,
            documentId,
            reason: "mirror:changed",
        });
    }

    private async retryBranchOwnedWebhookAfterOwnershipConflict(
        payload: EformsignWebhookPayloadDto,
        documentId: string,
        context: EformsignWebhookProcessingContext,
    ): Promise<EformsignWebhookProcessResult | undefined> {
        const localDocument = await this.findLocalDocument(documentId);
        if (!localDocument || localDocument.branchId === null) {
            this.logger.warn(
                `Could not retry webhook ${payload.webhook_id} after document ${documentId} ownership changed`,
            );
            return;
        }

        this.logger.log(
            `Retrying webhook ${payload.webhook_id} through branch-owned path after document ${documentId} ownership changed`,
        );
        return this.processBranchOwnedWebhook(
            payload,
            localDocument.branchId,
            context,
        );
    }

    private async processBranchOwnedWebhook(
        payload: EformsignWebhookPayloadDto,
        branchId: string,
        context: EformsignWebhookProcessingContext,
    ): Promise<EformsignWebhookProcessResult | undefined> {
        const { event_type, webhook_id, document, ready_document_pdf } = payload;
        const resolvedBranchId = branchId;
        this.logger.log(`Processing webhook ${webhook_id}: event_type=${event_type}`);

        // Handle document events (status changes)
        if (event_type === EVENT_TYPES.DOCUMENT && document) {
            return this.handleDocumentEvent(
                resolvedBranchId,
                document,
                context.mirroredDocument,
                context.deferCompletionEvent,
                context.deferCompletionEffects,
            );
        }

        // Handle document_action events (open, view actions)
        // Note: eformsign sends action data inside the `document` object (document.action field)
        if (event_type === EVENT_TYPES.DOCUMENT_ACTION && document) {
            await this.handleDocumentActionEvent(
                resolvedBranchId,
                document,
                context.mirroredDocument,
            );
            return;
        }

        // Handle PDF ready events - also update status since it contains document_status
        if (event_type === EVENT_TYPES.READY_DOCUMENT_PDF && ready_document_pdf) {
            return this.handleReadyDocumentPdfEvent(
                resolvedBranchId,
                ready_document_pdf,
                context.mirroredDocument,
                context.deferCompletionEvent,
                context.deferCompletionEffects,
            );
        }

        this.logger.warn(`Unknown webhook event type: ${event_type}`);
        return;
    }

    /**
     * Handle ready_document_pdf event - PDF is ready and document is complete
     * This event contains document_status which we should use to update our DB
     */
    private async handleReadyDocumentPdfEvent(
        branchid: string,
        pdfEvent: NonNullable<EformsignWebhookPayloadDto["ready_document_pdf"]>,
        mirroredDocument?: EformsignApiDocumentResponse | null,
        deferCompletionEvent = false,
        deferCompletionEffects = false,
    ): Promise<EformsignWebhookProcessResult | undefined> {
        const {
            document_id: documentId,
            document_title,
            document_status: status,
            template_id,
            template_name,
            workflow_seq,
            workflow_name,
        } = pdfEvent;

        this.logger.log(`PDF ready event: ${documentId} -> status=${status}`);

        if (status === DOCUMENT_STATUS.DOC_COMPLETE) {
            const shouldReturnClaim = deferCompletionEvent || deferCompletionEffects;
            const claimResult = await this.claimDocumentCompletion(
                branchid,
                documentId,
                workflow_seq,
                workflow_name,
                "ready_document_pdf",
                document_title,
                template_name,
                webhookSourceUpdatedDate(mirroredDocument?.updated_date),
            );
            if (claimResult !== "claimed") {
                let duplicateServiceRecordLifecycleChanged = false;
                if (claimResult === "duplicate" && deferCompletionEffects) {
                    duplicateServiceRecordLifecycleChanged =
                        await this.reconcileDeferredServiceRecordSnapshotCompletion(
                            documentId,
                            template_id,
                        );
                }
                if (
                    claimResult === "duplicate"
                    && !deferCompletionEffects
                    && this.isServiceRecordTemplate(template_id)
                ) {
                    await this.handleServiceRecordSnapshotCompleted(branchid, documentId);
                }
                return shouldReturnClaim
                    ? {
                          completionClaim: claimResult,
                          completionBranchId: branchid,
                          ...(duplicateServiceRecordLifecycleChanged
                              ? { duplicateServiceRecordLifecycleChanged: true }
                              : {}),
                      }
                    : undefined;
            }

            if (deferCompletionEffects) {
                await this.reconcileDeferredServiceRecordSnapshotCompletion(
                    documentId,
                    template_id,
                );
            }
            if (!deferCompletionEffects) {
                if (this.isServiceRecordTemplate(template_id)) {
                    this.logger.log(
                        `Document ${documentId} is a service-record snapshot (template ${template_id}); skipping contract-completion side effects (BJJ-247 gate).`
                    );
                    await this.handleServiceRecordSnapshotCompleted(branchid, documentId);
                } else {
                    await this.handleCompletedDocument(
                        branchid,
                        documentId,
                        workflow_name,
                        "PDF event",
                        mirroredDocument,
                    );
                }
            }
            if (!deferCompletionEvent) {
                this.eventBus.emit({ branchId: branchid, documentId, reason: `pdf:${status}` });
            }
            return shouldReturnClaim
                ? { completionClaim: claimResult, completionBranchId: branchid }
                : undefined;
        }

        const { statusType, statusDetail } = this.mapStatus(status);
        try {
            if (!this.isCurrentMirrorStatus(mirroredDocument, statusType)) {
                return;
            }
            const applied = await this.updateStatusAndLinkClient(branchid, {
                documentId,
                statusType,
                statusDetail,
                stepType: String(workflow_seq),
                stepIndex: String(workflow_seq),
                stepName: workflow_name,
                expired: status === DOCUMENT_STATUS.DOC_EXPIRED,
                documentName: document_title,
                templateName: template_name,
                sourceUpdatedDate: webhookSourceUpdatedDate(mirroredDocument?.updated_date),
            });
            if (!applied) return;

            this.logger.log(`Document ${documentId} status updated from PDF event: ${status} -> ${statusDetail}`);
        } catch (error) {
            this.logger.warn(
                `[ready_document_pdf] Document ${documentId} not found in DB. ` +
                "Ensure frontend calls POST /eformsign-docs to create the record with clientId first. Error: " +
                sanitizeEformsignErrorMessage(error),
            );
            return;
        }

        this.eventBus.emit({ branchId: branchid, documentId, reason: `pdf:${status}` });
        return;
    }

    /**
     * Handle document_action events (when document is opened or viewed)
     * Updates status to reflect document has been opened
     * Note: eformsign sends action in document.action field (e.g., "doc_open_participant")
     */
    private async handleDocumentActionEvent(
        branchid: string,
        document: NonNullable<EformsignWebhookPayloadDto["document"]>,
        mirroredDocument?: EformsignApiDocumentResponse | null,
    ): Promise<void> {
        const {
            id: documentId,
            action,
            document_title,
            template_name,
            workflow_seq,
            workflow_name,
        } = document;

        this.logger.log(`Document action event: ${documentId} -> action=${action}`);

        // Map action type to status (opened = 서명 페이지 열림)
        const isOpenAction = action?.includes("open");
        const statusDetail = isOpenAction ? "서명 페이지 열림" : `액션: ${action}`;
        const statusType = mirroredDocument
            ? normalizeEformsignStatusCode(mirroredDocument.current_status.status_type)
            : "020";

        try {
            const applied = await this.updateStatusAndLinkClient(branchid, {
                documentId,
                statusType,
                statusDetail,
                stepType: String(workflow_seq || 0),
                stepIndex: String(workflow_seq || 0),
                stepName: workflow_name || "unknown",
                expired: false,
                documentName: document_title,
                templateName: template_name,
                sourceUpdatedDate: webhookSourceUpdatedDate(document.updated_date),
            });
            if (!applied) return;

            this.logger.log(`Document ${documentId} action recorded: ${action}`);
        } catch (error) {
            this.logger.warn(
                `[document_action] Document ${documentId} not found in DB. ` +
                "Ensure frontend calls POST /eformsign-docs to create the record first. Error: " +
                sanitizeEformsignErrorMessage(error),
            );
            return;
        }

        this.eventBus.emit({ branchId: branchid, documentId, reason: `action:${action ?? "unknown"}` });
    }

    private async handleDocumentEvent(
        branchid: string,
        document: NonNullable<EformsignWebhookPayloadDto["document"]>,
        mirroredDocument?: EformsignApiDocumentResponse | null,
        deferCompletionEvent = false,
        deferCompletionEffects = false,
    ): Promise<EformsignWebhookProcessResult | undefined> {
        const {
            id: documentId,
            status,
            document_title,
            template_id,
            template_name,
            workflow_seq,
            workflow_name,
        } = document;

        this.logger.log(`Document event: ${documentId} -> status=${status}`);

        const { statusType, statusDetail } = this.mapStatus(status);

        if (status === DOCUMENT_STATUS.DOC_COMPLETE) {
            const shouldReturnClaim = deferCompletionEvent || deferCompletionEffects;
            const claimResult = await this.claimDocumentCompletion(
                branchid,
                documentId,
                workflow_seq,
                workflow_name,
                status,
                document_title,
                template_name,
                webhookSourceUpdatedDate(document.updated_date),
            );
            if (claimResult !== "claimed") {
                let duplicateServiceRecordLifecycleChanged = false;
                if (claimResult === "duplicate" && deferCompletionEffects) {
                    duplicateServiceRecordLifecycleChanged =
                        await this.reconcileDeferredServiceRecordSnapshotCompletion(
                            documentId,
                            template_id,
                        );
                }
                if (
                    claimResult === "duplicate"
                    && !deferCompletionEffects
                    && this.isServiceRecordTemplate(template_id)
                ) {
                    await this.handleServiceRecordSnapshotCompleted(branchid, documentId);
                }
                return shouldReturnClaim
                    ? {
                          completionClaim: claimResult,
                          completionBranchId: branchid,
                          ...(duplicateServiceRecordLifecycleChanged
                              ? { duplicateServiceRecordLifecycleChanged: true }
                              : {}),
                      }
                    : undefined;
            }
            if (deferCompletionEffects) {
                await this.reconcileDeferredServiceRecordSnapshotCompletion(
                    documentId,
                    template_id,
                );
            }
        } else {
            try {
                if (!this.isCurrentMirrorStatus(mirroredDocument, statusType)) {
                    return;
                }
                const applied = await this.updateStatusAndLinkClient(branchid, {
                    documentId,
                    statusType,
                    statusDetail,
                    stepType: String(workflow_seq),
                    stepIndex: String(workflow_seq),
                    stepName: workflow_name,
                    expired: status === DOCUMENT_STATUS.DOC_EXPIRED,
                    documentName: document_title,
                    templateName: template_name,
                    sourceUpdatedDate: webhookSourceUpdatedDate(document.updated_date),
                });
                if (!applied) return;

                this.logger.log(`Document ${documentId} status updated: ${status} -> ${statusDetail}`);
            } catch (error) {
                this.logger.warn(
                    `[${status}] Document ${documentId} not found in DB. ` +
                    "Ensure frontend calls POST /eformsign-docs to create the record with clientId first. Error: " +
                    sanitizeEformsignErrorMessage(error),
                );
                return;
            }
        }

        await this.notifyReviewRequiredIfNeeded(
            branchid,
            documentId,
            document_title,
            statusType,
            mirroredDocument,
        );

        if (status === DOCUMENT_STATUS.DOC_COMPLETE && !deferCompletionEffects) {
            if (this.isServiceRecordTemplate(template_id)) {
                this.logger.log(
                    `Document ${documentId} is a service-record snapshot (template ${template_id}); skipping contract-completion side effects (BJJ-247 gate).`
                );
                await this.handleServiceRecordSnapshotCompleted(branchid, documentId);
            } else {
                await this.handleCompletedDocument(
                    branchid,
                    documentId,
                    workflow_name,
                    "document event",
                    mirroredDocument,
                );
            }
        }

        if (status !== DOCUMENT_STATUS.DOC_COMPLETE || !deferCompletionEvent) {
            this.eventBus.emit({ branchId: branchid, documentId, reason: `doc:${status}` });
        }
        return status === DOCUMENT_STATUS.DOC_COMPLETE
            && (deferCompletionEvent || deferCompletionEffects)
            ? { completionClaim: "claimed", completionBranchId: branchid }
            : undefined;
    }

    private async claimDocumentCompletion(
        branchid: string,
        documentId: string,
        workflowSeq: number,
        workflowName: string,
        source: string,
        documentName?: string,
        templateName?: string,
        sourceUpdatedDate?: Date,
    ): Promise<EformsignWebhookCompletionClaim> {
        const claimResult = await this.eformsignDocRepository.claimCompletionStatus(branchid, {
            documentId,
            statusType: "050",
            statusDetail: "완료",
            stepType: String(workflowSeq),
            stepIndex: String(workflowSeq),
            stepName: workflowName,
            expired: false,
            sourceUpdatedDate,
            documentName: documentName?.trim() || undefined,
            templateName: templateName?.trim() || undefined,
        });

        if (claimResult === "claimed") {
            await this.bumpDocumentSnapshotVersion(branchid);
            this.logger.log(`Document ${documentId} completion claimed from ${source}`);
            return "claimed";
        }

        if (claimResult === "duplicate") {
            this.logger.log(`Duplicate completion webhook ignored for document ${documentId} (${source})`);
            return "duplicate";
        }

        if (claimResult === "stale") {
            this.logger.log(`Ignoring stale completion webhook for document ${documentId} (${source})`);
            return "stale";
        }

        this.logger.warn(
            `[${source}] Document ${documentId} not found in DB. ` +
            "Ensure frontend calls POST /eformsign-docs to create the record with clientId first."
        );
        return "missing";
    }

    private async updateStatusAndLinkClient(
        branchid: string,
        params: Parameters<UpdateEformsignDocStatusUsecase["execute"]>[1],
    ): Promise<boolean> {
        const { document: updated, applied } =
            await this.updateStatusUsecase.executeWithOutcome(branchid, params);
        if (
            !applied
            || updated.statusType !== params.statusType
            || (
                params.sourceUpdatedDate
                && updated.updatedDate.getTime() > params.sourceUpdatedDate.getTime()
            )
        ) {
            this.logger.log(`Ignoring stale status webhook for ${params.documentId}`);
            return false;
        }
        await this.bumpDocumentSnapshotVersion(branchid);
        try {
            await this.linkDocumentUsecase.execute(branchid, params.documentId);
        } catch (error) {
            this.logger.warn(
                `Failed to keep client linked for document ${params.documentId}: ` +
                sanitizeEformsignErrorMessage(error),
            );
        }
        return true;
    }

    private async bumpDocumentSnapshotVersion(branchId: string): Promise<void> {
        if (!branchId) return;

        try {
            await this.documentSnapshotService?.bumpVersion(branchId);
        } catch {
            // 캐시 무효화 실패가 웹훅 상태 동기화 성공을 되돌리면 안 된다.
        }
    }

    private async handleCompletedDocument(
        branchid: string,
        documentId: string,
        workflowName: string,
        source: string,
        mirroredDocument?: EformsignApiDocumentResponse | null,
    ): Promise<void> {
        const doc = await this.eformsignDocRepository.findByDocumentId(branchid, documentId);
        if (doc?.documentKind === EFORMSIGN_DOCUMENT_KIND.SERVICE_RECORD_SNAPSHOT) {
            this.logger.log(
                `Document ${documentId} is a service-record snapshot row; skipping contract-completion side effects (${source}).`,
            );
            await this.handleServiceRecordSnapshotCompleted(branchid, documentId);
            return;
        }

        this.logger.log(`Document ${documentId} completed (${source}), linking to client`);

        try {
            await this.linkDocumentUsecase.execute(branchid, documentId);
            this.logger.log(`Document ${documentId} successfully linked to client`);

            if (mirroredDocument && this.completedMirrorReconciler) {
                await this.completedMirrorReconciler.syncLinkedContract({
                    branchId: branchid,
                    documentId,
                    detail: mirroredDocument,
                });
            } else {
                try {
                    const persist = this.serviceRecordLifecycle
                        ? {
                            persist: (target: SyncedClientEndDate) =>
                                this.serviceRecordLifecycle!.syncEndDateFromContract({
                                    branchId: branchid,
                                    clientId: target.clientId,
                                    endDate: target.endDate,
                                }),
                        }
                        : {};
                    if (mirroredDocument) {
                        await this.syncClientEndDateUsecase.executeFromDocument(
                            branchid,
                            documentId,
                            mirroredDocument,
                            persist,
                        );
                    } else {
                        await this.credentialBoundary.withCredentials(
                            createEformsignWorkerPrincipal(branchid),
                            "document.read",
                            ({ accessToken }) => this.syncClientEndDateUsecase.execute(
                                branchid,
                                documentId,
                                accessToken,
                                persist,
                            ),
                        );
                    }
                } catch (error) {
                    this.logger.error(
                        `Failed to sync end date for document ${documentId}: ${sanitizeEformsignErrorMessage(error)}`,
                    );
                }
            }

        } catch (error) {
            this.logger.error(
                `Failed to link document ${documentId} to client: ${sanitizeEformsignErrorMessage(error)}`,
            );
        }
    }

    private async handleServiceRecordSnapshotCompleted(
        branchId: string,
        documentId: string,
    ): Promise<void> {
        if (!this.serviceRecordLifecycle) return;
        const completed = await this.serviceRecordLifecycle
            .completeServiceRecordSnapshotIfReady({ branchId, documentId });
        if (completed) {
            this.logger.log(`Service record documents completed for document=${documentId}`);
        }
    }

    private async reconcileDeferredServiceRecordSnapshotCompletion(
        documentId: string,
        templateId?: string,
    ): Promise<boolean> {
        if (!this.isServiceRecordTemplate(templateId) || !this.completedMirrorReconciler) {
            return false;
        }
        const lifecycleChanged = await this.completedMirrorReconciler
            .reconcileServiceRecordSnapshotCompletion(documentId);
        if (lifecycleChanged === null) {
            throw new Error(
                `Eformsign mirror is not ready for service-record completion ${documentId}`,
            );
        }

        return lifecycleChanged;
    }

    // 클라이언트에 배정된 담당 직원 이름을 조회
    private async getEmployeeNameForClient(branchId: string, clientId: number): Promise<string> {
        try {
            const schedules = await this.employeeScheduleRepository.findByClientId(branchId, clientId);
            const activeSchedule = schedules.find(s => !s.replaced);
            if (!activeSchedule) return "담당자";

            const employee = await this.employeeRepository.findById(branchId, activeSchedule.primaryEmployeeId);
            return employee?.name ?? "담당자";
        } catch {
            return "담당자";
        }
    }

    private formatDate(date: Date): string {
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, "0");
        const day = String(date.getDate()).padStart(2, "0");
        return `${year}-${month}-${day}`;
    }

    private async findLocalDocument(
        documentId: string,
    ): Promise<LocalDocumentLookupResult | null | undefined> {
        try {
            const localDocument = await this.eformsignDocRepository.findByDocumentIdUnscoped(documentId);
            if (!localDocument) {
                return localDocument;
            }
            if (localDocument.branchId === null) {
                return {
                    branchId: null,
                    document: localDocument.document,
                };
            }
            return {
                branchId: localDocument.branchId,
                document: localDocument.document,
            };
        } catch (error) {
            if (!(error instanceof EformsignDocMappingError)) {
                this.logger.warn(
                    `Failed to query local document ${documentId}: ` +
                    sanitizeEformsignErrorMessage(error),
                );
                return undefined;
            }

            this.logger.warn(
                `Failed to map local document ${documentId}; falling back to branch-only lookup: ` +
                sanitizeEformsignErrorMessage(error.originalError),
            );
            try {
                const branchId = await this.eformsignDocRepository.findBranchIdByDocumentId(documentId);
                if (!branchId) {
                    this.logger.warn(
                        `Cannot process unmapped unassigned document ${documentId} without a domain entity`,
                    );
                    return undefined;
                }
                return { branchId };
            } catch (fallbackError) {
                this.logger.warn(
                    `Failed branch-only lookup for document ${documentId}: ` +
                    sanitizeEformsignErrorMessage(fallbackError),
                );
                return undefined;
            }
        }
    }

    private async updateUnassignedDocumentFromWebhook(
        payload: EformsignWebhookPayloadDto,
        existing: EformsignDocEntity,
    ): Promise<void> {
        const { event_type, webhook_id, document, ready_document_pdf } = payload;
        let statusType: string;
        let statusDetail: string;
        let stepType: string;
        let stepIndex: string;
        let stepName: string;
        let updatedTimestamp: number | undefined;
        let documentName: string | undefined;
        let templateId: string | undefined;
        let templateName: string | undefined;
        let expired: boolean;

        if (event_type === EVENT_TYPES.DOCUMENT && document) {
            ({ statusType, statusDetail } = this.mapUnassignedStatus(document.status));
            stepType = String(document.workflow_seq);
            stepIndex = String(document.workflow_seq);
            stepName = document.workflow_name;
            updatedTimestamp = document.updated_date;
            documentName = document.document_title?.trim() || undefined;
            templateId = document.template_id?.trim() || undefined;
            templateName = document.template_name?.trim() || undefined;
            expired = document.status === DOCUMENT_STATUS.DOC_EXPIRED;
        } else if (event_type === EVENT_TYPES.DOCUMENT_ACTION && document) {
            const isOpenAction = document.action?.includes("open");
            statusType = "020";
            statusDetail = isOpenAction ? "서명 페이지 열림" : `액션: ${document.action}`;
            stepType = String(document.workflow_seq || 0);
            stepIndex = String(document.workflow_seq || 0);
            stepName = document.workflow_name || "unknown";
            updatedTimestamp = document.updated_date;
            documentName = document.document_title?.trim() || undefined;
            templateId = document.template_id?.trim() || undefined;
            templateName = document.template_name?.trim() || undefined;
            expired = false;
        } else if (event_type === EVENT_TYPES.READY_DOCUMENT_PDF && ready_document_pdf) {
            ({ statusType, statusDetail } = this.mapUnassignedStatus(ready_document_pdf.document_status));
            stepType = String(ready_document_pdf.workflow_seq);
            stepIndex = String(ready_document_pdf.workflow_seq);
            stepName = ready_document_pdf.workflow_name;
            documentName = ready_document_pdf.document_title?.trim() || undefined;
            templateId = ready_document_pdf.template_id?.trim() || undefined;
            templateName = ready_document_pdf.template_name?.trim() || undefined;
            expired = ready_document_pdf.document_status === DOCUMENT_STATUS.DOC_EXPIRED;
        } else {
            this.logger.warn(
                `Unknown webhook event type for unassigned document ${existing.documentId}: ${event_type}`,
            );
            return;
        }

        if (
            updatedTimestamp !== undefined
            && updatedTimestamp < existing.updatedDate.getTime()
        ) {
            this.logger.log(
                `Ignoring stale webhook ${webhook_id} for ${existing.documentId}: event timestamp ${updatedTimestamp} precedes stored updatedDate ${existing.updatedDate.getTime()}`,
            );
            return;
        }

        if (
            UNASSIGNED_REVIEW_STAGE_STATUS_CODES.has(existing.statusType)
            && statusType !== existing.statusType
            && !UNASSIGNED_FORWARD_STATUS_CODES_AFTER_REVIEW_STAGE.has(statusType)
        ) {
            this.logger.log(
                `ignoring backward transition ${statusType} after ${existing.statusType} for ${existing.documentId}`,
            );
            return;
        }

        if (
            UNASSIGNED_TERMINAL_STATUS_CODES.has(existing.statusType)
            && !UNASSIGNED_TERMINAL_STATUS_CODES.has(statusType)
        ) {
            this.logger.log(`ignoring stale downgrade ${statusType} for ${existing.documentId}`);
            return;
        }

        const updatedDate = updatedTimestamp === undefined
            ? existing.updatedDate
            : new Date(Math.max(updatedTimestamp, existing.createdDate.getTime()));
        const updated = EformsignDocEntity.reconstitute({
            ...existing.toJSON(),
            documentName: documentName ?? null,
            templateId: templateId ?? null,
            templateName: templateName ?? null,
            updatedDate,
            statusType,
            statusDetail,
            stepType,
            stepIndex,
            stepName,
            expired,
        });
        // A webhook carries no creation time; this entity copies it from the row we just
        // read. Writing it back would undo a creation-time repair the nightly sweep made
        // between that read and this write, and put the list's sort key wrong again.
        await this.eformsignDocRepository.upsertUnassignedByDocumentId(updated, {
            updateCreatedDate: false,
        });
        await this.bumpCompanySnapshotEpoch();
        this.logger.log(
            `Updated unassigned document ${existing.documentId} from webhook ${webhook_id}: event_type=${event_type}`,
        );
    }

    private async bumpCompanySnapshotEpoch(): Promise<void> {
        try {
            await this.documentSnapshotService?.bumpCompanyEpoch();
        } catch {
            // The local document write remains authoritative when cache invalidation
            // is temporarily unavailable.
        }
    }

    private mapUnassignedStatus(status: string): { statusType: string; statusDetail: string } {
        const statusType = normalizeEformsignStatusCode(status);
        const statusDetail = REVIEW_STAGE_STATUS_DETAILS[statusType];
        if (statusDetail) {
            return { statusType, statusDetail };
        }

        return this.mapStatus(status);
    }

    private isReviewRequiredStatus(
        currentStatus: EformsignApiDocumentResponse["current_status"] | null | undefined
    ): boolean {
        const statusCode = normalizeEformsignStatusCode(currentStatus?.status_type);
        if (COMPLETED_STATUS_CODES.has(statusCode) || REJECTED_STATUS_CODES.has(statusCode)) {
            return false;
        }

        return this.isProviderReviewStep(currentStatus);
    }

    private isProviderReviewStep(
        currentStatus: EformsignApiDocumentResponse["current_status"] | null | undefined
    ): boolean {
        const stepType = currentStatus?.step_type?.trim() ?? "";
        const stepName = currentStatus?.step_name?.trim() ?? "";

        if (PROVIDER_REVIEW_STEP_TYPES.has(stepType)) {
            return true;
        }
        if (!stepName) {
            return false;
        }
        if (CUSTOMER_STEP_KEYWORDS.some((keyword) => stepName.includes(keyword))) {
            return false;
        }

        const hasProviderOwner = PROVIDER_REVIEW_OWNER_KEYWORDS.some((keyword) => stepName.includes(keyword));
        const hasReviewAction = PROVIDER_REVIEW_ACTION_KEYWORDS.some((keyword) => stepName.includes(keyword));
        return hasProviderOwner && hasReviewAction;
    }

    private async notifyReviewRequiredIfNeeded(
        branchid: string,
        documentId: string,
        documentTitle: string,
        localStatusType: string,
        mirroredDocument?: EformsignApiDocumentResponse | null,
    ): Promise<void> {
        // A cheap pre-filter that avoids a vendor read on irrelevant events;
        // isReviewRequiredStatus below is the real test. 070 belongs here now
        // that mapStatus projects the reviewer request as 070 instead of
        // collapsing it to 060 — without it the fix would silently take the
        // "검토 필요" push away from the very event that needs it. 071/072 stay
        // out: isReviewRequiredStatus rejects them as terminal anyway.
        if (localStatusType !== "060" && localStatusType !== "070") {
            return;
        }

        try {
            const document = mirroredDocument ?? await this.credentialBoundary.withCredentials(
                createEformsignWorkerPrincipal(branchid),
                "document.read",
                ({ accessToken }) => this.eformsignApiClient.getDocument(
                    accessToken,
                    documentId,
                ),
            );

            if (!this.isReviewRequiredStatus(document.current_status)) {
                return;
            }

            const title = "전자문서 검토 필요";
            const body = `${documentTitle || "전자문서"} 검토가 필요합니다. 최종 확인을 진행해 주세요.`;
            const data = {
                type: REVIEW_REQUIRED_NOTIFICATION_TYPE,
                documentId,
                url: `/contracts?documentId=${encodeURIComponent(documentId)}`,
            };

            const result = await this.notificationService.sendToBranchUsers(
                branchid,
                title,
                body,
                data,
                {
                    dedupe: {
                        type: REVIEW_REQUIRED_NOTIFICATION_TYPE,
                        documentId,
                    },
                },
            );
            this.logger.log(
                `Review-required notification for document ${documentId}: ${result.sent} sent, ${result.failed} failed`,
            );
        } catch (error) {
            this.logger.warn(
                `Failed to send review-required notification for document ${documentId}: ` +
                sanitizeEformsignErrorMessage(error),
            );
        }
    }

    private isCurrentMirrorStatus(
        mirroredDocument: EformsignApiDocumentResponse | null | undefined,
        webhookStatusType: string,
    ): boolean {
        if (!mirroredDocument) return true;
        const mirroredStatusType = normalizeEformsignStatusCode(
            mirroredDocument.current_status.status_type,
        );
        if (mirroredStatusType === webhookStatusType) return true;
        this.logger.log(
            `Ignoring stale PDF webhook status ${webhookStatusType}; mirror is ${mirroredStatusType}`,
        );
        return false;
    }

    private mapStatus(status: string): { statusType: string; statusDetail: string } {
        switch (status) {
            // Completed states
            case DOCUMENT_STATUS.DOC_COMPLETE:
                return { statusType: "050", statusDetail: "완료" };
            case DOCUMENT_STATUS.DOC_EXPIRED:
                return { statusType: "080", statusDetail: "만료" };

            // Rejected/Declined states
            case DOCUMENT_STATUS.DOC_REJECT_PARTICIPANT:
            case DOCUMENT_STATUS.DOC_REJECT_APPROVAL:
            case DOCUMENT_STATUS.DOC_DECLINE:
                return { statusType: "080", statusDetail: "거부" };

            // Revoked/Deleted states
            case DOCUMENT_STATUS.DOC_REVOKE:
            case DOCUMENT_STATUS.DOC_REQUEST_REVOKE:
                return { statusType: "090", statusDetail: "철회" };
            case DOCUMENT_STATUS.DOC_DELETED:
                return { statusType: "049", statusDetail: "삭제됨" };

            // Created state
            case DOCUMENT_STATUS.DOC_CREATE:
                return { statusType: "010", statusDetail: "생성됨" };

            // In-progress states (pending action)
            case DOCUMENT_STATUS.DOC_REQUEST_PARTICIPANT:
                return { statusType: "060", statusDetail: "서명 요청됨" };
            case DOCUMENT_STATUS.DOC_REQUEST_APPROVAL:
                return { statusType: "060", statusDetail: "결재 요청됨" };
            case DOCUMENT_STATUS.DOC_ACCEPT_PARTICIPANT:
            case DOCUMENT_STATUS.DOC_ACCEPT_OUTSIDER:
                return { statusType: "060", statusDetail: "서명 진행중" };
            case DOCUMENT_STATUS.DOC_ACCEPT_APPROVAL:
                return { statusType: "060", statusDetail: "결재 승인" };
            case DOCUMENT_STATUS.DOC_TEMPSAVE_PARTICIPANT:
                return { statusType: "060", statusDetail: "임시 저장" };

            // Reviewer stage (제공기관 검토). These fell through to the default
            // below, which collapses every unknown status to 060 — so a branch
            // owned row could not reach 070 through a webhook at all, and once
            // the mirror had advanced to 070 the resulting 060 update was
            // discarded as stale by isCurrentMirrorStatus. The projection then
            // sat at the participant stage for the whole review, and only the
            // 6-hourly reconcile sweep ever corrected it. Codes match
            // normalizeEformsignStatusCode's table; details match
            // REVIEW_STAGE_STATUS_DETAILS, shared with mapUnassignedStatus so the
            // two paths cannot label the same stage differently.
            case DOCUMENT_STATUS.DOC_REQUEST_REVIEWER:
            case DOCUMENT_STATUS.DOC_ACCEPT_REVIEWER:
            case DOCUMENT_STATUS.DOC_REJECT_REVIEWER: {
                const statusType = normalizeEformsignStatusCode(status);
                return {
                    statusType,
                    statusDetail: REVIEW_STAGE_STATUS_DETAILS[statusType] ?? status,
                };
            }

            // Default - pending
            default:
                this.logger.warn(`Unknown document status: ${status}`);
                return { statusType: "060", statusDetail: status };
        }
    }
}

function webhookSourceUpdatedDate(timestamp: unknown): Date | undefined {
    if (typeof timestamp !== "number" || !Number.isFinite(timestamp)) {
        return undefined;
    }
    const date = new Date(timestamp);
    return Number.isNaN(date.getTime()) ? undefined : date;
}
