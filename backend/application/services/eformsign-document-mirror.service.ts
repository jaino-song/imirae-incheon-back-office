import { createHash } from "node:crypto";

import { Inject, Injectable, Logger, Optional } from "@nestjs/common";

import { EformsignDocsEventBus } from "application/services/eformsign-docs-event-bus.service";
import { EformsignDocumentSnapshotService } from "application/services/eformsign-document-snapshot.service";
import { EformsignService } from "application/services/eformsign.service";
import { eformsignCustomerPhone } from "application/utils/eformsign-contract-client-candidate";
import { sanitizeEformsignErrorMessage } from "application/utils/eformsign-error-message";
import { MirrorUnassignedEformsignDocUsecase } from "application/usecases/eformsign-doc/mirror-unassigned-eformsign-doc.usecase";
import {
    ExpectedEformsignMirrorGeneration,
    LinkMirroredEformsignDocByPhoneUsecase,
} from "application/usecases/eformsign-doc/link-mirrored-eformsign-doc-by-phone.usecase";
import { ReconcileCompletedMirroredEformsignDocUsecase } from "application/usecases/eformsign-doc/reconcile-completed-mirrored-eformsign-doc.usecase";
import {
    EFORMSIGN_COMPLETED_STATUS_CODES,
    isUnassignedReviewStageStatus,
} from "domain/constants/eformsign-doc-status.constants";
import {
    EFORMSIGN_DOCUMENT_MIRROR_REPOSITORY,
    EformsignDocumentFileType,
    EformsignDocumentMirrorState,
    EformsignPermanentPurgeRequest,
    IEformsignDocumentMirrorRepository,
} from "domain/repositories/eformsign-document-mirror.repository.interface";
import {
    EFORMSIGN_CLIENT_REPOSITORY,
    EformsignApiDocumentResponse,
    IEformsignClientRepository,
} from "domain/repositories/eformsign.client.interface";
import {
    EformsignDocOwnershipConflictError,
    EformsignDocStaleUpdateError,
} from "domain/repositories/eformsign-doc.repository.interface";
import { normalizeEformsignStatusCode } from "domain/utils/eformsign-status-code";
import { EformsignApiError } from "infrastructure/api/eformsign-api.error";

const FILE_TYPES: readonly EformsignDocumentFileType[] = [
    "document",
    "audit_trail",
];
const SECRET_KEYS = new Set([
    "accesstoken",
    "apikey",
    "authorization",
    "clientsecret",
    "downloadtoken",
    "externaltoken",
    "oauthtoken",
    "outsidetoken",
    "password",
    "refreshtoken",
    "secret",
    "signaturetoken",
]);

export interface SyncEformsignDocumentOptions {
    force?: boolean;
    /**
     * Refresh vendor detail while retaining healthy PDFs at the same source
     * version. Missing, failed, or newer-version files are still repaired.
     * Manual and backfill `force` calls retain their existing full-repair
     * behavior unless they opt into this webhook-specific optimization.
     */
    skipHealthySameVersionFileRepair?: boolean;
    expectedUpdatedDate?: number;
    suppressOutboundAutomation?: boolean;
    /**
     * Read-triggered file repair must not link customers or apply lifecycle
     * effects while it refreshes the durable detail and PDF mirror.
     */
    skipClientReconciliation?: boolean;
    /**
     * Keep an already branch-owned list projection authoritative while still
     * refreshing the durable detail and PDF mirror from the vendor.
     */
    skipBranchOwnedProjection?: boolean;
    /**
     * Completion webhooks must not acknowledge until durable completion effects
     * have converged. Background and regular syncs stay best-effort.
     */
    strictCompletionReconciliation?: boolean;
    /**
     * Webhooks defer service-record lifecycle mutation until their completion
     * claim is fenced. Direct/manual completion has no later claim phase and
     * must apply lifecycle effects during the strict mirror sync itself.
     */
    deferServiceRecordLifecycle?: boolean;
    /** Publish only after the requested local mirror convergence has succeeded. */
    publishChangeReason?: string;
}

export interface SyncEformsignDocumentResult {
    status: "synced" | "skipped";
    documentId: string;
    sourceUpdatedDate: Date;
    storedFileTypes: EformsignDocumentFileType[];
    missingFileTypes: EformsignDocumentFileType[];
    /**
     * Local document ownership changed through ready reconciliation or a
     * not-ready, existing-client-only link. Completion publication also requires
     * `isDocumentReady` in `EformsignWebhookController`, so a not-ready link
     * cannot publish a completion event.
     */
    ownershipChanged?: true;
}

export interface StoredEformsignDocumentFileResponse {
    status: 200;
    contentType: string;
    contentDisposition: string | null;
    body: Buffer;
}

export interface StoredEformsignDocumentFileMetadataResponse {
    status: 200;
    contentType: string;
    contentDisposition: string | null;
    byteSize: number;
}

export class EformsignStoredFileIntegrityError extends Error {
    constructor(documentId: string, fileType: EformsignDocumentFileType) {
        super(`Stored eformsign ${fileType} failed integrity validation for ${documentId}`);
        this.name = EformsignStoredFileIntegrityError.name;
    }
}

@Injectable()
export class EformsignDocumentMirrorService {
    private readonly logger = new Logger(EformsignDocumentMirrorService.name);

    constructor(
        @Inject(EFORMSIGN_CLIENT_REPOSITORY)
        private readonly eformsignClient: IEformsignClientRepository,
        @Inject(EFORMSIGN_DOCUMENT_MIRROR_REPOSITORY)
        private readonly mirrorRepository: IEformsignDocumentMirrorRepository,
        private readonly mirrorDocumentUsecase: MirrorUnassignedEformsignDocUsecase,
        private readonly linkDocumentByPhoneUsecase: LinkMirroredEformsignDocByPhoneUsecase,
        private readonly eformsignService: EformsignService,
        @Optional()
        private readonly documentSnapshotService?: EformsignDocumentSnapshotService,
        @Optional()
        private readonly completedMirrorReconciler?: ReconcileCompletedMirroredEformsignDocUsecase,
        @Optional()
        private readonly docsEventBus?: EformsignDocsEventBus,
    ) {}

    async getStoredDetail(documentId: string): Promise<EformsignApiDocumentResponse | null> {
        const state = await this.mirrorRepository.findState(documentId);
        return state?.permanentPurgeRequestedAt
            ? null
            : state?.detailPayload ?? null;
    }

    async isDocumentReady(documentId: string): Promise<boolean> {
        const state = await this.mirrorRepository.findState(documentId);
        if (
            !state?.detailPayload
            || !state.detailSourceUpdatedDate
            || state.syncStatus !== "ready"
            || Boolean(state.permanentPurgeRequestedAt)
            || !EFORMSIGN_COMPLETED_STATUS_CODES.has(
                normalizeEformsignStatusCode(state.detailPayload.current_status?.status_type),
            )
        ) {
            return false;
        }
        return FILE_TYPES.every((fileType) =>
            state.files.some((file) =>
                file.fileType === fileType
                && file.sourceUpdatedDate.getTime()
                    === state.detailSourceUpdatedDate!.getTime(),
            ));
    }

    /**
     * Completion webhooks must obtain current fields before consuming their durable
     * completion claim, but must not project status 050 until the claim succeeds.
     */
    async fetchCurrentDetail(documentId: string): Promise<EformsignApiDocumentResponse> {
        const token = await this.eformsignClient.getAccessToken(Date.now());
        const remote = await this.eformsignClient.getDocument(
            token.oauth_token.access_token,
            documentId,
        );
        return redactCredentialFields(remote);
    }

    async getStoredFile(
        documentId: string,
        fileType: EformsignDocumentFileType,
    ): Promise<StoredEformsignDocumentFileResponse | null> {
        const metadata = await this.mirrorRepository.findFile(documentId, fileType);
        if (!metadata) {
            return null;
        }

        const body = metadata.content;
        const actualHash = sha256(body);
        if (body.length !== metadata.byteSize || actualHash !== metadata.sha256) {
            await this.mirrorRepository.markFileIntegrityFailure({
                documentId,
                fileType,
                sourceUpdatedDate: metadata.sourceUpdatedDate,
                syncedAt: metadata.syncedAt,
                sha256: metadata.sha256,
                message: `Stored ${fileType} failed integrity validation`,
            }).catch((error) => {
                this.logger.warn(
                    `Failed to mark stored eformsign ${fileType} integrity failure for ${documentId}: ${sanitizeEformsignErrorMessage(error)}`,
                );
            });
            throw new EformsignStoredFileIntegrityError(documentId, fileType);
        }

        return {
            status: 200,
            contentType: metadata.contentType,
            contentDisposition: safeContentDisposition(metadata.contentDisposition),
            body,
        };
    }

    async getStoredFileMetadata(
        documentId: string,
        fileType: EformsignDocumentFileType,
    ): Promise<StoredEformsignDocumentFileMetadataResponse | null> {
        const state = await this.mirrorRepository.findState(documentId);
        const file = state?.files.find((candidate) =>
            candidate.fileType === fileType
            && state.detailSourceUpdatedDate
            && candidate.sourceUpdatedDate.getTime()
                === state.detailSourceUpdatedDate.getTime(),
        );
        const canReadReviewStageDocument = fileType === "document"
            && isUnassignedReviewStageStatus(
                state?.detailPayload?.current_status?.status_type,
            );
        if (
            !state?.detailPayload
            || !state.detailSourceUpdatedDate
            || (state.syncStatus !== "ready" && !canReadReviewStageDocument)
            || Boolean(state.permanentPurgeRequestedAt)
            || !file
        ) {
            return null;
        }

        return {
            status: 200,
            contentType: file.contentType,
            contentDisposition: safeContentDisposition(file.contentDisposition),
            byteSize: file.byteSize,
        };
    }

    async markDocumentsDeleted(
        documentIds: string[],
        deletedAt: Date = new Date(),
    ): Promise<void> {
        await this.mirrorRepository.markDeleted(documentIds, deletedAt);
        await this.invalidateDocumentSnapshots(documentIds);
    }

    async findActiveDocumentIds(): Promise<string[]> {
        return this.mirrorRepository.findActiveDocumentIds();
    }

    async findTerminalDocumentIds(documentIds: string[]): Promise<string[]> {
        return this.mirrorRepository.findTerminalDocumentIds(documentIds);
    }

    async findPermanentPurgeRequestedDocumentIds(): Promise<string[]> {
        return this.mirrorRepository.findPermanentPurgeRequestedDocumentIds();
    }

    async requestPermanentPurge(
        documentIds: string[],
    ): Promise<EformsignPermanentPurgeRequest[]> {
        const requests = await this.mirrorRepository.requestPermanentPurge(documentIds);
        await this.invalidateDocumentSnapshots(requests.map((request) => request.documentId));
        return requests;
    }

    async clearPermanentPurgeRequest(
        requests: EformsignPermanentPurgeRequest[],
    ): Promise<string[]> {
        const clearedDocumentIds = await this.mirrorRepository.clearPermanentPurgeRequest(requests);
        await this.invalidateDocumentSnapshots(clearedDocumentIds);
        return clearedDocumentIds;
    }

    async purgeDocuments(
        documentIds: string[],
        deletedAt: Date = new Date(),
    ): Promise<void> {
        await this.mirrorRepository.purgeContent(documentIds, deletedAt);
        await this.invalidateDocumentSnapshots(documentIds);
    }

    async syncDocument(
        documentId: string,
        options: SyncEformsignDocumentOptions = {},
    ): Promise<SyncEformsignDocumentResult> {
        const token = await this.eformsignClient.getAccessToken(Date.now());
        const result = await this.syncDocumentWithToken(
            token.oauth_token.access_token,
            documentId,
            options,
        );
        if (options.publishChangeReason && this.docsEventBus) {
            await this.publishDocumentChange(documentId, options.publishChangeReason);
        }
        return result;
    }

    private async publishDocumentChange(documentId: string, reason: string): Promise<void> {
        try {
            const state = await this.mirrorRepository.findState(documentId);
            if (!state?.branchId) return;
            this.docsEventBus?.emit({
                branchId: state.branchId,
                documentId,
                reason,
            });
        } catch (error) {
            this.logger.warn(
                `Failed to publish eformsign document change for ${documentId}: `
                + sanitizeEformsignErrorMessage(error),
            );
        }
    }

    async syncDocumentWithToken(
        accessToken: string,
        documentId: string,
        options: SyncEformsignDocumentOptions = {},
    ): Promise<SyncEformsignDocumentResult> {
        const previousState = await this.mirrorRepository.findState(documentId);
        if (!options.force && isFresh(previousState, options)) {
            const ownershipChanged = !options.skipClientReconciliation
                && await this.reconcileClient(documentId, options);
            return {
                status: "skipped",
                documentId,
                sourceUpdatedDate: previousState!.detailSourceUpdatedDate!,
                storedFileTypes: previousState!.files.map((file) => file.fileType),
                missingFileTypes: [],
                ...(ownershipChanged ? { ownershipChanged: true } : {}),
            };
        }

        let rowMirrored = false;
        let attemptedSourceUpdatedDate: Date | null = null;
        let attemptedSyncedAt: Date | null = null;
        let strictCompletionReconciliationStarted = false;
        try {
            const remote = await this.eformsignClient.getDocument(accessToken, documentId);
            const sourceUpdatedDate = validSourceDate(remote.updated_date);
            const statusType = normalizeEformsignStatusCode(
                remote.current_status.status_type,
            );
            const isCompletedDocument = EFORMSIGN_COMPLETED_STATUS_CODES.has(statusType);
            attemptedSourceUpdatedDate = sourceUpdatedDate;
            try {
                await this.mirrorDocumentUsecase.mirrorRemoteDocument(
                    remote,
                    options.skipBranchOwnedProjection
                        ? { fallbackDocumentId: documentId }
                        : {
                            allowAssignedUpdate: true,
                            fallbackDocumentId: documentId,
                        },
                );
            } catch (error) {
                if (
                    options.skipBranchOwnedProjection
                    && error instanceof EformsignDocOwnershipConflictError
                ) {
                    this.logger.log(
                        `Skipping branch-owned projection while syncing detail for ${documentId}`,
                    );
                } else if (error instanceof EformsignDocStaleUpdateError) {
                    // The newer list projection already owns the row. Detail and file
                    // mirroring are separate convergence work and must still continue.
                    this.logger.log(
                        `Continuing detail sync after stale projection for ${documentId}`,
                    );
                } else {
                    throw error;
                }
            }
            rowMirrored = true;

            const detailPayload = redactCredentialFields(remote);
            const syncedAt = nextSyncAttemptDate(previousState?.detailSyncedAt);
            attemptedSyncedAt = syncedAt;
            const detailApplied = await this.mirrorRepository.saveDetail({
                documentId,
                detailPayload,
                customerPhone: eformsignCustomerPhone(detailPayload),
                sourceUpdatedDate,
                expectedDetailSyncedAt: previousState?.detailSyncedAt ?? null,
                allowReadySameVersionRepair: options.force
                    || previousState?.syncStatus === "failed"
                    || !hasCurrentVersionFiles(previousState),
                syncedAt,
            });
            if (!detailApplied) {
                const currentState = await this.mirrorRepository.findState(documentId);
                const ownershipChanged = !options.skipClientReconciliation
                    && await this.reconcileClient(documentId, options);
                return {
                    status: "skipped",
                    documentId,
                    sourceUpdatedDate:
                        currentState?.detailSourceUpdatedDate ?? sourceUpdatedDate,
                    storedFileTypes:
                        currentState?.files.map((file) => file.fileType) ?? [],
                    missingFileTypes: FILE_TYPES.filter((fileType) =>
                        !currentState?.files.some((file) => file.fileType === fileType),
                    ),
                    ...(ownershipChanged ? { ownershipChanged: true } : {}),
                };
            }

            if (isCompletedDocument) {
                // saveDetail moves this generation to syncing. Invalidate the prior
                // snapshot now so a completed row cannot stay published while either
                // required PDF is missing or being replaced.
                await this.invalidateDocumentSnapshots([documentId]);
            }

            const storedFileTypes: EformsignDocumentFileType[] = [];
            const missingFileTypes: EformsignDocumentFileType[] = [];
            const shouldRepairFiles = !options.skipHealthySameVersionFileRepair
                || needsFileRepair(previousState, sourceUpdatedDate);
            if (shouldRepairFiles) {
                for (const fileType of FILE_TYPES) {
                    const stored = await this.syncFile({
                        accessToken,
                        documentId,
                        fileType,
                        sourceUpdatedDate,
                        syncedAt,
                    });
                    (stored ? storedFileTypes : missingFileTypes).push(fileType);
                }
            } else {
                // `needsFileRepair` proves these are healthy files for the same
                // source version. Keep the vendor detail refresh cheap and avoid
                // rewriting identical PDF blobs on ordinary action webhooks.
                storedFileTypes.push(...FILE_TYPES);
            }

            if (
                isCompletedDocument
                && missingFileTypes.length > 0
            ) {
                throw new Error(
                    `Completed eformsign document ${documentId} is missing current-version files: ${missingFileTypes.join(", ")}`,
                );
            }

            const partialMessage = missingFileTypes.length > 0
                ? `Files not ready: ${missingFileTypes.join(", ")}`
                : null;
            const finishApplied = await this.mirrorRepository.markSyncFinished(
                documentId,
                sourceUpdatedDate,
                syncedAt,
                partialMessage ? "partial" : "ready",
                partialMessage,
            );
            if (finishApplied && isCompletedDocument) {
                // The list repository admits completed rows only at ready. Publish the
                // successfully stored detail/PDF generation immediately.
                await this.invalidateDocumentSnapshots([documentId]);
            }
            // A newer attempt may own the terminal state. Reconciliation always
            // reloads it and either fences a ready generation or links existing-only.
            if (finishApplied && !partialMessage) {
                strictCompletionReconciliationStarted =
                    options.strictCompletionReconciliation === true;
            }
            const ownershipChanged = !options.skipClientReconciliation
                && await this.reconcileClient(documentId, options);

            return {
                status: "synced",
                documentId,
                sourceUpdatedDate,
                storedFileTypes,
                missingFileTypes,
                ...(ownershipChanged ? { ownershipChanged: true } : {}),
            };
        } catch (error) {
            // Durable mirror content is already ready. Completion reconciliation must
            // make the webhook retry, but must not downgrade that ready generation.
            if (strictCompletionReconciliationStarted) {
                throw error;
            }
            if (rowMirrored && attemptedSourceUpdatedDate && attemptedSyncedAt) {
                await this.mirrorRepository.markSyncFailed(
                    documentId,
                    attemptedSourceUpdatedDate,
                    attemptedSyncedAt,
                    sanitizeEformsignErrorMessage(error),
                ).catch((markError) => {
                    this.logger.warn(
                        `Failed to record eformsign sync failure for ${documentId}: ${sanitizeEformsignErrorMessage(markError)}`,
                    );
                });
            }
            throw error;
        }
    }

    private async syncFile(params: {
        accessToken: string;
        documentId: string;
        fileType: EformsignDocumentFileType;
        sourceUpdatedDate: Date;
        syncedAt: Date;
    }): Promise<boolean> {
        const response = await this.eformsignService.downloadDocumentFile(
            params.accessToken,
            params.documentId,
            params.fileType,
        );
        if (
            response.status === 204
            || (
                response.status >= 400
                && response.status < 500
                && response.status !== 401
                && response.status !== 429
            )
        ) {
            return false;
        }
        if (response.status < 200 || response.status >= 300) {
            if (response.status === 401) {
                throw new EformsignApiError(
                    `Failed to authenticate eformsign ${params.fileType} download`,
                    response.status,
                );
            }
            throw new Error(
                `Failed to download eformsign ${params.fileType} for ${params.documentId}: status=${response.status}`,
            );
        }
        if (!isPdf(response.body)) {
            throw new Error(
                `eformsign ${params.fileType} for ${params.documentId} is not a PDF`,
            );
        }

        const fileHash = sha256(response.body);
        return this.mirrorRepository.saveFile({
            documentId: params.documentId,
            fileType: params.fileType,
            content: response.body,
            contentType: "application/pdf",
            contentDisposition: safeContentDisposition(response.contentDisposition),
            byteSize: response.body.length,
            sha256: fileHash,
            sourceUpdatedDate: params.sourceUpdatedDate,
            syncedAt: params.syncedAt,
        });
    }

    private async reconcileClient(
        documentId: string,
        options: SyncEformsignDocumentOptions,
    ): Promise<boolean> {
        const state = await this.mirrorRepository.findState(documentId);
        const linkOptions = options.suppressOutboundAutomation
            ? { suppressOutboundAutomation: true }
            : undefined;
        if (!isCurrentVersionReady(state)) {
            try {
                const result = await this.linkDocumentByPhoneUsecase.execute(
                    documentId,
                    {
                        ...linkOptions,
                        linkExistingOnly: true,
                    },
                );
                if (result === "linked") {
                    await this.invalidateDocumentSnapshots([documentId]);
                    return true;
                }
                return false;
            } catch (error) {
                // A not-ready mirror can still claim an existing client, but it
                // must never make the enclosing mirror sync fail.
                this.logger.warn(
                    `Failed to reconcile mirrored eformsign client for ${documentId}: ${sanitizeEformsignErrorMessage(error)}`,
                );
                return false;
            }
        }

        const expectedMirrorGeneration: ExpectedEformsignMirrorGeneration = {
            detailSourceUpdatedDate: state.detailSourceUpdatedDate,
            detailSyncedAt: state.detailSyncedAt,
        };
        const reconciliation = EFORMSIGN_COMPLETED_STATUS_CODES.has(
            normalizeEformsignStatusCode(state.detailPayload.current_status?.status_type),
        )
            && this.completedMirrorReconciler
            ? this.completedMirrorReconciler.execute({
                documentId,
                detail: state.detailPayload,
                ...(linkOptions ? { options: linkOptions } : {}),
                ...(options.strictCompletionReconciliation
                    ? {
                        throwOnCompletionReconciliationError: true,
                        ...(options.deferServiceRecordLifecycle
                            ? { deferServiceRecordLifecycle: true }
                            : {}),
                    }
                    : {}),
            })
            : this.linkDocumentByPhoneUsecase.execute(
                documentId,
                linkOptions,
                expectedMirrorGeneration,
            );
        try {
            const result = await reconciliation;
            if (
                result === "mirror_not_ready"
                && options.strictCompletionReconciliation
            ) {
                throw new Error(
                    `Eformsign mirror generation changed during completion reconciliation for ${documentId}`,
                );
            }
            if (result === "created" || result === "linked") {
                await this.invalidateDocumentSnapshots([documentId]);
                return true;
            }
            return false;
        } catch (error) {
            // A fresh mirror still runs this local-only step, so the next webhook/sweep
            // retries without re-downloading an unchanged detail or PDF.
            this.logger.warn(
                `Failed to reconcile mirrored eformsign client for ${documentId}: ${sanitizeEformsignErrorMessage(error)}`,
            );
            if (options.strictCompletionReconciliation) {
                throw error;
            }
            return false;
        }
    }

    private async invalidateDocumentSnapshots(documentIds: string[]): Promise<void> {
        if (!this.documentSnapshotService || documentIds.length === 0) {
            return;
        }

        const states = await Promise.all(documentIds.map(async (documentId) => {
            try {
                return await this.mirrorRepository.findState(documentId);
            } catch {
                this.logger.warn(
                    `Failed to resolve snapshot scope for eformsign document ${documentId}`,
                );
                return null;
            }
        }));
        const branchIds = new Set(
            states
                .map((state) => state?.branchId)
                .filter((branchId): branchId is string => Boolean(branchId)),
        );
        const hasUnassigned = states.some((state) => state?.branchId === null);

        await Promise.all([
            ...[...branchIds].map(async (branchId) => {
                try {
                    await this.documentSnapshotService?.bumpVersion(branchId);
                } catch {
                    this.logger.warn(
                        `Failed to invalidate eformsign snapshots for branch ${branchId}`,
                    );
                }
            }),
            ...(hasUnassigned
                ? [this.documentSnapshotService.bumpCompanyEpoch().catch(() => {
                    this.logger.warn(
                        "Failed to invalidate headquarters eformsign snapshots",
                    );
                })]
                : []),
        ]);
    }

}

export function redactCredentialFields(
    document: EformsignApiDocumentResponse,
): EformsignApiDocumentResponse {
    return redactValue(document) as EformsignApiDocumentResponse;
}

function redactValue(value: unknown): unknown {
    if (Array.isArray(value)) {
        return value.map(redactValue);
    }
    if (typeof value === "number" && !Number.isFinite(value)) {
        return null;
    }
    if (value === undefined) {
        return null;
    }
    if (typeof value !== "object" || value === null) {
        return value;
    }

    return Object.fromEntries(
        Object.entries(value as Record<string, unknown>)
            .filter(([key]) => !SECRET_KEYS.has(
                key.toLowerCase().replace(/[^a-z0-9]/g, ""),
            ))
            .map(([key, nested]) => [key, redactValue(nested)]),
    );
}

function isFresh(
    state: EformsignDocumentMirrorState | null,
    options: SyncEformsignDocumentOptions,
): boolean {
    if (
        options.expectedUpdatedDate !== undefined
        && (!state?.detailSourceUpdatedDate
            || state.detailSourceUpdatedDate.getTime() < options.expectedUpdatedDate)
    ) {
        return false;
    }

    return isCurrentVersionReady(state);
}

function isCurrentVersionReady(
    state: EformsignDocumentMirrorState | null,
): state is EformsignDocumentMirrorState & {
    detailPayload: EformsignApiDocumentResponse;
    detailSourceUpdatedDate: Date;
    detailSyncedAt: Date;
} {
    return Boolean(
        state?.detailPayload
        && state.detailSourceUpdatedDate
        && state.detailSyncedAt
        && state.syncStatus === "ready"
        && !state.permanentPurgeRequestedAt
        && hasCurrentVersionFiles(state),
    );
}

function hasCurrentVersionFiles(state: EformsignDocumentMirrorState | null): boolean {
    if (!state?.detailSourceUpdatedDate) {
        return false;
    }
    return FILE_TYPES.every((fileType) =>
        state.files.some((file) =>
            file.fileType === fileType
            && file.sourceUpdatedDate.getTime()
                === state.detailSourceUpdatedDate!.getTime(),
        ));
}

function needsFileRepair(
    previousState: EformsignDocumentMirrorState | null,
    sourceUpdatedDate: Date,
): boolean {
    if (!isCurrentVersionReady(previousState)) {
        return true;
    }

    // A stale vendor read cannot supersede a newer stored detail; saveDetail
    // rejects it below. It also must not trigger a PDF rewrite.
    return sourceUpdatedDate.getTime()
        > previousState.detailSourceUpdatedDate.getTime();
}

function validSourceDate(value: number): Date {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
}

function sha256(body: Buffer): string {
    return createHash("sha256").update(body).digest("hex");
}

function nextSyncAttemptDate(previous: Date | null | undefined): Date {
    return new Date(Math.max(
        Date.now(),
        (previous?.getTime() ?? Number.NEGATIVE_INFINITY) + 1,
    ));
}

function isPdf(body: Buffer): boolean {
    return body.length >= 5 && body.subarray(0, 5).toString("ascii") === "%PDF-";
}

function safeContentDisposition(value: string | null): string | null {
    if (!value || /[\r\n]/.test(value)) {
        return null;
    }
    return value.slice(0, 500);
}
