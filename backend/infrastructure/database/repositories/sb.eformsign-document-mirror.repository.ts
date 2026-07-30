import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";

import {
    EFORMSIGN_COMPLETED_STATUS_STORAGE_VALUES,
    UNASSIGNED_TERMINAL_STATUS_CODES,
} from "domain/constants/eformsign-doc-status.constants";
import {
    EformsignDocumentFileType,
    EformsignDocumentFileMetadata,
    EformsignDocumentMirrorState,
    EformsignDocumentSyncStatus,
    EformsignPermanentPurgeRequest,
    EformsignStoredDocumentFile,
    IEformsignDocumentMirrorRepository,
    MarkEformsignDocumentFileIntegrityFailureParams,
    SaveEformsignDocumentDetailParams,
    SaveEformsignDocumentFileParams,
} from "domain/repositories/eformsign-document-mirror.repository.interface";
import { EformsignApiDocumentResponse } from "domain/repositories/eformsign.client.interface";
import { isPendingEformsignDocColumnError } from "infrastructure/database/eformsign-doc-compat";
import { PrismaService } from "infrastructure/database/prisma.service";

const MAX_SYNC_ERROR_LENGTH = 2_000;
const DELETED_EFORMSIGN_STATUS_TYPES = ["047", "049", "099"];

@Injectable()
export class SbEformsignDocumentMirrorRepository
implements IEformsignDocumentMirrorRepository {
    constructor(private readonly prisma: PrismaService) {}

    async findState(documentId: string): Promise<EformsignDocumentMirrorState | null> {
        const row = await this.prisma.eformsign_doc.findUnique({
            where: { documentId },
            select: {
                documentId: true,
                branchId: true,
                detailPayload: true,
                detailSourceUpdatedDate: true,
                detailSyncedAt: true,
                syncStatus: true,
                syncError: true,
                permanentPurgeRequestedAt: true,
                files: {
                    select: {
                        fileType: true,
                        contentType: true,
                        contentDisposition: true,
                        byteSize: true,
                        sha256: true,
                        sourceUpdatedDate: true,
                        syncedAt: true,
                    },
                },
            },
        });
        if (!row) {
            return null;
        }

        return {
            documentId: row.documentId,
            branchId: row.branchId,
            detailPayload: row.detailPayload as EformsignApiDocumentResponse | null,
            detailSourceUpdatedDate: row.detailSourceUpdatedDate,
            detailSyncedAt: row.detailSyncedAt,
            syncStatus: row.syncStatus as EformsignDocumentSyncStatus,
            syncError: row.syncError,
            permanentPurgeRequestedAt: row.permanentPurgeRequestedAt,
            files: row.files.map(toFileMetadata),
        };
    }

    async findFile(
        documentId: string,
        fileType: EformsignDocumentFileType,
    ): Promise<EformsignStoredDocumentFile | null> {
        const document = await this.prisma.eformsign_doc.findUnique({
            where: { documentId },
            select: {
                detailPayload: true,
                detailSourceUpdatedDate: true,
                syncStatus: true,
                permanentPurgeRequestedAt: true,
                files: {
                    where: { fileType },
                    select: {
                        fileType: true,
                        content: true,
                        contentType: true,
                        contentDisposition: true,
                        byteSize: true,
                        sha256: true,
                        sourceUpdatedDate: true,
                        syncedAt: true,
                    },
                },
            },
        });
        const row = document?.files[0];
        if (!document?.detailPayload
            || !document.detailSourceUpdatedDate
            || document.syncStatus !== "ready"
            || Boolean(document.permanentPurgeRequestedAt)
            || !row
            || row.sourceUpdatedDate.getTime() !== document.detailSourceUpdatedDate.getTime()) {
            return null;
        }

        return {
            ...toFileMetadata(row),
            content: Buffer.from(row.content),
        };
    }

    async findActiveDocumentIds(): Promise<string[]> {
        const rows = await this.prisma.eformsign_doc.findMany({
            where: {
                statusType: { not: "049" },
                permanentPurgeRequestedAt: null,
            },
            select: { documentId: true },
        });
        return rows.map((row) => row.documentId);
    }

    /**
     * Of the given documents, those already in a terminal state locally.
     *
     * A delete cancels the document at the vendor first, and eformsign only cancels
     * in-progress documents. Terminal ones are refused, but they have no live signing
     * link left to revoke, so refusing to delete them locally would strand every
     * completed contract. This separates "refused because there was nothing to cancel"
     * from "refused for a reason we do not understand".
     *
     * Deliberately the unassigned set, which drops the review-stage codes 062 and 071:
     * those end the reviewer stage, not the document, so a review request can still
     * follow and the recipient's link is still live.
     */
    async findTerminalDocumentIds(documentIds: string[]): Promise<string[]> {
        if (documentIds.length === 0) {
            return [];
        }
        const rows = await this.prisma.eformsign_doc.findMany({
            where: {
                documentId: { in: documentIds },
                statusType: { in: [...UNASSIGNED_TERMINAL_STATUS_CODES] },
            },
            select: { documentId: true },
        });
        return rows.map((row) => row.documentId);
    }

    async findListExcludedDocumentIds(): Promise<string[]> {
        const rows = await this.prisma.eformsign_doc.findMany({
            where: {
                OR: [
                    { permanentPurgeRequestedAt: { not: null } },
                    // Match the shared list filter's deletion tombstones. Do not
                    // treat ordinary rejected/expired statuses as hidden rows.
                    { statusType: { in: ["047", "049", "099"] } },
                ],
            },
            select: { documentId: true },
        });
        return rows.map((row) => row.documentId);
    }

    async findUnreadyCompletedDocumentIds(): Promise<string[]> {
        try {
            const rows = await this.prisma.eformsign_doc.findMany({
                where: {
                    statusType: { in: [...EFORMSIGN_COMPLETED_STATUS_STORAGE_VALUES] },
                    syncStatus: { not: "ready" },
                },
                select: { documentId: true },
            });
            return rows.map((row) => row.documentId);
        } catch (error) {
            if (!isPendingEformsignDocColumnError(error)) {
                throw error;
            }

            // A database without sync_status cannot prove any completed row ready.
            const rows = await this.prisma.eformsign_doc.findMany({
                where: {
                    statusType: { in: [...EFORMSIGN_COMPLETED_STATUS_STORAGE_VALUES] },
                },
                select: { documentId: true },
            });
            return rows.map((row) => row.documentId);
        }
    }

    async findPermanentPurgeRequestedDocumentIds(): Promise<string[]> {
        const rows = await this.prisma.eformsign_doc.findMany({
            where: { permanentPurgeRequestedAt: { not: null } },
            select: { documentId: true },
        });
        return rows.map((row) => row.documentId);
    }

    async requestPermanentPurge(
        documentIds: string[],
    ): Promise<EformsignPermanentPurgeRequest[]> {
        const uniqueIds = [...new Set(documentIds)];
        if (uniqueIds.length === 0) return [];

        return this.prisma.$transaction(async (tx) => {
            // Match purgeContent/markDeleted's parent-row lock order. In
            // addition to avoiding overlapping-batch deadlocks, the held lock
            // makes the generation strictly monotonic for each document.
            const rows = await tx.$queryRaw<{
                documentId: string;
                permanentPurgeRequestedAt: Date | null;
            }[]>(Prisma.sql`
                SELECT
                    document_id AS "documentId",
                    permanent_purge_requested_at AS "permanentPurgeRequestedAt"
                FROM eformsign_doc
                WHERE document_id IN (${Prisma.join(uniqueIds)})
                ORDER BY id
                FOR UPDATE
            `);
            if (rows.length !== uniqueIds.length) {
                throw new Error("Could not persist permanent eformsign purge intent for every document");
            }

            const now = Date.now();
            const requests: EformsignPermanentPurgeRequest[] = [];
            for (const row of rows) {
                const generation = new Date(Math.max(
                    now,
                    (row.permanentPurgeRequestedAt?.getTime() ?? Number.NEGATIVE_INFINITY) + 1,
                ));
                await tx.eformsign_doc.update({
                    where: { documentId: row.documentId },
                    data: { permanentPurgeRequestedAt: generation },
                });
                requests.push({ documentId: row.documentId, generation });
            }
            return requests;
        });
    }

    async clearPermanentPurgeRequest(
        requests: EformsignPermanentPurgeRequest[],
    ): Promise<string[]> {
        const requestsByDocumentId = new Map(
            requests.map((request) => [request.documentId, request]),
        );
        const documentIds = [...requestsByDocumentId.keys()];
        if (documentIds.length === 0) return [];

        return this.prisma.$transaction(async (tx) => {
            // Match requestPermanentPurge, purgeContent, and markDeleted's
            // parent-row lock order. The conditional update remains the fence:
            // a newer request that completed before this lock is acquired simply
            // does not match this older generation.
            const rows = await tx.$queryRaw<{
                documentId: string;
            }[]>(Prisma.sql`
                SELECT document_id AS "documentId"
                FROM eformsign_doc
                WHERE document_id IN (${Prisma.join(documentIds)})
                ORDER BY id
                FOR UPDATE
            `);
            const cleared: string[] = [];
            for (const row of rows) {
                const request = requestsByDocumentId.get(row.documentId);
                if (!request) continue;
                const result = await tx.eformsign_doc.updateMany({
                    where: {
                        documentId: request.documentId,
                        permanentPurgeRequestedAt: request.generation,
                    },
                    data: { permanentPurgeRequestedAt: null },
                });
                if (result.count === 1) {
                    cleared.push(request.documentId);
                }
            }
            return cleared;
        });
    }

    async saveDetail(params: SaveEformsignDocumentDetailParams): Promise<boolean> {
        const result = await this.prisma.eformsign_doc.updateMany({
            where: {
                documentId: params.documentId,
                permanentPurgeRequestedAt: null,
                statusType: { notIn: DELETED_EFORMSIGN_STATUS_TYPES },
                OR: [
                    { detailSourceUpdatedDate: null },
                    { detailSourceUpdatedDate: { lt: params.sourceUpdatedDate } },
                    {
                        AND: [
                            { detailSourceUpdatedDate: params.sourceUpdatedDate },
                            { detailSyncedAt: params.expectedDetailSyncedAt },
                            ...(!params.allowReadySameVersionRepair
                                ? [{ syncStatus: { not: "ready" } }]
                                : []),
                        ],
                    },
                ],
            },
            data: {
                detailPayload: params.detailPayload as unknown as Prisma.InputJsonValue,
                customerPhone: params.customerPhone,
                detailSourceUpdatedDate: params.sourceUpdatedDate,
                detailSyncedAt: params.syncedAt,
                syncStatus: "syncing",
                syncError: null,
                syncErrorAt: null,
            },
        });
        if (result.count > 0) {
            return true;
        }
        if (result.count === 0) {
            await this.prisma.eformsign_doc.findUniqueOrThrow({
                where: { documentId: params.documentId },
                select: { id: true },
            });
        }
        return false;
    }

    async saveFile(params: SaveEformsignDocumentFileParams): Promise<boolean> {
        const data = {
            content: Uint8Array.from(params.content),
            contentType: params.contentType,
            contentDisposition: params.contentDisposition,
            byteSize: params.byteSize,
            sha256: params.sha256,
            sourceUpdatedDate: params.sourceUpdatedDate,
            syncedAt: params.syncedAt,
        };

        return this.prisma.$transaction(async (tx) => {
            // This lock serializes file writers with permanent-content purge.
            // The exact detail-version predicate also rejects downloads that
            // completed after a newer vendor document version was mirrored.
            const locked = await tx.$queryRaw<{ id: number }[]>(Prisma.sql`
                SELECT id
                FROM eformsign_doc
                WHERE document_id = ${params.documentId}
                  AND detail_source_updated_date = ${params.sourceUpdatedDate}
                  AND detail_synced_at = ${params.syncedAt}
                  AND detail_payload IS NOT NULL
                  AND status_type NOT IN ('047', '049', '099')
                  AND permanent_purge_requested_at IS NULL
                FOR UPDATE
            `);
            if (locked.length === 0) {
                await tx.eformsign_doc.findUniqueOrThrow({
                    where: { documentId: params.documentId },
                    select: { id: true },
                });
                return false;
            }

            const [document] = locked;
            if (!document) {
                return false;
            }
            const updateWhere = {
                eformsignDocId: document.id,
                fileType: params.fileType,
                sourceUpdatedDate: { lte: params.sourceUpdatedDate },
            };
            const updated = await tx.eformsign_doc_file.updateMany({
                where: updateWhere,
                data,
            });
            if (updated.count > 0) {
                return true;
            }

            try {
                await tx.eformsign_doc_file.create({
                    data: {
                        eformsignDocId: document.id,
                        fileType: params.fileType,
                        ...data,
                    },
                });
                return true;
            } catch (error) {
                if (!isPrismaUniqueConstraintError(error)) {
                    throw error;
                }
                // A webhook and the six-hour sweep may race on the same document.
                // Retry the timestamp-guarded update; a newer row deliberately wins.
                const retry = await tx.eformsign_doc_file.updateMany({
                    where: updateWhere,
                    data,
                });
                return retry.count > 0;
            }
        });
    }

    async markFileIntegrityFailure(
        params: MarkEformsignDocumentFileIntegrityFailureParams,
    ): Promise<void> {
        await this.prisma.eformsign_doc.updateMany({
            where: {
                documentId: params.documentId,
                detailSourceUpdatedDate: params.sourceUpdatedDate,
                syncStatus: "ready",
                permanentPurgeRequestedAt: null,
                files: {
                    some: {
                        fileType: params.fileType,
                        sourceUpdatedDate: params.sourceUpdatedDate,
                        syncedAt: params.syncedAt,
                        sha256: params.sha256,
                    },
                },
            },
            data: {
                syncStatus: "failed",
                syncError: normalizeErrorMessage(params.message),
                syncErrorAt: new Date(),
            },
        });
    }

    async markDeleted(documentIds: string[], deletedAt: Date): Promise<void> {
        const uniqueIds = [...new Set(documentIds)];
        if (uniqueIds.length === 0) {
            return;
        }
        await this.prisma.$transaction(async (tx) => {
            // Lock and read in the same transaction as purgeContent. A deletion
            // webhook that waits behind a permanent purge must see the scrubbed
            // row, never a pre-purge detail payload it could write back later.
            const rows = await tx.$queryRaw<{
                id: number;
                detailPayload: Prisma.JsonValue;
            }[]>(Prisma.sql`
                SELECT id, detail_payload AS "detailPayload"
                FROM eformsign_doc
                WHERE document_id IN (${Prisma.join(uniqueIds)})
                ORDER BY id
                FOR UPDATE
            `);
            for (const row of rows) {
                const detailPayload = markDetailPayloadDeleted(row.detailPayload);
                await tx.eformsign_doc.update({
                    where: { id: row.id },
                    data: {
                        statusType: "049",
                        statusDetail: "삭제",
                        updatedDate: deletedAt,
                        expired: false,
                        ...(detailPayload === undefined
                            ? {}
                            : { detailPayload }),
                        detailSourceUpdatedDate: deletedAt,
                        detailSyncedAt: deletedAt,
                        syncStatus: "ready",
                        syncError: null,
                        syncErrorAt: null,
                    },
                });
            }
        });
    }

    async purgeContent(documentIds: string[], deletedAt: Date): Promise<void> {
        if (documentIds.length === 0) {
            return;
        }
        await this.prisma.$transaction(async (tx) => {
            // Take the same parent-row lock as saveFile before deleting child
            // rows, so an in-flight download cannot recreate a purged file.
            const rows = await tx.$queryRaw<{ id: number; documentId: string }[]>(Prisma.sql`
                SELECT id, document_id AS "documentId"
                FROM eformsign_doc
                WHERE document_id IN (${Prisma.join(documentIds)})
                ORDER BY id
                FOR UPDATE
            `);
            if (rows.length === 0) {
                return;
            }
            const rowIds = rows.map((row) => row.id);
            await tx.client.updateMany({
                where: { eDocId: { in: rows.map((row) => row.documentId) } },
                data: { eDocId: null },
            });
            await tx.eformsign_doc_file.deleteMany({
                where: { eformsignDocId: { in: rowIds } },
            });
            await tx.eformsign_doc.updateMany({
                where: { id: { in: rowIds } },
                data: {
                    documentName: "삭제된 전자문서",
                    documentNumber: null,
                    customerName: null,
                    customerPhone: null,
                    creatorName: null,
                    lastEditorName: null,
                    stepRecipientTypes: null,
                    statusType: "049",
                    statusDetail: "영구 삭제",
                    stepType: "-",
                    stepIndex: "-",
                    stepName: "삭제됨",
                    stepRecipientType: "-",
                    stepRecipientName: "삭제됨",
                    stepRecipientSms: "-",
                    updatedDate: deletedAt,
                    expired: false,
                    clientId: null,
                    // A purge tombstone must retain only its deletion audit trail.
                    // Keep it out of client/service-record views and lifecycle
                    // readiness sets.
                    documentKind: null,
                    employeeScheduleId: null,
                    serviceRecordCaseId: null,
                    snapshotVersion: null,
                    snapshotChunkIndex: null,
                    detailPayload: Prisma.DbNull,
                    detailSourceUpdatedDate: deletedAt,
                    detailSyncedAt: deletedAt,
                    syncStatus: "ready",
                    syncError: null,
                    syncErrorAt: null,
                    // Clearing the intent is what ends the purge. It is not what keeps the
                    // document buried: the 049 status does that on its own, because the
                    // conditional upsert throws EformsignDocStaleUpdateError when the row
                    // exists and its staleGuard refuses, and only creates when no row exists
                    // at all. A retained intent instead means "we still owe the vendor a
                    // purge", which the reconcile sweep acts on — see the retry it drives in
                    // backfill-eformsign-docs.usecase.ts.
                    permanentPurgeRequestedAt: null,
                },
            });
        });
    }

    async markSyncFinished(
        documentId: string,
        sourceUpdatedDate: Date,
        syncedAt: Date,
        status: "ready" | "partial",
        message: string | null = null,
    ): Promise<boolean> {
        const normalizedMessage = normalizeErrorMessage(message);
        const result = await this.prisma.eformsign_doc.updateMany({
            where: {
                documentId,
                detailSourceUpdatedDate: sourceUpdatedDate,
                detailSyncedAt: syncedAt,
                syncStatus: "syncing",
                permanentPurgeRequestedAt: null,
            },
            data: {
                syncStatus: status,
                syncError: normalizedMessage,
                syncErrorAt: normalizedMessage ? new Date() : null,
            },
        });
        return result.count > 0;
    }

    async markSyncFailed(
        documentId: string,
        sourceUpdatedDate: Date,
        syncedAt: Date,
        message: string,
    ): Promise<void> {
        await this.prisma.eformsign_doc.updateMany({
            where: {
                documentId,
                detailSourceUpdatedDate: sourceUpdatedDate,
                detailSyncedAt: syncedAt,
                syncStatus: "syncing",
                permanentPurgeRequestedAt: null,
            },
            data: {
                syncStatus: "failed",
                syncError: normalizeErrorMessage(message),
                syncErrorAt: new Date(),
            },
        });
    }
}

function isPrismaUniqueConstraintError(error: unknown): boolean {
    return typeof error === "object"
        && error !== null
        && "code" in error
        && error.code === "P2002";
}

function markDetailPayloadDeleted(
    value: Prisma.JsonValue,
): Prisma.InputJsonValue | undefined {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
        return undefined;
    }
    const payload = value as Record<string, Prisma.JsonValue>;
    const currentStatusValue = payload["current_status"];
    const currentStatus =
        typeof currentStatusValue === "object"
        && currentStatusValue !== null
        && !Array.isArray(currentStatusValue)
            ? currentStatusValue as Record<string, Prisma.JsonValue>
            : {};

    return {
        ...payload,
        current_status: {
            ...currentStatus,
            status_type: "049",
            status_doc_type: "deleted",
            status_doc_detail: "삭제",
        },
    } as Prisma.InputJsonValue;
}

function normalizeErrorMessage(message: string | null | undefined): string | null {
    const normalized = message?.replace(/\s+/g, " ").trim();
    return normalized ? normalized.slice(0, MAX_SYNC_ERROR_LENGTH) : null;
}

function toFileMetadata(row: {
    fileType: string;
    contentType: string;
    contentDisposition: string | null;
    byteSize: number;
    sha256: string;
    sourceUpdatedDate: Date;
    syncedAt: Date;
}): EformsignDocumentFileMetadata {
    return {
        fileType: row.fileType as EformsignDocumentFileType,
        contentType: row.contentType,
        contentDisposition: row.contentDisposition,
        byteSize: row.byteSize,
        sha256: row.sha256,
        sourceUpdatedDate: row.sourceUpdatedDate,
        syncedAt: row.syncedAt,
    };
}
