import { Inject, Injectable, Logger, Optional } from "@nestjs/common";

import { EformsignDocumentMirrorService } from "application/services/eformsign-document-mirror.service";
import { AreaTemplateService } from "application/services/area-template.service";
import { AdoptEformsignDocUsecase } from "application/usecases/eformsign-doc/adopt-eformsign-doc.usecase";
import { FetchAllEformsignDocsFromApiUsecase } from "application/usecases/eformsign-doc/fetch-all-eformsign-docs-from-api.usecase";
import { FetchEformsignDocFromApiUsecase } from "application/usecases/eformsign-doc/fetch-eformsign-doc-from-api.usecase";
import { GetEformsignAccessTokenUsecase } from "application/usecases/eformsign-doc/get-eformsign-access-token.usecase";
import {
    EFORMSIGN_COMPLETED_STATUS_CODES,
    TERMINAL_STATUS_CODES,
} from "domain/constants/eformsign-doc-status.constants";
import { EformsignDocumentJobEntity } from "domain/entities/eformsign-document-job.entity";
import {
    EFORMSIGN_DOCUMENT_JOB_REPOSITORY,
    IEformsignDocumentJobRepository,
} from "domain/repositories/eformsign-document-job.repository.interface";
import { normalizeEformsignStatusCode } from "domain/utils/eformsign-status-code";

const CREATION_MATCH_SKEW_MS = 5_000;

export type EformsignDocumentJobReconciliationStatus =
    | "completed"
    | "requires_attention";

export interface EformsignDocumentJobReconciliationResult {
    status: EformsignDocumentJobReconciliationStatus;
    documentId?: string;
    reason?: string;
    recordedAttempts?: number | null;
}

/**
 * Resolves jobs after the provider may have accepted a send but the local
 * browser run did not receive a trustworthy terminal response. This service
 * never submits a provider operation; it only reads and adopts a unique state.
 */
@Injectable()
export class EformsignDocumentJobReconciliationService {
    private readonly logger = new Logger(EformsignDocumentJobReconciliationService.name);

    constructor(
        @Inject(EFORMSIGN_DOCUMENT_JOB_REPOSITORY)
        private readonly repository: IEformsignDocumentJobRepository,
        private readonly getAccessTokenUsecase: GetEformsignAccessTokenUsecase,
        private readonly fetchAllDocumentsUsecase: FetchAllEformsignDocsFromApiUsecase,
        private readonly fetchDocumentUsecase: FetchEformsignDocFromApiUsecase,
        private readonly adoptEformsignDocUsecase: AdoptEformsignDocUsecase,
        @Optional() private readonly documentMirrorService?: EformsignDocumentMirrorService,
        @Optional() private readonly areaTemplateService?: AreaTemplateService,
    ) {}

    async reconcile(
        job: EformsignDocumentJobEntity,
    ): Promise<EformsignDocumentJobReconciliationResult> {
        try {
            const token = await this.getAccessTokenUsecase.execute(Date.now());
            if (job.jobType === "create_document") {
                return await this.reconcileCreation(job, token.oauth_token.access_token);
            }
            return await this.reconcileFinalization(job, token.oauth_token.access_token);
        } catch {
            this.logger.warn(`Eformsign job ${job.id} reconciliation could not read provider state`);
            return this.requiresAttention(job, "PROVIDER_STATE_UNAVAILABLE");
        }
    }

    private async reconcileCreation(
        job: EformsignDocumentJobEntity,
        accessToken: string,
    ): Promise<EformsignDocumentJobReconciliationResult> {
        const startedAt = (job.startedAt ?? job.createdAt).getTime();
        const now = Date.now();
        let candidates = (await this.fetchAllDocumentsUsecase.execute(accessToken))
            .filter((document) => document.created_date >= startedAt - CREATION_MATCH_SKEW_MS)
            .filter((document) => document.created_date <= now + CREATION_MATCH_SKEW_MS)
            .sort((left, right) => right.created_date - left.created_date);

        const payload = job.payload?.["contractData"];
        const contractData = payload && typeof payload === "object"
            ? payload as { customerName?: unknown; area?: unknown }
            : undefined;
        const customerName = readString(contractData?.customerName);
        const area = readString(contractData?.area);
        if (!customerName) {
            return this.requiresAttention(job, "MISSING_CREATION_RECONCILIATION_HINTS");
        }
        if (this.areaTemplateService && area) {
            const expectedTemplate = await this.areaTemplateService.findByArea(job.branchId, area);
            if (expectedTemplate?.templateId) {
                candidates = candidates.filter((document) => document.template?.id === expectedTemplate.templateId);
            }
        }

        const titleMatches = candidates.filter((document) =>
            document.document_name?.includes(customerName),
        );
        if (titleMatches.length > 0) {
            candidates = titleMatches;
        } else {
            const fieldMatches: typeof candidates = [];
            for (const candidate of candidates.slice(0, 10)) {
                try {
                    const detail = await this.fetchDocumentUsecase.execute(accessToken, candidate.id);
                    const customerField = detail.fields?.find((field) => field.id === "이용자 성명");
                    if (customerField?.value?.trim() === customerName) {
                        fieldMatches.push(candidate);
                    }
                } catch {
                    // A failed detail read is insufficient evidence for adoption.
                }
            }
            candidates = fieldMatches;
        }

        if (candidates.length !== 1 || !candidates[0]) {
            return this.requiresAttention(
                job,
                candidates.length === 0
                    ? "PROVIDER_DOCUMENT_NOT_FOUND"
                    : "AMBIGUOUS_PROVIDER_STATE",
            );
        }
        if (job.clientId === null) {
            return this.requiresAttention(job, "MISSING_CLIENT_FOR_ADOPTION");
        }

        const documentId = candidates[0].id;
        try {
            await this.adoptEformsignDocUsecase.execute(job.branchId, {
                documentId,
                clientId: job.clientId,
            });
        } catch {
            this.logger.warn(`Eformsign job ${job.id} provider document adoption failed`);
            return this.requiresAttention(job, "ADOPTION_FAILED");
        }

        if (!job.leaseToken) return this.requiresAttention(job, "MISSING_JOB_LEASE");
        await this.repository.markCompleted(job.id, job.leaseToken, documentId);
        return { status: "completed", documentId };
    }

    private async reconcileFinalization(
        job: EformsignDocumentJobEntity,
        accessToken: string,
    ): Promise<EformsignDocumentJobReconciliationResult> {
        const documentId = job.documentId ?? readString(job.payload?.["documentId"]);
        if (!documentId) {
            return this.requiresAttention(job, "MISSING_PROVIDER_DOCUMENT_ID");
        }

        const document = await this.fetchDocumentUsecase.execute(accessToken, documentId);
        const statusCode = normalizeEformsignStatusCode(document.current_status?.status_type);
        if (!EFORMSIGN_COMPLETED_STATUS_CODES.has(statusCode)) {
            return this.requiresAttention(
                job,
                TERMINAL_STATUS_CODES.has(statusCode)
                    ? "PROVIDER_TERMINAL_FAILURE"
                    : "PROVIDER_STATE_UNFINISHED",
            );
        }

        if (this.documentMirrorService) {
            try {
                await this.documentMirrorService.syncDocument(documentId, {
                    force: true,
                    suppressOutboundAutomation: true,
                    strictCompletionReconciliation: true,
                });
            } catch {
                this.logger.warn(`Eformsign job ${job.id} completion mirror failed`);
                return this.requiresAttention(job, "COMPLETION_MIRROR_FAILED");
            }
        }

        if (!job.leaseToken) return this.requiresAttention(job, "MISSING_JOB_LEASE");
        await this.repository.markCompleted(job.id, job.leaseToken, documentId);
        return { status: "completed", documentId };
    }

    private async requiresAttention(
        job: EformsignDocumentJobEntity,
        reason: string,
    ): Promise<EformsignDocumentJobReconciliationResult> {
        if (!job.leaseToken) return { status: "requires_attention", reason: "MISSING_JOB_LEASE" };
        const transitioned = await this.repository.markRequiresAttention(
            job.id,
            job.leaseToken,
            reason,
        );
        return {
            status: "requires_attention",
            reason,
            recordedAttempts: transitioned?.autoFinalizeOutcomeAttempts ?? null,
        };
    }
}

function readString(value: unknown): string | undefined {
    if (typeof value !== "string") return undefined;
    const normalized = value.trim();
    return normalized || undefined;
}
