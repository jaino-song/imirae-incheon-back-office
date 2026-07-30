import { EformsignApiDocumentResponse } from "./eformsign.client.interface";

export const EFORMSIGN_DOCUMENT_MIRROR_REPOSITORY =
    "EFORMSIGN_DOCUMENT_MIRROR_REPOSITORY";

export type EformsignDocumentFileType = "document" | "audit_trail";
export type EformsignDocumentSyncStatus =
    | "pending"
    | "syncing"
    | "ready"
    | "partial"
    | "failed";

export interface EformsignDocumentFileMetadata {
    fileType: EformsignDocumentFileType;
    contentType: string;
    contentDisposition: string | null;
    byteSize: number;
    sha256: string;
    sourceUpdatedDate: Date;
    syncedAt: Date;
}

export interface EformsignStoredDocumentFile extends EformsignDocumentFileMetadata {
    content: Buffer;
}

export interface EformsignDocumentMirrorState {
    documentId: string;
    branchId: string | null;
    detailPayload: EformsignApiDocumentResponse | null;
    detailSourceUpdatedDate: Date | null;
    detailSyncedAt: Date | null;
    syncStatus: EformsignDocumentSyncStatus;
    syncError: string | null;
    permanentPurgeRequestedAt: Date | null;
    files: EformsignDocumentFileMetadata[];
}

/**
 * A durable permanent-purge intent generation for one document. Callers must
 * present this exact token when clearing intent so an older vendor response
 * cannot erase a newer retry's intent.
 */
export interface EformsignPermanentPurgeRequest {
    documentId: string;
    generation: Date;
}

export interface SaveEformsignDocumentDetailParams {
    documentId: string;
    detailPayload: EformsignApiDocumentResponse;
    customerPhone: string | null;
    sourceUpdatedDate: Date;
    /**
     * Attempt-generation observed before fetching the vendor detail. A same-version
     * retry may acquire the row only if no competing sync changed this value.
     */
    expectedDetailSyncedAt: Date | null;
    /**
     * A forced sync or a current-version repair may replace a ready row, but
     * only when the caller still owns the observed attempt generation.
     */
    allowReadySameVersionRepair: boolean;
    syncedAt: Date;
}

export interface SaveEformsignDocumentFileParams {
    documentId: string;
    fileType: EformsignDocumentFileType;
    content: Buffer;
    contentType: string;
    contentDisposition: string | null;
    byteSize: number;
    sha256: string;
    sourceUpdatedDate: Date;
    syncedAt: Date;
}

export interface MarkEformsignDocumentFileIntegrityFailureParams {
    documentId: string;
    fileType: EformsignDocumentFileType;
    sourceUpdatedDate: Date;
    syncedAt: Date;
    sha256: string;
    message: string;
}

export interface IEformsignDocumentMirrorRepository {
    findState(documentId: string): Promise<EformsignDocumentMirrorState | null>;
    findFile(
        documentId: string,
        fileType: EformsignDocumentFileType,
    ): Promise<EformsignStoredDocumentFile | null>;
    saveDetail(params: SaveEformsignDocumentDetailParams): Promise<boolean>;
    /**
     * Returns false when the document detail was superseded or permanently
     * purged while a file download was in flight.
     */
    saveFile(params: SaveEformsignDocumentFileParams): Promise<boolean>;
    /**
     * Fences corruption reports to the exact file version that was read, so a
     * stale reader cannot fail a file that a newer sync already repaired.
     */
    markFileIntegrityFailure(
        params: MarkEformsignDocumentFileIntegrityFailureParams,
    ): Promise<void>;
    findActiveDocumentIds(): Promise<string[]>;
    /**
     * Document ids excluded by a list request that hides deletion tombstones:
     * durable permanent-purge intent and terminal deletion tombstones alike.
     * This is intentionally global because document ids are globally unique and
     * cached HQ snapshots can contain both branch-owned and unassigned rows.
     */
    findListExcludedDocumentIds(): Promise<string[]>;
    /**
     * Completed rows that are not safe to publish from a cached mirror generation.
     * Global by document id so the same fence protects branch and headquarters caches.
     */
    findUnreadyCompletedDocumentIds(): Promise<string[]>;
    findPermanentPurgeRequestedDocumentIds(): Promise<string[]>;
    requestPermanentPurge(documentIds: string[]): Promise<EformsignPermanentPurgeRequest[]>;
    /** Returns only requests whose exact generation was still pending. */
    clearPermanentPurgeRequest(
        requests: EformsignPermanentPurgeRequest[],
    ): Promise<string[]>;
    markDeleted(documentIds: string[], deletedAt: Date): Promise<void>;
    purgeContent(documentIds: string[], deletedAt: Date): Promise<void>;
    /**
     * Returns false when a newer sync generation superseded this attempt before
     * it could publish its terminal state.
     */
    markSyncFinished(
        documentId: string,
        sourceUpdatedDate: Date,
        syncedAt: Date,
        status: Extract<EformsignDocumentSyncStatus, "ready" | "partial">,
        message?: string | null,
    ): Promise<boolean>;
    markSyncFailed(
        documentId: string,
        sourceUpdatedDate: Date,
        syncedAt: Date,
        message: string,
    ): Promise<void>;
}
