import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import {
    EFORMSIGN_COMPLETED_STATUS_STORAGE_VALUES,
    UNASSIGNED_FORWARD_STATUS_CODES_AFTER_REVIEW_STAGE,
    UNASSIGNED_REVIEW_STAGE_STATUS_STORAGE_VALUES,
    UNASSIGNED_TERMINAL_STATUS_CODES,
} from "domain/constants/eformsign-doc-status.constants";
import { EformsignDocEntity } from "domain/entities/eformsign-doc.entity";
import {
    EformsignDocCompletionClaimParams,
    EformsignDocCompletionClaimResult,
    EformsignDocClientSummary,
    EformsignDocDisplayFields,
    EformsignDocMappingError,
    EformsignDocOwnershipConflictError,
    EformsignDocStaleUpdateError,
    EformsignDocUnscopedResult,
    IEformsignDocRepository,
    UpsertUnassignedEformsignDocOptions,
} from "domain/repositories/eformsign-doc.repository.interface";
import {
    EFORMSIGN_DOC_DOMAIN_READ_SELECT,
    readWithEformsignDocCompat,
    isPendingEformsignDocColumnError,
    omitPendingEformsignDocColumns,
    toCompatDomainRow,
} from "infrastructure/database/eformsign-doc-compat";
import { PrismaService } from "infrastructure/database/prisma.service";
import { EformsignDocMapper } from "infrastructure/database/mapper/eformsign-doc.mapper";

const isUniqueConstraintError = (error: unknown): boolean =>
    typeof error === "object"
    && error !== null
    && "code" in error
    && (error as { code?: unknown }).code === "P2002";

const DELETED_EFORMSIGN_STATUS_TYPES = ["047", "049", "099"];
const COMPLETED_EFORMSIGN_STATUS_TYPES = [...EFORMSIGN_COMPLETED_STATUS_STORAGE_VALUES];
const MIRROR_LIST_NON_COMPLETED_WHERE: Prisma.eformsign_docWhereInput = {
    statusType: { notIn: COMPLETED_EFORMSIGN_STATUS_TYPES },
};
const MIRROR_LIST_VISIBILITY_WHERE: Prisma.eformsign_docWhereInput = {
    OR: [
        MIRROR_LIST_NON_COMPLETED_WHERE,
        {
            statusType: { in: COMPLETED_EFORMSIGN_STATUS_TYPES },
            syncStatus: "ready",
        },
    ],
};

const toUnscopedResult = (
    documentId: string,
    row: Parameters<typeof EformsignDocMapper.toDomain>[0] & { branchId: string | null },
): EformsignDocUnscopedResult => {
    try {
        return {
            document: EformsignDocMapper.toDomain(row),
            branchId: row.branchId,
        };
    } catch (error) {
        throw new EformsignDocMappingError(documentId, error);
    }
};

@Injectable()
export class SbEformsignDocRepository implements IEformsignDocRepository {
    constructor(private readonly prismaService: PrismaService) {}

    async findById(branchid: string, id: number): Promise<EformsignDocEntity | null> {
        return this.findFirstDomain({
            id,
            branchId: branchid,
            permanentPurgeRequestedAt: null,
        });
    }

    async findByDocumentId(branchid: string, documentId: string): Promise<EformsignDocEntity | null> {
        return this.findFirstDomain({
            documentId: documentId,
            branchId: branchid,
            permanentPurgeRequestedAt: null,
        });
    }

    async findByDocumentIdIncludingPurgePending(
        branchid: string,
        documentId: string,
    ): Promise<EformsignDocEntity | null> {
        return this.findFirstDomain({ documentId: documentId, branchId: branchid });
    }

    async findByDocumentIdUnscoped(documentId: string): Promise<EformsignDocUnscopedResult | null> {
        try {
            const doc = await this.prismaService.eformsign_doc.findUnique({
                where: { documentId },
            });
            return doc ? toUnscopedResult(documentId, doc) : null;
        } catch (error) {
            if (error instanceof EformsignDocMappingError) {
                throw error;
            }
            if (!isPendingEformsignDocColumnError(error)) {
                throw error;
            }

            const doc = await readWithEformsignDocCompat(error, (select) =>
                this.prismaService.eformsign_doc.findUnique({
                    where: { documentId },
                    select: { ...select, branchId: true },
                }));
            return doc
                ? toUnscopedResult(documentId, {
                    ...toCompatDomainRow(doc),
                    branchId: doc.branchId,
                })
                : null;
        }
    }

    async findBranchIdByDocumentId(documentId: string): Promise<string | null> {
        const doc = await this.prismaService.eformsign_doc.findUnique({
            where: { documentId },
            select: { branchId: true },
        });
        return doc?.branchId ?? null;
    }

    async claimCompletionStatus(
        branchid: string,
        params: EformsignDocCompletionClaimParams,
    ): Promise<EformsignDocCompletionClaimResult> {
        const documentName = params.documentName?.trim() || undefined;
        const templateName = params.templateName?.trim() || undefined;
        const data = {
            statusType: params.statusType,
            statusDetail: params.statusDetail,
            stepType: params.stepType,
            stepIndex: params.stepIndex,
            stepName: params.stepName,
            expired: params.expired,
            ...(params.sourceUpdatedDate
                ? { updatedDate: params.sourceUpdatedDate }
                : {}),
            documentName,
            templateName,
        };
        const where = {
            branchId: branchid,
            documentId: params.documentId,
            permanentPurgeRequestedAt: null,
            statusType: {
                notIn: [params.statusType, ...DELETED_EFORMSIGN_STATUS_TYPES],
            },
            ...(params.sourceUpdatedDate
                ? { updatedDate: { lt: params.sourceUpdatedDate } }
                : {}),
        };
        let result: Prisma.BatchPayload;

        try {
            result = await this.prismaService.eformsign_doc.updateMany({ where, data });
        } catch (error) {
            if (!isPendingEformsignDocColumnError(error)) {
                throw error;
            }
            result = await this.prismaService.eformsign_doc.updateMany({
                where,
                data: omitPendingEformsignDocColumns(data, error),
            });
        }

        if (result.count === 1) {
            return "claimed";
        }

        const existing = await this.prismaService.eformsign_doc.findFirst({
            where: {
                branchId: branchid,
                documentId: params.documentId,
            },
            select: {
                id: true,
                statusType: true,
                updatedDate: true,
                permanentPurgeRequestedAt: true,
            },
        });

        if (!existing) {
            return "missing";
        }

        if (
            existing.permanentPurgeRequestedAt
            || DELETED_EFORMSIGN_STATUS_TYPES.includes(existing.statusType)
        ) {
            return "stale";
        }

        if (
            params.sourceUpdatedDate
            && (
                existing.updatedDate.getTime() > params.sourceUpdatedDate.getTime()
                || (
                    existing.updatedDate.getTime() === params.sourceUpdatedDate.getTime()
                    && existing.statusType !== params.statusType
                )
            )
        ) {
            return "stale";
        }

        const canApplyMetadata = !params.sourceUpdatedDate
            || existing.updatedDate.getTime() < params.sourceUpdatedDate.getTime();
        if ((documentName || templateName) && canApplyMetadata) {
            const metadata = {
                ...(documentName ? { documentName } : {}),
                ...(templateName ? { templateName } : {}),
            };
            try {
                await this.prismaService.eformsign_doc.updateMany({
                    where: { id: existing.id, branchId: branchid },
                    data: metadata,
                });
            } catch (error) {
                if (!isPendingEformsignDocColumnError(error)) {
                    throw error;
                }
                const compatMetadata = omitPendingEformsignDocColumns(metadata, error);
                if (Object.keys(compatMetadata).length > 0) {
                    await this.prismaService.eformsign_doc.updateMany({
                        where: { id: existing.id, branchId: branchid },
                        data: compatMetadata,
                    });
                }
            }
        }

        return "duplicate";
    }

    async findByClientId(branchid: string, clientId: number): Promise<EformsignDocEntity[]> {
        return this.findManyDomain({
            clientId: clientId,
            branchId: branchid,
            permanentPurgeRequestedAt: null,
        });
    }

    async findAll(branchid: string): Promise<EformsignDocEntity[]> {
        return this.findManyDomain({
            branchId: branchid,
            permanentPurgeRequestedAt: null,
        });
    }

    async findAllVisibleInMirror(branchid: string): Promise<EformsignDocEntity[]> {
        return this.findManyVisibleInMirror({ branchId: branchid });
    }

    async findAllForHeadquarters(branchid: string): Promise<EformsignDocEntity[]> {
        // Mirrors the scan filter the API path uses: headquarters keeps everything except
        // what another branch owns, so an unclaimed document (branchId null) stays in.
        return this.findManyDomain({
            permanentPurgeRequestedAt: null,
            OR: [
                { branchId: branchid },
                { branchId: null },
            ],
        });
    }

    async findAllVisibleInMirrorForHeadquarters(
        branchid: string,
    ): Promise<EformsignDocEntity[]> {
        return this.findManyVisibleInMirror({
            OR: [
                { branchId: branchid },
                { branchId: null },
            ],
        });
    }

    async findDocumentIdsForOtherBranches(branchid: string): Promise<string[]> {
        // 다른 지점이 소유한 문서의 documentId만 추린다. branchId가 null인(미적재) 문서는
        // "지점 미지정"이라 인천(본사) 목록에 남아야 하므로 제외한다. Prisma의 `not`은
        // null을 포함하므로 `not: null`로 비-null을 명시적으로 강제한다.
        const docs = await this.prismaService.eformsign_doc.findMany({
            where: {
                branchId: { not: null },
                NOT: { branchId: branchid },
            },
            select: { documentId: true },
        });
        return docs.map((doc) => doc.documentId);
    }

    async findDisplayFieldsByDocumentIds(
        branchid: string,
        documentIds: string[],
    ): Promise<EformsignDocDisplayFields[]> {
        if (documentIds.length === 0) {
            return [];
        }

        const docs = await this.prismaService.eformsign_doc.findMany({
            where: {
                branchId: branchid,
                documentId: { in: documentIds },
                permanentPurgeRequestedAt: null,
            },
            select: {
                documentId: true,
                stepRecipientName: true,
            },
        });

        return docs.map((doc) => {
            const trimmed = doc.stepRecipientName.trim();
            // "수신자" is the adoption-time fallback sentinel, not a real
            // customer name — treat it as missing so enrichment falls through
            // to the cache/API path instead of displaying it forever.
            return {
                documentId: doc.documentId,
                customerName: trimmed && trimmed !== "수신자" ? trimmed : null,
            };
        });
    }

    async findClientNamesByBranch(branchid: string): Promise<EformsignDocClientSummary[]> {
        const docs = await this.prismaService.eformsign_doc.findMany({
            where: {
                branchId: branchid,
                permanentPurgeRequestedAt: null,
            },
            select: {
                documentId: true,
                clientId: true,
                stepRecipientName: true,
                documentKind: true,
                serviceRecordCase: { select: { momName: true } },
            },
        });
        const clientIds = Array.from(
            new Set(docs.map((d) => d.clientId).filter((id): id is number => id != null)),
        );
        const clients = clientIds.length > 0
            ? await this.prismaService.client.findMany({
                where: { id: { in: clientIds } },
                select: { id: true, name: true, phone: true },
            })
            : [];
        const schedules = clientIds.length > 0
            ? await this.prismaService.employee_schedule.findMany({
                where: {
                    clientId: { in: clientIds },
                    branchId: branchid,
                    replaced: false,
                },
                include: {
                    primaryEmployee: true,
                },
                orderBy: { id: "desc" },
            })
            : [];
        const clientById = new Map(clients.map((c) => [c.id, c]));
        const providerByClientId = new Map<number, string>();
        for (const schedule of schedules) {
            if (!providerByClientId.has(schedule.clientId)) {
                providerByClientId.set(schedule.clientId, schedule.primaryEmployee.name);
            }
        }
        return docs
            .filter((d) => Boolean(d.documentId))
            .map((d) => {
                const client = d.clientId == null ? undefined : clientById.get(d.clientId);
                const contractRecipientName = d.stepRecipientName.trim();
                const serviceRecordMomName = d.serviceRecordCase?.momName?.trim() ?? "";
                const clientName = d.documentKind === "service_record_snapshot"
                    ? serviceRecordMomName || client?.name || contractRecipientName || "삭제된 고객"
                    : contractRecipientName || client?.name || "삭제된 고객";
                return {
                    documentId: d.documentId,
                    clientId: d.clientId ?? null,
                    clientName,
                    clientPhone: client?.phone ?? null,
                    providerName: d.clientId == null
                        ? null
                        : providerByClientId.get(d.clientId) ?? null,
                };
            });
    }

    async create(branchid: string, doc: EformsignDocEntity): Promise<EformsignDocEntity> {
        const data = {
            ...EformsignDocMapper.toPrismaCreate(doc),
            branchId: branchid,
        };

        try {
            const created = await this.prismaService.eformsign_doc.create({ data });
            return EformsignDocMapper.toDomain(created);
        } catch (error) {
            if (!isPendingEformsignDocColumnError(error)) {
                throw error;
            }

            const created = await readWithEformsignDocCompat(error, (select) =>
                this.prismaService.eformsign_doc.create({
                    data: omitPendingEformsignDocColumns(data, error),
                    select,
                }));
            return EformsignDocMapper.toDomain(toCompatDomainRow(created));
        }
    }

    async update(
        branchid: string,
        doc: EformsignDocEntity,
    ): Promise<EformsignDocEntity> {
        return (await this.updateDocument(branchid, doc, false)).document;
    }

    async updateIfSourceNewer(
        branchid: string,
        doc: EformsignDocEntity,
    ): Promise<{ document: EformsignDocEntity; applied: boolean }> {
        return this.updateDocument(branchid, doc, true);
    }

    async linkClientIfActive(
        branchid: string,
        documentId: string,
        clientId: number,
    ): Promise<boolean> {
        return this.prismaService.$transaction(async (tx) => {
            // Permanent purge takes this same row lock before clearing eDocId and
            // writing the tombstone. Whichever transaction follows it must observe
            // the terminal row; whichever precedes it is cleared by the purge.
            const documents = await tx.$queryRaw<{ id: number; clientId: number | null }[]>(Prisma.sql`
                SELECT id, client_id AS "clientId"
                FROM eformsign_doc
                WHERE document_id = ${documentId}
                  AND branch_id = ${branchid}
                  AND permanent_purge_requested_at IS NULL
                  AND status_type NOT IN ('047', '049', '099')
                FOR UPDATE
            `);
            const document = documents[0];
            if (!document) {
                return false;
            }

            // Verify and lock the target before clearing the old pointer. Lock both
            // client rows in id order to preserve a consistent document -> client
            // order across competing relinks; a missing target must be a clean no-op.
            const clientIdsToLock = [document.clientId, clientId]
                .filter((id): id is number => id !== null)
                .filter((id, index, ids) => ids.indexOf(id) === index)
                .sort((left, right) => left - right);
            const lockedClients = await tx.$queryRaw<{ id: number }[]>(Prisma.sql`
                SELECT id
                FROM client
                WHERE id IN (${Prisma.join(clientIdsToLock)})
                  AND branch_id = ${branchid}
                ORDER BY id
                FOR UPDATE
            `);
            if (!lockedClients.some((client) => client.id === clientId)) {
                return false;
            }

            if (document.clientId !== null && document.clientId !== clientId) {
                // The eDocId unique key only permits one pointer. Clear the previous
                // owner's pointer first, but only if it still points at this document:
                // a newer contract pointer on that client must survive this relink.
                await tx.client.updateMany({
                    where: {
                        id: document.clientId,
                        branchId: branchid,
                        eDocId: documentId,
                    },
                    data: { eDocId: null },
                });
            }

            const client = await tx.client.updateMany({
                where: { id: clientId, branchId: branchid },
                data: { eDocId: documentId },
            });
            if (client.count !== 1) {
                // The target was locked above. A zero-row write after mutating the
                // old pointer is unexpected, so abort the transaction rather than
                // committing an orphaned document-to-client relationship.
                throw new Error("Client changed while linking eformsign document");
            }

            if (document.clientId !== clientId) {
                const reassigned = await tx.eformsign_doc.updateMany({
                    where: {
                        id: document.id,
                        branchId: branchid,
                        permanentPurgeRequestedAt: null,
                        statusType: { notIn: DELETED_EFORMSIGN_STATUS_TYPES },
                    },
                    data: { clientId },
                });
                if (reassigned.count !== 1) {
                    // We hold the parent-row lock, so this cannot be a normal
                    // contention result. Abort rather than commit a pointer that
                    // lacks its matching document ownership.
                    throw new Error("Eformsign document changed while linking client");
                }
            }

            return true;
        });
    }

    private async updateDocument(
        branchid: string,
        doc: EformsignDocEntity,
        onlyIfSourceNewer: boolean,
    ): Promise<{ document: EformsignDocEntity; applied: boolean }> {
        if (!doc.id) {
            throw new Error("Cannot update eformsign_doc without id");
        }
        const data = EformsignDocMapper.toPrismaUpdate(doc);
        // Keep the purge/deleted fence in the UPDATE predicate for every write, not
        // only webhook CAS writes: a permanent purge can otherwise finish between
        // a caller's read and this write and let the stale payload restore scrubbed PII.
        const updateWhere: Prisma.eformsign_docWhereInput = {
            id: doc.id,
            branchId: branchid,
            permanentPurgeRequestedAt: null,
            statusType: { notIn: DELETED_EFORMSIGN_STATUS_TYPES },
            ...(onlyIfSourceNewer ? { updatedDate: { lt: doc.updatedDate } } : {}),
        };
        let result: Prisma.BatchPayload;

        try {
            result = await this.prismaService.eformsign_doc.updateMany({
                where: updateWhere,
                data,
            });
        } catch (error) {
            if (!isPendingEformsignDocColumnError(error)) {
                throw error;
            }

            result = await this.prismaService.eformsign_doc.updateMany({
                where: updateWhere,
                data: omitPendingEformsignDocColumns(data, error),
            });
        }

        if (result.count === 0) {
            if (onlyIfSourceNewer) {
                const current = await this.findFirstDomain({ id: doc.id, branchId: branchid });
                if (current) {
                    return { document: current, applied: false };
                }
            }
            throw new Error("Eformsign doc not found for branch");
        }
        const updated = await this.findFirstDomain({ id: doc.id, branchId: branchid });
        if (!updated) {
            throw new Error("Eformsign doc not found after update");
        }
        return { document: updated, applied: true };
    }

    async upsertByDocumentId(branchid: string, doc: EformsignDocEntity): Promise<EformsignDocEntity> {
        const create = {
            ...EformsignDocMapper.toPrismaCreate(doc),
            branchId: branchid,
        };
        const update: Partial<ReturnType<typeof EformsignDocMapper.toPrismaUpdate>> & {
            branchId: string;
        } = {
            ...EformsignDocMapper.toPrismaUpdate(doc),
            branchId: branchid,
        };
        delete update.documentId;

        return this.conditionalUpsertByDocumentId({
            documentId: doc.documentId,
            create,
            update,
            allowedWhere: {
                documentId: doc.documentId,
                OR: [
                    { branchId: null },
                    { branchId: branchid },
                ],
            },
        });
    }

    async upsertUnassignedByDocumentId(
        doc: EformsignDocEntity,
        options?: UpsertUnassignedEformsignDocOptions,
    ): Promise<EformsignDocEntity> {
        const documentName = doc.documentName?.trim() || undefined;
        const documentNumber = doc.documentNumber?.trim() || undefined;
        const templateId = doc.templateId?.trim() || undefined;
        const templateName = doc.templateName?.trim() || undefined;
        const customerName = doc.customerName?.trim() || undefined;
        const creatorName = doc.creatorName?.trim() || undefined;
        const lastEditorName = doc.lastEditorName?.trim() || undefined;
        const stepRecipientTypes = EformsignDocMapper.toPrismaUpdate(doc).stepRecipientTypes;
        const create = {
            ...EformsignDocMapper.toPrismaCreate(doc),
            documentName: documentName ?? null,
            documentNumber: documentNumber ?? null,
            templateId: templateId ?? null,
            branchId: null,
        };
        const update = {
            statusType: doc.statusType,
            ...(options?.markMirrorPending ? { syncStatus: "pending" as const } : {}),
            ...(options?.updateStatusDetail === false ? {} : { statusDetail: doc.statusDetail }),
            stepType: doc.stepType,
            stepIndex: doc.stepIndex,
            stepName: doc.stepName,
            ...(options?.updateExpired === false ? {} : { expired: doc.expired }),
            ...(options?.updateExpiredDate === false ? {} : { expiredDate: doc.expiredDate }),
            ...(options?.updateCreatedDate === false ? {} : { createdDate: doc.createdDate }),
            updatedDate: doc.updatedDate,
            ...(documentName ? { documentName } : {}),
            ...(documentNumber ? { documentNumber } : {}),
            ...(templateId ? { templateId } : {}),
            ...(templateName ? { templateName } : {}),
            ...(options?.updateListDisplayFields && customerName ? { customerName } : {}),
            ...(options?.updateListDisplayFields && creatorName ? { creatorName } : {}),
            ...(options?.updateListDisplayFields && lastEditorName ? { lastEditorName } : {}),
            ...(options?.updateListDisplayFields && stepRecipientTypes
                ? { stepRecipientTypes }
                : {}),
        };

        const statusGuards: Prisma.eformsign_docWhereInput[] = [
            ...(UNASSIGNED_TERMINAL_STATUS_CODES.has(doc.statusType)
                ? []
                : [{
                    statusType: {
                        notIn: [...UNASSIGNED_TERMINAL_STATUS_CODES],
                    },
                }]),
            ...(UNASSIGNED_FORWARD_STATUS_CODES_AFTER_REVIEW_STAGE.has(doc.statusType)
                ? []
                : [{
                    OR: [
                        {
                            statusType: {
                                notIn: [...UNASSIGNED_REVIEW_STAGE_STATUS_STORAGE_VALUES],
                            },
                        },
                        { statusType: doc.statusType },
                    ],
                }]),
            ...(options?.markMirrorPending
                ? [{
                    // A completed projection owns a mirror attempt only if it advances
                    // the vendor generation or changes an open row into a completion.
                    // Equal-version completed retries must not downgrade a newer
                    // syncing/ready attempt back to pending.
                    OR: [
                        { updatedDate: { lt: doc.updatedDate } },
                        {
                            statusType: {
                                notIn: [...EFORMSIGN_COMPLETED_STATUS_STORAGE_VALUES],
                            },
                        },
                        ...(UNASSIGNED_TERMINAL_STATUS_CODES.has(doc.statusType)
                            ? [{
                                statusType: {
                                    in: [...UNASSIGNED_REVIEW_STAGE_STATUS_STORAGE_VALUES],
                                },
                            }]
                            : []),
                    ],
                }]
                : []),
        ];
        let statusGuard: Prisma.eformsign_docWhereInput = {};
        if (statusGuards.length === 1) {
            statusGuard = statusGuards[0] ?? {};
        } else if (statusGuards.length > 1) {
            statusGuard = { AND: statusGuards };
        }

        return this.conditionalUpsertByDocumentId({
            documentId: doc.documentId,
            create,
            update,
            allowedWhere: options?.allowAssignedUpdate
                ? { documentId: doc.documentId }
                : {
                    documentId: doc.documentId,
                    branchId: null,
                },
            // Monotonicity has to live in the write, not in a prior read: two webhooks for
            // the same document can both read the same stored updatedDate, both decide they
            // are newer, and the older one land last. lte rather than lt so an event that
            // carries no time of its own — it reuses the stored value — still applies.
            staleGuard: {
                updatedDate: { lte: doc.updatedDate },
                permanentPurgeRequestedAt: null,
                statusType: { notIn: DELETED_EFORMSIGN_STATUS_TYPES },
                ...statusGuard,
            },
            // Creation time is not state, so a refusal on ordering grounds must not take
            // it down with the rest. It has to be that way: a row written by create or
            // adopt carries the moment we wrote it, which is *newer* than the vendor's own
            // updated_date for an unchanged old document — so the guard refuses, and the
            // rows this repair exists for are exactly the ones it would never reach.
            ...(options?.updateCreatedDate === false
                ? {}
                : { repairCreatedDateWhenStale: doc.createdDate }),
        });
    }

    private async conditionalUpsertByDocumentId(params: {
        documentId: string;
        create: Prisma.eformsign_docUncheckedCreateInput;
        update: Prisma.eformsign_docUpdateManyMutationInput;
        allowedWhere: Prisma.eformsign_docWhereInput;
        staleGuard?: Prisma.eformsign_docWhereInput;
        repairCreatedDateWhenStale?: Date;
    }): Promise<EformsignDocEntity> {
        try {
            return await this.attemptConditionalUpsertByDocumentId(params);
        } catch (error) {
            if (!isPendingEformsignDocColumnError(error)) {
                throw error;
            }

            return this.attemptConditionalUpsertByDocumentId({
                ...params,
                create: omitPendingEformsignDocColumns(params.create, error),
                update: omitPendingEformsignDocColumns(params.update, error),
            }, error);
        }
    }

    private async attemptConditionalUpsertByDocumentId(
        params: {
            documentId: string;
            create: Prisma.eformsign_docUncheckedCreateInput;
            update: Prisma.eformsign_docUpdateManyMutationInput;
            allowedWhere: Prisma.eformsign_docWhereInput;
            staleGuard?: Prisma.eformsign_docWhereInput;
            repairCreatedDateWhenStale?: Date;
        },
        // The original missing-column error, not just a flag: the read select below has to
        // know which migration is absent so it keeps the columns that are not.
        compatibilityError?: unknown,
    ): Promise<EformsignDocEntity> {
        // Ownership is enforced by the UPDATE predicate itself. If no row matches,
        // create under the unique documentId constraint; a racing create surfaces as
        // P2002, after which the same predicate decides whether this caller may update
        // the winner. This keeps the read/check and write from becoming separate races.
        const updateWhere = params.staleGuard
            ? { AND: [params.allowedWhere, params.staleGuard] }
            : params.allowedWhere;
        const updateExisting = () => this.prismaService.eformsign_doc.updateMany({
            where: updateWhere,
            data: params.update,
        });
        // Zero rows now means one of two things. If a row still matches the ownership
        // predicate on its own, the write was refused for being stale and the caller must
        // do nothing; otherwise ownership moved and the caller has to handle it.
        const noRowsMatched = async () => {
            if (!params.staleGuard) {
                throw new EformsignDocOwnershipConflictError(params.documentId);
            }
            const ownedCount = await this.prismaService.eformsign_doc.count({
                where: params.allowedWhere,
            });
            if (ownedCount === 0) {
                throw new EformsignDocOwnershipConflictError(params.documentId);
            }

            // The row is ours and the event was refused for being older than what we hold.
            // Creation time is not state, though — it cannot be stale — and this is the
            // only path that ever reaches an adopted row, whose stored creation time is
            // the moment of adoption rather than the moment eformsign made the document.
            if (params.repairCreatedDateWhenStale !== undefined) {
                await this.prismaService.eformsign_doc.updateMany({
                    where: {
                        AND: [
                            params.allowedWhere,
                            { permanentPurgeRequestedAt: null },
                            { statusType: { notIn: DELETED_EFORMSIGN_STATUS_TYPES } },
                            { createdDate: { not: params.repairCreatedDateWhenStale } },
                        ],
                    },
                    data: { createdDate: params.repairCreatedDateWhenStale },
                });
            }
            throw new EformsignDocStaleUpdateError(params.documentId);
        };

        let updated = await updateExisting();
        if (updated.count === 0) {
            try {
                if (compatibilityError !== undefined) {
                    const created = await readWithEformsignDocCompat(
                        compatibilityError,
                        (select) => this.prismaService.eformsign_doc.create({
                            data: params.create,
                            select,
                        }));
                    return EformsignDocMapper.toDomain(toCompatDomainRow(created));
                }

                const created = await this.prismaService.eformsign_doc.create({
                    data: params.create,
                });
                return EformsignDocMapper.toDomain(created);
            } catch (error) {
                if (!isUniqueConstraintError(error)) {
                    throw error;
                }
            }

            updated = await updateExisting();
            if (updated.count === 0) {
                await noRowsMatched();
            }
        }

        const result = await this.findFirstDomain(params.allowedWhere);
        if (!result) {
            throw new EformsignDocOwnershipConflictError(params.documentId);
        }
        return result;
    }

    async delete(branchid: string, id: number): Promise<void> {
        await this.prismaService.eformsign_doc.deleteMany({
            where: { id, branchId: branchid },
        });
    }

    async deleteByDocumentId(branchid: string, documentId: string): Promise<void> {
        await this.prismaService.eformsign_doc.deleteMany({
            where: { documentId: documentId, branchId: branchid },
        });
    }

    private async findFirstDomain(where: Prisma.eformsign_docWhereInput): Promise<EformsignDocEntity | null> {
        try {
            const doc = await this.prismaService.eformsign_doc.findFirst({ where });
            return doc ? EformsignDocMapper.toDomain(doc) : null;
        } catch (error) {
            if (!isPendingEformsignDocColumnError(error)) {
                throw error;
            }

            const doc = await readWithEformsignDocCompat(error, (select) =>
                this.prismaService.eformsign_doc.findFirst({ where, select }));
            return doc ? EformsignDocMapper.toDomain(toCompatDomainRow(doc)) : null;
        }
    }

    private async findManyDomain(where: Prisma.eformsign_docWhereInput): Promise<EformsignDocEntity[]> {
        try {
            const docs = await this.prismaService.eformsign_doc.findMany({
                where,
                select: EFORMSIGN_DOC_DOMAIN_READ_SELECT,
            });
            return docs.map(EformsignDocMapper.toDomain);
        } catch (error) {
            if (!isPendingEformsignDocColumnError(error)) {
                throw error;
            }

            const docs = await readWithEformsignDocCompat(error, (select) =>
                this.prismaService.eformsign_doc.findMany({ where, select }));
            return docs.map((doc) => EformsignDocMapper.toDomain(toCompatDomainRow(doc)));
        }
    }

    private async findManyVisibleInMirror(
        scopeWhere: Prisma.eformsign_docWhereInput,
    ): Promise<EformsignDocEntity[]> {
        try {
            return await this.findManyDomain({
                permanentPurgeRequestedAt: null,
                AND: [
                    scopeWhere,
                    MIRROR_LIST_VISIBILITY_WHERE,
                ],
            });
        } catch (error) {
            if (!isPendingEformsignDocColumnError(error)) {
                throw error;
            }

            // During a code-first rollout sync_status may not exist yet. Without it,
            // no completed document can be proven to contain both required PDFs.
            return this.findManyDomain({
                permanentPurgeRequestedAt: null,
                AND: [
                    scopeWhere,
                    MIRROR_LIST_NON_COMPLETED_WHERE,
                ],
            });
        }
    }
}
