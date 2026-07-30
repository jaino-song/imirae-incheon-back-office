import { Inject, Injectable, Logger, Optional } from "@nestjs/common";

import { ServiceRecordLifecycleService } from "application/services/service-record-lifecycle.service";
import { sanitizeEformsignErrorMessage } from "application/utils/eformsign-error-message";
import {
    EFORMSIGN_DOCUMENT_MIRROR_REPOSITORY,
    IEformsignDocumentMirrorRepository,
} from "domain/repositories/eformsign-document-mirror.repository.interface";
import { EformsignApiDocumentResponse } from "domain/repositories/eformsign.client.interface";
import { EFORMSIGN_COMPLETED_STATUS_CODES } from "domain/constants/eformsign-doc-status.constants";
import { normalizeEformsignStatusCode } from "domain/utils/eformsign-status-code";

import {
    LinkMirroredEformsignDocByPhoneUsecase,
    LinkMirroredEformsignDocOptions,
    LinkMirroredEformsignDocResult,
    ExpectedEformsignMirrorGeneration,
} from "./link-mirrored-eformsign-doc-by-phone.usecase";
import {
    SyncClientEndDateUsecase,
    SyncedClientEndDate,
} from "./sync-client-end-date.usecase";

/**
 * Applies only durable completion effects recovered from a fully mirrored
 * document. Webhook claims and live-update publication stay with the webhook.
 */
@Injectable()
export class ReconcileCompletedMirroredEformsignDocUsecase {
    private readonly logger = new Logger(
        ReconcileCompletedMirroredEformsignDocUsecase.name,
    );

    constructor(
        private readonly linkMirroredDocumentByPhoneUsecase: LinkMirroredEformsignDocByPhoneUsecase,
        private readonly syncClientEndDateUsecase: SyncClientEndDateUsecase,
        @Inject(EFORMSIGN_DOCUMENT_MIRROR_REPOSITORY)
        private readonly mirrorRepository: IEformsignDocumentMirrorRepository,
        @Optional()
        private readonly serviceRecordLifecycle?: ServiceRecordLifecycleService,
    ) {}

    async execute(params: {
        documentId: string;
        /** @deprecated The reconciler fences and consumes the current stored detail. */
        detail: EformsignApiDocumentResponse;
        options?: LinkMirroredEformsignDocOptions;
        throwOnCompletionReconciliationError?: boolean;
        deferServiceRecordLifecycle?: boolean;
    }): Promise<LinkMirroredEformsignDocResult> {
        const expectedMirrorGeneration = await this.currentReadyMirrorGeneration(
            params.documentId,
        );
        if (!expectedMirrorGeneration) {
            return "mirror_not_ready";
        }
        const linkResult = await this.linkMirroredDocumentByPhoneUsecase.execute(
            params.documentId,
            params.options,
            expectedMirrorGeneration,
        );
        if (linkResult === "mirror_not_ready") {
            return linkResult;
        }
        const state = await this.mirrorRepository.findState(params.documentId);
        if (!isCurrentVersionReady(state) || !state.branchId) {
            return linkResult;
        }

        // Service-record snapshots deliberately never mutate contract end dates.
        // Their 062 state is nevertheless part of the existing completed set.
        if (linkResult === "skipped") {
            if (!params.deferServiceRecordLifecycle) {
                await this.completeServiceRecordSnapshotFromReadyMirror({
                    branchId: state.branchId,
                    documentId: params.documentId,
                    mirrorVersion: {
                        detailSourceUpdatedDate: state.detailSourceUpdatedDate,
                        detailSyncedAt: state.detailSyncedAt,
                    },
                });
            }
            return linkResult;
        }
        if (!isFinalContractCompletion(state.detailPayload)) {
            return linkResult;
        }

        await this.syncLinkedContract({
            branchId: state.branchId,
            documentId: params.documentId,
            detail: state.detailPayload,
            mirrorVersion: {
                detailSourceUpdatedDate: state.detailSourceUpdatedDate,
                detailSyncedAt: state.detailSyncedAt,
            },
            throwOnError: params.throwOnCompletionReconciliationError,
        });
        return linkResult;
    }

    /**
     * Completion webhooks claim the branch-owned status after the mirror is ready.
     * Re-read that ready generation after the claim so service-record lifecycle
     * completion observes the relational status projection instead of its pre-claim
     * value. `null` means the mirror is not ready and must be retried; a boolean
     * means the mirror was ready and reports whether local lifecycle state changed.
     */
    async reconcileServiceRecordSnapshotCompletion(
        documentId: string,
    ): Promise<boolean | null> {
        const state = await this.mirrorRepository.findState(documentId);
        if (!isCurrentVersionReady(state) || !state.branchId) {
            return null;
        }
        return this.completeServiceRecordSnapshotFromReadyMirror({
            branchId: state.branchId,
            documentId,
            mirrorVersion: {
                detailSourceUpdatedDate: state.detailSourceUpdatedDate,
                detailSyncedAt: state.detailSyncedAt,
            },
        });
    }

    private async currentReadyMirrorGeneration(
        documentId: string,
    ): Promise<ExpectedEformsignMirrorGeneration | null> {
        const state = await this.mirrorRepository.findState(documentId);
        if (!isCurrentVersionReady(state)) return null;
        return {
            detailSourceUpdatedDate: state.detailSourceUpdatedDate,
            detailSyncedAt: state.detailSyncedAt,
        };
    }

    private async completeServiceRecordSnapshotFromReadyMirror(params: {
        branchId: string;
        documentId: string;
        mirrorVersion: {
            detailSourceUpdatedDate: Date;
            detailSyncedAt: Date;
        };
    }): Promise<boolean> {
        return (await this.serviceRecordLifecycle
            ?.completeServiceRecordSnapshotIfReady(params)) ?? false;
    }

    async syncLinkedContract(params: {
        branchId: string;
        documentId: string;
        detail: EformsignApiDocumentResponse;
        mirrorVersion?: {
            detailSourceUpdatedDate: Date;
            detailSyncedAt: Date;
        };
        throwOnError?: boolean;
    }): Promise<void> {
        try {
            const lifecycle = this.serviceRecordLifecycle;
            const persist = lifecycle
                ? {
                    persist: async (target: SyncedClientEndDate) => {
                        if (params.mirrorVersion) {
                            const applied = await lifecycle
                                .syncEndDateFromMirroredContract({
                                    branchId: params.branchId,
                                    clientId: target.clientId,
                                    endDate: target.endDate,
                                    documentId: params.documentId,
                                    detailSourceUpdatedDate:
                                        params.mirrorVersion.detailSourceUpdatedDate,
                                    detailSyncedAt:
                                        params.mirrorVersion.detailSyncedAt,
                                });
                            if (!applied && params.throwOnError) {
                                throw new Error(
                                    `Eformsign mirror generation changed before contract reconciliation for ${params.documentId}`,
                                );
                            }
                            return;
                        }
                        await lifecycle.syncEndDateFromContract({
                            branchId: params.branchId,
                            clientId: target.clientId,
                            endDate: target.endDate,
                        });
                    },
                }
                : {};
            await this.syncClientEndDateUsecase.executeFromDocument(
                params.branchId,
                params.documentId,
                params.detail,
                {
                    ...persist,
                    throwOnError: params.throwOnError,
                },
            );
        } catch (error) {
            this.logger.error(
                `Failed to sync end date for mirrored completion ${params.documentId}: ${sanitizeEformsignErrorMessage(error)}`,
            );
            if (params.throwOnError) {
                throw error;
            }
        }
    }
}

function isCurrentVersionReady(state: Awaited<ReturnType<IEformsignDocumentMirrorRepository["findState"]>>): state is NonNullable<Awaited<ReturnType<IEformsignDocumentMirrorRepository["findState"]>>> & {
    detailPayload: EformsignApiDocumentResponse;
    detailSourceUpdatedDate: Date;
    detailSyncedAt: Date;
} {
    if (
        !state?.detailPayload
        || !state.detailSourceUpdatedDate
        || !state.detailSyncedAt
        || state.syncStatus !== "ready"
        || Boolean(state.permanentPurgeRequestedAt)
    ) {
        return false;
    }
    return ["document", "audit_trail"].every((fileType) =>
        state.files.some((file) =>
            file.fileType === fileType
            && file.sourceUpdatedDate.getTime()
                === state.detailSourceUpdatedDate!.getTime(),
        ),
    );
}

function isFinalContractCompletion(detail: EformsignApiDocumentResponse): boolean {
    const statusType = normalizeEformsignStatusCode(detail.current_status?.status_type);
    return statusType !== "062" && EFORMSIGN_COMPLETED_STATUS_CODES.has(statusType);
}
