import { Inject, Injectable, Logger, Optional } from "@nestjs/common";
import { ContractDataDto } from "application/dto/contract.dto";
import { EformsignService } from "application/services/eformsign.service";
import { EformsignHeadlessService } from "infrastructure/automation/eformsign-headless.service";
import { AreaTemplateService } from "application/services/area-template.service";
import { CLIENT_REPOSITORY, IClientRepository } from "domain/repositories/client.repository.interface";
import { EFORMSIGN_DOC_REPOSITORY, IEformsignDocRepository } from "domain/repositories/eformsign-doc.repository.interface";
import { EFORMSIGN_DOCUMENT_KIND } from "domain/entities/eformsign-doc.entity";
import { GetEformsignAccessTokenUsecase } from "./get-eformsign-access-token.usecase";
import { CreateEformsignDocUsecase } from "./create-eformsign-doc.usecase";
import { FetchEformsignDocFromApiUsecase } from "./fetch-eformsign-doc-from-api.usecase";
import { FetchAllEformsignDocsFromApiUsecase } from "./fetch-all-eformsign-docs-from-api.usecase";
import { EformsignHeadlessProgressService } from "application/services/eformsign-headless-progress.service";
import type { EformsignHeadlessProgressStep } from "application/services/eformsign-headless-progress.service";
import { ContractClientAssignmentGuardService } from "application/services/contract-client-assignment-guard.service";
import { eformsignExpiryDateFromRemainingDays } from "domain/utils/eformsign-expiry-date";
import {
    EformsignOperationAlreadyRunningError,
    EformsignOperationLease,
    EformsignOperationLockService,
    EformsignOperationLockUnavailableError,
} from "infrastructure/locking/eformsign-operation-lock.service";

const DEFAULT_DOCUMENT_EXPIRY_MS = 30 * 24 * 60 * 60 * 1000;
const COMPLETED_STATUS_CODES = new Set(["003", "012", "022", "032", "050", "062", "072", "092"]);
const REJECTED_STATUS_CODES = new Set(["011", "021", "031", "040", "042", "045", "047", "049", "061", "071", "080"]);
const TERMINAL_STATUS_CODES = new Set([...COMPLETED_STATUS_CODES, ...REJECTED_STATUS_CODES, "090", "099"]);
const DUPLICATE_WINDOW_MS = 10 * 60 * 1000;
const CREATED_DOCUMENT_RETRY_DELAYS_MS = [0, 500, 1_000, 2_000, 4_000, 8_000] as const;
// Leave 40s beneath the 170s proxy ceiling for the final status read and local
// persistence after a remote document has been identified.
const HEADLESS_CREATE_RECONCILIATION_DEADLINE_MS = 130_000;
const CREATED_DOCUMENT_DETAIL_READ_TIMEOUT_MS = 5_000;

class CreatedDocumentReconciliationDeadlineError extends Error {}

export interface DispatchHeadlessParams {
    contractData: ContractDataDto;
    clientId: number;
    progressId?: string;
    force?: boolean;
    onProgress?: (step: EformsignHeadlessProgressStep) => void | Promise<void>;
}

export interface DispatchHeadlessSuccess {
    ok: true;
    documentId: string;
    durationMs: number;
}

export interface DispatchHeadlessFailure {
    ok: false;
    reason: string;
    fallbackHint?: "iframe" | "adopt" | "manual_check" | "adopt-or-manual";
    durationMs: number;
    failedStep?: EformsignHeadlessProgressStep;
    remoteDocumentId?: string;
    existingDocumentId?: string;
}

export type DispatchHeadlessResult = DispatchHeadlessSuccess | DispatchHeadlessFailure;

interface CreatedDocumentStatus {
    statusType: string;
    statusDetail: string;
    stepType: string;
    stepIndex: string;
    stepName: string;
    expiredDate: Date;
    templateName?: string;
}

/**
 * Backend-driven creation flow:
 *   1. Build the SDK option payload (same as the iframe path).
 *   2. Hand it to EformsignHeadlessService, which loads the SDK in a hidden
 *      Chromium and walks the iframe gate sequence.
 *   3. On success, persist a doc record. On failure, return a fallback hint
 *      so the frontend can re-open the iframe modal.
 */
@Injectable()
export class DispatchDocumentHeadlessUsecase {
    private readonly logger = new Logger(DispatchDocumentHeadlessUsecase.name);

    constructor(
        private readonly eformsignService: EformsignService,
        private readonly headlessService: EformsignHeadlessService,
        private readonly areaTemplateService: AreaTemplateService,
        private readonly getAccessTokenUsecase: GetEformsignAccessTokenUsecase,
        private readonly createEformsignDocUsecase: CreateEformsignDocUsecase,
        private readonly fetchEformsignDocFromApiUsecase: FetchEformsignDocFromApiUsecase,
        private readonly progressService: EformsignHeadlessProgressService,
        @Inject(CLIENT_REPOSITORY) private readonly clientRepository: IClientRepository,
        private readonly assignmentGuard: ContractClientAssignmentGuardService,
        @Inject(EFORMSIGN_DOC_REPOSITORY) private readonly eformsignDocRepository: IEformsignDocRepository,
        private readonly fetchAllEformsignDocsFromApiUsecase: FetchAllEformsignDocsFromApiUsecase,
        @Optional() private readonly operationLock?: EformsignOperationLockService,
    ) {}

    async execute(branchId: string, params: DispatchHeadlessParams): Promise<DispatchHeadlessResult> {
        if (!this.operationLock) {
            return this.executeUnlocked(branchId, params);
        }
        const start = Date.now();
        try {
            return await this.operationLock.runExclusive(
                `create:${branchId}:${params.clientId}`,
                (lease) => this.executeUnlocked(branchId, params, lease),
            );
        } catch (error) {
            if (error instanceof EformsignOperationAlreadyRunningError) {
                return {
                    ok: false,
                    reason: "operation_in_progress",
                    fallbackHint: "manual_check",
                    durationMs: Date.now() - start,
                };
            }
            if (error instanceof EformsignOperationLockUnavailableError) {
                this.logger.error(error.message);
                return {
                    ok: false,
                    reason: "operation_lock_unavailable",
                    fallbackHint: "manual_check",
                    durationMs: Date.now() - start,
                };
            }
            throw error;
        }
    }

    private async executeUnlocked(
        branchId: string,
        params: DispatchHeadlessParams,
        lease?: EformsignOperationLease,
    ): Promise<DispatchHeadlessResult> {
        const start = Date.now();
        let latestProgressStep: EformsignHeadlessProgressStep | undefined;
        try {
            await this.assignmentGuard.assertAssignedProvider(
                branchId,
                params.clientId,
                params.contractData.caretaker1Contact,
            );
            const tokenResponse = await this.getAccessTokenUsecase.execute(Date.now());
            const accessToken = tokenResponse.oauth_token.access_token;
            const refreshToken = tokenResponse.oauth_token.refresh_token;

            let templateId: string | undefined;
            let templateName: string | null = null;
            if (params.contractData.area) {
                const areaTemplate = await this.areaTemplateService.findByArea(branchId, params.contractData.area);
                templateId = areaTemplate?.templateId;
                templateName = areaTemplate?.templateName ?? null;
            }

            if (!params.force) {
                const duplicate = (await this.eformsignDocRepository.findByClientId(branchId, params.clientId))
                    .find((document) => (
                        document.templateId === (templateId ?? null)
                        && !TERMINAL_STATUS_CODES.has(document.statusType)
                        && start - document.createdDate.getTime() >= 0
                        && start - document.createdDate.getTime() <= DUPLICATE_WINDOW_MS
                    ));
                if (duplicate) {
                    return {
                        ok: false,
                        reason: "duplicate_pending_document",
                        existingDocumentId: duplicate.documentId,
                        durationMs: Date.now() - start,
                    };
                }
            }

            const documentOption = this.eformsignService.generateDocumentOptions(
                params.contractData,
                accessToken,
                refreshToken,
                templateId,
            ) as Record<string, unknown>;
            const documentName = (
                documentOption["prefill"] as { document_name?: unknown } | undefined
            )?.document_name;

            if (lease && !lease.isHeld()) {
                return {
                    ok: false,
                    reason: "operation_lock_lost",
                    fallbackHint: "manual_check",
                    durationMs: Date.now() - start,
                };
            }

            const result = await this.headlessService.dispatchCreation({
                documentOption,
                onProgress: async (step) => {
                    latestProgressStep = step;
                    await params.onProgress?.(step);
                    this.progressService.emit(params.progressId, step);
                },
            });

            // The gate runner emits "creating" whenever either top-level or popup
            // 전송 may have submitted. Some templates submit directly from the
            // top-level button, so neither send action is safe to retry. A failure
            // at or after "creating" means eformsign may already hold the
            // document and only the SDK callback went missing. Those runs must not
            // report fallbackHint:"iframe" — that reopens the editor and a second
            // contract goes out. Only a failure that never reached the send button
            // is safe to retry in the iframe.
            const sendWasAttempted = latestProgressStep === "creating" || latestProgressStep === "sent";

            if (!result.ok && !sendWasAttempted) {
                this.progressService.emit(params.progressId, "failed", result.reason, latestProgressStep);
                return {
                    ok: false,
                    reason: result.reason,
                    fallbackHint: "iframe",
                    durationMs: result.durationMs,
                    failedStep: latestProgressStep,
                };
            }
            // A post-send failure falls through to the same reconciliation as a run
            // that finished without a document_id: look the document up remotely,
            // adopt it if it exists, and otherwise surface "confirm before retrying"
            // instead of silently reopening the editor.

            // The SDK success callback (`__eformsignSuccess.document_id`) is
            // the primary source of the new document id — mode:"01" payloads
            // don't carry one. If it is missing, reconcile against the vendor
            // list before deciding whether any retry is safe.
            const reconciliation = result.documentId ? undefined : await this.reconcileCreatedDocument(
                accessToken,
                params.contractData.customerName,
                templateId,
                start,
                start + HEADLESS_CREATE_RECONCILIATION_DEADLINE_MS,
            );
            const documentId = result.documentId ?? reconciliation?.documentId;
            if (!documentId) {
                this.logger.warn("Headless creation finished without a document_id and remote reconciliation was inconclusive.");
                this.progressService.emit(
                    params.progressId,
                    "failed",
                    "remote_unconfirmed",
                    latestProgressStep,
                );
                return {
                    ok: false,
                    reason: "remote_unconfirmed",
                    fallbackHint: reconciliation?.available === false ? "adopt-or-manual" : "manual_check",
                    durationMs: result.durationMs,
                    failedStep: latestProgressStep,
                };
            }

            if (params.clientId && documentId) {
                const client = await this.clientRepository.findById(branchId, params.clientId).catch(() => null);
                const createdDocumentStatus = await this.resolveCreatedDocumentStatus(
                    accessToken,
                    documentId,
                    templateId,
                );
                try {
                    await this.createEformsignDocUsecase.execute(branchId, {
                    documentId,
                    documentName: typeof documentName === "string" ? documentName : null,
                    clientId: params.clientId,
                    statusType: createdDocumentStatus.statusType,
                    statusDetail: createdDocumentStatus.statusDetail,
                    stepType: createdDocumentStatus.stepType,
                    stepIndex: createdDocumentStatus.stepIndex,
                    stepName: createdDocumentStatus.stepName,
                    stepRecipientType: "01",
                    stepRecipientName: params.contractData.customerName,
                    stepRecipientSms: params.contractData.customerContact || client?.phone || "",
                    expiredDate: createdDocumentStatus.expiredDate,
                    linkToClient: true,
                    documentKind: EFORMSIGN_DOCUMENT_KIND.CONTRACT,
                    templateId: templateId ?? null,
                    templateName: createdDocumentStatus.templateName ?? templateName,
                    customerName: params.contractData.customerName,
                    });
                } catch (error) {
                    this.logger.error(`Failed to persist doc record for ${documentId}: ${error}`);
                    return {
                        ok: false,
                        reason: "local_persist_failed",
                        remoteDocumentId: documentId,
                        fallbackHint: "adopt",
                        durationMs: result.durationMs,
                        failedStep: latestProgressStep,
                    };
                }
            }

            return {
                ok: true,
                documentId,
                durationMs: result.durationMs,
            };
        } catch (error) {
            const reason = error instanceof Error ? error.message : "unknown headless dispatch error";
            this.logger.error(`DispatchDocumentHeadlessUsecase failed: ${reason}`);
            this.progressService.emit(params.progressId, "failed", reason, latestProgressStep);
            return {
                ok: false,
                reason,
                fallbackHint: "iframe",
                durationMs: Date.now() - start,
                failedStep: latestProgressStep,
            };
        }
    }

    private async reconcileCreatedDocument(
        accessToken: string,
        customerName: string,
        templateId: string | undefined,
        startedAt: number,
        deadlineAt: number,
    ): Promise<{ available: boolean; documentId?: string }> {
        let completedRemoteRead = false;
        const normalizedCustomerName = customerName.trim();
        for (const delayMs of CREATED_DOCUMENT_RETRY_DELAYS_MS) {
            if (Date.now() >= deadlineAt) break;
            if (delayMs > 0) {
                if (Date.now() + delayMs >= deadlineAt) break;
                await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
            }
            try {
                const candidates = (await this.withDeadline(
                    () => this.fetchAllEformsignDocsFromApiUsecase.execute(accessToken),
                    deadlineAt,
                ))
                    .filter((document) => document.created_date >= startedAt - 5_000)
                    .filter((document) => !templateId || document.template?.id === templateId)
                    .sort((left, right) => right.created_date - left.created_date);
                completedRemoteRead = true;

                if (!normalizedCustomerName) {
                    const candidate = candidates[0];
                    if (candidates.length === 1 && candidate) {
                        return { available: true, documentId: candidate.id };
                    }
                    if (candidates.length > 1) {
                        return { available: true };
                    }
                    continue;
                }

                // Some templates generate a fixed title and reject the caller's document_name,
                // so the customer name is not necessarily present in list_document. Keep the
                // cheap title match for templates that do include it, then disambiguate fixed-
                // title candidates by the actual `이용자 성명` field from document detail.
                const titleMatches = candidates.filter((document) =>
                    document.document_name?.includes(normalizedCustomerName),
                );
                if (titleMatches.length === 1) {
                    return { available: true, documentId: titleMatches[0]!.id };
                }
                if (titleMatches.length > 1) {
                    return { available: true };
                }

                const fieldMatches: string[] = [];
                let detailReadFailed = false;
                for (const candidate of candidates.slice(0, 10)) {
                    if (Date.now() >= deadlineAt) break;
                    try {
                        const detail = await this.withDeadline(
                            () => this.fetchEformsignDocFromApiUsecase.execute(accessToken, candidate.id),
                            Math.min(
                                deadlineAt,
                                Date.now() + CREATED_DOCUMENT_DETAIL_READ_TIMEOUT_MS,
                            ),
                        );
                        const customerField = detail.fields?.find((field) => field.id === "이용자 성명");
                        if (customerField?.value?.trim() === normalizedCustomerName) {
                            fieldMatches.push(candidate.id);
                        }
                    } catch (error) {
                        detailReadFailed = true;
                        const reason = error instanceof Error ? error.message : String(error);
                        this.logger.warn(`Remote creation candidate ${candidate.id} could not be inspected: ${reason}`);
                    }
                }
                if (fieldMatches.length === 1) {
                    return { available: true, documentId: fieldMatches[0] };
                }
                if (fieldMatches.length > 1 || (candidates.length > 0 && !detailReadFailed)) {
                    return { available: true };
                }
            } catch (error) {
                if (error instanceof CreatedDocumentReconciliationDeadlineError) {
                    this.logger.warn("Remote creation reconciliation reached its operation deadline.");
                    break;
                }
                const reason = error instanceof Error ? error.message : String(error);
                this.logger.warn(`Remote reconciliation is unavailable: ${reason}`);
            }
        }
        return { available: completedRemoteRead };
    }

    private async withDeadline<T>(operation: () => Promise<T>, deadlineAt: number): Promise<T> {
        const remainingMs = deadlineAt - Date.now();
        if (remainingMs <= 0) {
            throw new CreatedDocumentReconciliationDeadlineError();
        }

        let timeout: ReturnType<typeof setTimeout> | undefined;
        try {
            return await Promise.race([
                operation(),
                new Promise<T>((_resolve, reject) => {
                    timeout = setTimeout(
                        () => reject(new CreatedDocumentReconciliationDeadlineError()),
                        remainingMs,
                    );
                }),
            ]);
        } finally {
            if (timeout) clearTimeout(timeout);
        }
    }

    private async resolveCreatedDocumentStatus(
        accessToken: string,
        documentId: string,
        expectedTemplateId?: string,
    ): Promise<CreatedDocumentStatus> {
        const fallback = this.initialSignRequestStatus();
        try {
            const document = await this.fetchEformsignDocFromApiUsecase.execute(accessToken, documentId);
            const actualTemplateId = document.template?.id?.trim();
            if (expectedTemplateId && actualTemplateId && actualTemplateId !== expectedTemplateId) {
                this.logger.warn(
                    `Created document ${documentId} used template ${actualTemplateId}, expected ${expectedTemplateId}.`,
                );
            }

            const currentStatus = document.current_status;
            const statusType = this.normalizeStatusCode(currentStatus?.status_type);
            return {
                statusType,
                statusDetail: this.statusDetail(statusType, currentStatus?.step_name),
                stepType: currentStatus?.step_type?.trim() || fallback.stepType,
                stepIndex: currentStatus?.step_index?.trim() || fallback.stepIndex,
                stepName: currentStatus?.step_name?.trim() || fallback.stepName,
                expiredDate: eformsignExpiryDateFromRemainingDays(
                    currentStatus?.expired_date,
                    Date.now(),
                ),
                templateName: document.template?.name?.trim() || undefined,
            };
        } catch (error) {
            const reason = error instanceof Error ? error.message : "unknown error";
            this.logger.warn(
                `Failed to fetch created eformsign document ${documentId} status; using initial sign-request status. ${reason}`,
            );
            return fallback;
        }
    }

    private initialSignRequestStatus(): CreatedDocumentStatus {
        return {
            statusType: "060",
            statusDetail: "서명 요청됨",
            stepType: "01",
            stepIndex: "1",
            stepName: "서명 요청",
            expiredDate: new Date(Date.now() + DEFAULT_DOCUMENT_EXPIRY_MS),
        };
    }

    private normalizeStatusCode(statusType: string | null | undefined): string {
        return statusType?.trim().padStart(3, "0") || "000";
    }

    private statusDetail(statusType: string, stepName: string | null | undefined): string {
        if (COMPLETED_STATUS_CODES.has(statusType)) {
            return "완료";
        }
        if (REJECTED_STATUS_CODES.has(statusType)) {
            return "거부";
        }
        return stepName?.trim() || "진행중";
    }

}
