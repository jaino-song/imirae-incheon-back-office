import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { EformsignDocEntity } from "domain/entities/eformsign-doc.entity";
import {
    EformsignDocCompletionClaimParams,
    EformsignDocCompletionClaimResult,
    EformsignDocClientSummary,
    EformsignDocDisplayFields,
    EformsignDocMappingError,
    EformsignDocUnscopedResult,
    IEformsignDocRepository,
} from "domain/repositories/eformsign-doc.repository.interface";
import { PrismaService } from "infrastructure/database/prisma.service";
import { EformsignDocMapper } from "infrastructure/database/mapper/eformsign-doc.mapper";

const EFORMSIGN_DOC_COMPAT_READ_SELECT = {
    id: true,
    documentId: true,
    createdDate: true,
    updatedDate: true,
    statusType: true,
    statusDetail: true,
    stepType: true,
    stepIndex: true,
    stepName: true,
    stepRecipientType: true,
    stepRecipientName: true,
    stepRecipientSms: true,
    expiredDate: true,
    expired: true,
    clientId: true,
} satisfies Prisma.eformsign_docSelect;

type EformsignDocCompatReadRow = Prisma.eformsign_docGetPayload<{
    select: typeof EFORMSIGN_DOC_COMPAT_READ_SELECT;
}>;

const PENDING_EFORMSIGN_DOC_COLUMN_NAMES = [
    "document_kind",
    "employee_schedule_id",
    "template_id",
    "document_name",
    "document_number",
    "documentKind",
    "employeeScheduleId",
    "templateId",
    "documentName",
    "documentNumber",
];

const isPendingEformsignDocColumnError = (error: unknown): boolean => {
    const code = typeof error === "object" && error !== null && "code" in error
        ? (error as { code?: unknown }).code
        : undefined;
    const column = typeof error === "object" && error !== null && "meta" in error
        ? (error as { meta?: { column?: unknown } }).meta?.column
        : undefined;
    const message = error instanceof Error ? error.message : String(error);
    const haystack = `${message} ${typeof column === "string" ? column : ""}`;

    if (code === "P2022") {
        return true;
    }

    if (!/column|does not exist/i.test(haystack)) {
        return false;
    }

    return PENDING_EFORMSIGN_DOC_COLUMN_NAMES.some((columnName) => haystack.includes(columnName));
};

const toCompatDomainRow = (row: EformsignDocCompatReadRow) => ({
    ...row,
    documentKind: null,
    employeeScheduleId: null,
    templateId: null,
    documentName: null,
    documentNumber: null,
});

const omitPendingEformsignDocColumns = <T extends {
    documentKind?: unknown;
    employeeScheduleId?: unknown;
    templateId?: unknown;
    documentName?: unknown;
    documentNumber?: unknown;
}>(data: T) => {
    const legacyData = { ...data };
    delete legacyData.documentKind;
    delete legacyData.employeeScheduleId;
    delete legacyData.templateId;
    delete legacyData.documentName;
    delete legacyData.documentNumber;
    return legacyData;
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
        return this.findFirstDomain({ id, branchId: branchid });
    }

    async findByDocumentId(branchid: string, documentId: string): Promise<EformsignDocEntity | null> {
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

            const doc = await this.prismaService.eformsign_doc.findUnique({
                where: { documentId },
                select: {
                    ...EFORMSIGN_DOC_COMPAT_READ_SELECT,
                    branchId: true,
                },
            });
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
        const data = {
            statusType: params.statusType,
            statusDetail: params.statusDetail,
            stepType: params.stepType,
            stepIndex: params.stepIndex,
            stepName: params.stepName,
            expired: params.expired,
            updatedDate: new Date(),
            documentName,
        };
        const where = {
            branchId: branchid,
            documentId: params.documentId,
            statusType: { not: params.statusType },
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
                data: omitPendingEformsignDocColumns(data),
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
            select: { id: true },
        });

        if (!existing) {
            return "missing";
        }

        if (documentName) {
            try {
                await this.prismaService.eformsign_doc.updateMany({
                    where: { id: existing.id, branchId: branchid },
                    data: { documentName },
                });
            } catch (error) {
                if (!isPendingEformsignDocColumnError(error)) {
                    throw error;
                }
            }
        }

        return "duplicate";
    }

    async findByClientId(branchid: string, clientId: number): Promise<EformsignDocEntity[]> {
        return this.findManyDomain({ clientId: clientId, branchId: branchid });
    }

    async findAll(branchid: string): Promise<EformsignDocEntity[]> {
        return this.findManyDomain({ branchId: branchid });
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
            where: { branchId: branchid },
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

            const created = await this.prismaService.eformsign_doc.create({
                data: omitPendingEformsignDocColumns(data),
                select: EFORMSIGN_DOC_COMPAT_READ_SELECT,
            });
            return EformsignDocMapper.toDomain(toCompatDomainRow(created));
        }
    }

    async update(branchid: string, doc: EformsignDocEntity): Promise<EformsignDocEntity> {
        if (!doc.id) {
            throw new Error("Cannot update eformsign_doc without id");
        }
        const data = EformsignDocMapper.toPrismaUpdate(doc);
        let result: Prisma.BatchPayload;

        try {
            result = await this.prismaService.eformsign_doc.updateMany({
                where: { id: doc.id, branchId: branchid },
                data,
            });
        } catch (error) {
            if (!isPendingEformsignDocColumnError(error)) {
                throw error;
            }

            result = await this.prismaService.eformsign_doc.updateMany({
                where: { id: doc.id, branchId: branchid },
                data: omitPendingEformsignDocColumns(data),
            });
        }

        if (result.count === 0) {
            throw new Error("Eformsign doc not found for branch");
        }
        const updated = await this.findFirstDomain({ id: doc.id, branchId: branchid });
        if (!updated) {
            throw new Error("Eformsign doc not found after update");
        }
        return updated;
    }

    async upsertByDocumentId(branchid: string, doc: EformsignDocEntity): Promise<EformsignDocEntity> {
        const existingOwner = await this.prismaService.eformsign_doc.findUnique({
            where: { documentId: doc.documentId },
            select: { branchId: true },
        });
        if (existingOwner?.branchId && existingOwner.branchId !== branchid) {
            throw new Error(`Eformsign document ${doc.documentId} belongs to another branch`);
        }

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

        try {
            const upserted = await this.prismaService.eformsign_doc.upsert({
                where: { documentId: doc.documentId },
                create,
                update,
            });
            return EformsignDocMapper.toDomain(upserted);
        } catch (error) {
            if (!isPendingEformsignDocColumnError(error)) {
                throw error;
            }

            const upserted = await this.prismaService.eformsign_doc.upsert({
                where: { documentId: doc.documentId },
                create: omitPendingEformsignDocColumns(create),
                update: omitPendingEformsignDocColumns(update),
                select: EFORMSIGN_DOC_COMPAT_READ_SELECT,
            });
            return EformsignDocMapper.toDomain(toCompatDomainRow(upserted));
        }
    }

    async upsertUnassignedByDocumentId(doc: EformsignDocEntity): Promise<EformsignDocEntity> {
        const documentName = doc.documentName?.trim() || undefined;
        const documentNumber = doc.documentNumber?.trim() || undefined;
        const templateId = doc.templateId?.trim() || undefined;
        const create = {
            ...EformsignDocMapper.toPrismaCreate(doc),
            documentName: documentName ?? null,
            documentNumber: documentNumber ?? null,
            templateId: templateId ?? null,
            branchId: null,
        };
        const update = {
            statusType: doc.statusType,
            statusDetail: doc.statusDetail,
            stepType: doc.stepType,
            stepIndex: doc.stepIndex,
            stepName: doc.stepName,
            expired: doc.expired,
            updatedDate: doc.updatedDate,
            ...(documentName ? { documentName } : {}),
            ...(templateId ? { templateId } : {}),
        };

        try {
            const upserted = await this.prismaService.eformsign_doc.upsert({
                where: { documentId: doc.documentId },
                create,
                update,
            });
            return EformsignDocMapper.toDomain(upserted);
        } catch (error) {
            if (!isPendingEformsignDocColumnError(error)) {
                throw error;
            }

            const upserted = await this.prismaService.eformsign_doc.upsert({
                where: { documentId: doc.documentId },
                create: omitPendingEformsignDocColumns(create),
                update: omitPendingEformsignDocColumns(update),
                select: EFORMSIGN_DOC_COMPAT_READ_SELECT,
            });
            return EformsignDocMapper.toDomain(toCompatDomainRow(upserted));
        }
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

            const doc = await this.prismaService.eformsign_doc.findFirst({
                where,
                select: EFORMSIGN_DOC_COMPAT_READ_SELECT,
            });
            return doc ? EformsignDocMapper.toDomain(toCompatDomainRow(doc)) : null;
        }
    }

    private async findManyDomain(where: Prisma.eformsign_docWhereInput): Promise<EformsignDocEntity[]> {
        try {
            const docs = await this.prismaService.eformsign_doc.findMany({ where });
            return docs.map(EformsignDocMapper.toDomain);
        } catch (error) {
            if (!isPendingEformsignDocColumnError(error)) {
                throw error;
            }

            const docs = await this.prismaService.eformsign_doc.findMany({
                where,
                select: EFORMSIGN_DOC_COMPAT_READ_SELECT,
            });
            return docs.map((doc) => EformsignDocMapper.toDomain(toCompatDomainRow(doc)));
        }
    }
}
