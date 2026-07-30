import { SbEformsignDocRepository } from "infrastructure/database/repositories/sb.eformsign-doc.repository";
import { PrismaService } from "infrastructure/database/prisma.service";
import {
    EFORMSIGN_COMPLETED_STATUS_STORAGE_VALUES,
    UNASSIGNED_FORWARD_STATUS_CODES_AFTER_REVIEW_STAGE,
    UNASSIGNED_REVIEW_STAGE_STATUS_CODES,
    UNASSIGNED_REVIEW_STAGE_STATUS_STORAGE_VALUES,
    UNASSIGNED_TERMINAL_STATUS_CODES,
} from "domain/constants/eformsign-doc-status.constants";
import { EformsignDocEntity } from "domain/entities/eformsign-doc.entity";
import {
    EformsignDocOwnershipConflictError,
    EformsignDocStaleUpdateError,
} from "domain/repositories/eformsign-doc.repository.interface";

describe("SbEformsignDocRepository", () => {
    const pendingColumnError = Object.assign(
        new Error("The column `eformsign_doc.document_kind` does not exist"),
        {
            code: "P2022",
            meta: { column: "eformsign_doc.document_kind" },
        },
    );
    const pendingColumnWithoutFieldError = Object.assign(
        new Error("[PrismaException] Code: P2022, Field: N/A"),
        { code: "P2022" },
    );

    const legacyRow = {
        id: 1,
        documentId: "doc-1",
        createdDate: new Date("2026-07-01T00:00:00.000Z"),
        updatedDate: new Date("2026-07-01T00:00:00.000Z"),
        statusType: "050",
        statusDetail: "완료",
        stepType: "05",
        stepIndex: "1",
        stepName: "이용자",
        stepRecipientType: "05",
        stepRecipientName: "송진호",
        stepRecipientSms: "01066211878",
        expiredDate: new Date("2026-08-01T00:00:00.000Z"),
        expired: false,
        clientId: 55,
    };

    const createEntity = () =>
        EformsignDocEntity.reconstitute({
            ...legacyRow,
            documentKind: null,
            employeeScheduleId: null,
            templateId: null,
            documentName: null,
            documentNumber: null,
        });

    const createMockPrismaEformsignDoc = () => ({
        findFirst: jest.fn(),
        findMany: jest.fn(),
        create: jest.fn(),
        updateMany: jest.fn(),
        deleteMany: jest.fn(),
        findUnique: jest.fn(),
        upsert: jest.fn(),
        // Used to tell a refused-as-stale write apart from one refused for ownership.
        count: jest.fn().mockResolvedValue(0),
    });

    let eformsignDocModel: ReturnType<typeof createMockPrismaEformsignDoc>;
    let repository: SbEformsignDocRepository;

    beforeEach(() => {
        eformsignDocModel = createMockPrismaEformsignDoc();
        repository = new SbEformsignDocRepository({
            eformsign_doc: eformsignDocModel,
        } as unknown as PrismaService);
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    it("retries client document reads with legacy columns when classification columns are pending", async () => {
        eformsignDocModel.findMany
            .mockRejectedValueOnce(pendingColumnError)
            .mockResolvedValueOnce([legacyRow]);

        const result = await repository.findByClientId("branch-1", 55);

        expect(eformsignDocModel.findMany).toHaveBeenNthCalledWith(1, {
            where: {
                clientId: 55,
                branchId: "branch-1",
                permanentPurgeRequestedAt: null,
            },
            select: expect.objectContaining({
                documentId: true,
                documentKind: true,
                templateId: true,
            }),
        });
        expect(eformsignDocModel.findMany.mock.calls[0][0].select)
            .not.toHaveProperty("detailPayload");
        expect(eformsignDocModel.findMany).toHaveBeenNthCalledWith(2, {
            where: {
                clientId: 55,
                branchId: "branch-1",
                permanentPurgeRequestedAt: null,
            },
            select: expect.objectContaining({
                documentId: true,
                statusType: true,
                clientId: true,
            }),
        });
        const retryArgs = eformsignDocModel.findMany.mock.calls[1][0];
        expect(retryArgs.select).not.toHaveProperty("documentKind");
        expect(result).toHaveLength(1);
        const [doc] = result;
        expect(doc!.documentId).toBe("doc-1");
        expect(doc!.documentKind).toBeNull();
    });

    it("does not load detail JSON or PDF relations for list-domain reads", async () => {
        eformsignDocModel.findMany.mockResolvedValue([{
            ...legacyRow,
            documentKind: null,
            employeeScheduleId: null,
            templateId: "template-1",
            documentName: "계약서",
            documentNumber: "DOC-1",
            templateName: "표준 계약서",
            customerName: "김고객",
            creatorName: "담당자",
            lastEditorName: "담당자",
            stepRecipientTypes: "02,06",
        }]);

        await expect(repository.findAll("branch-1")).resolves.toHaveLength(1);

        expect(eformsignDocModel.findMany).toHaveBeenCalledWith(expect.objectContaining({
            where: {
                branchId: "branch-1",
                permanentPurgeRequestedAt: null,
            },
        }));
        const select = eformsignDocModel.findMany.mock.calls[0][0].select;
        expect(select).not.toHaveProperty("detailPayload");
        expect(select).not.toHaveProperty("files");
        expect(select).not.toHaveProperty("syncError");
    });

    it("excludes purge-pending rows from the headquarters list", async () => {
        eformsignDocModel.findMany.mockResolvedValue([legacyRow]);

        await expect(repository.findAllForHeadquarters("branch-1")).resolves.toHaveLength(1);

        expect(eformsignDocModel.findMany).toHaveBeenCalledWith(expect.objectContaining({
            where: {
                permanentPurgeRequestedAt: null,
                OR: [
                    { branchId: "branch-1" },
                    { branchId: null },
                ],
            },
        }));
    });

    it("shows completed branch documents only after the mirror is ready", async () => {
        eformsignDocModel.findMany.mockResolvedValue([legacyRow]);

        await expect(repository.findAllVisibleInMirror("branch-1")).resolves.toHaveLength(1);

        const completedStatuses = [...EFORMSIGN_COMPLETED_STATUS_STORAGE_VALUES];
        expect(eformsignDocModel.findMany).toHaveBeenCalledWith(expect.objectContaining({
            where: {
                permanentPurgeRequestedAt: null,
                AND: [
                    { branchId: "branch-1" },
                    {
                        OR: [
                            { statusType: { notIn: completedStatuses } },
                            {
                                statusType: { in: completedStatuses },
                                syncStatus: "ready",
                            },
                        ],
                    },
                ],
            },
        }));
    });

    it("applies the same completed-ready gate to headquarters and unclaimed rows", async () => {
        eformsignDocModel.findMany.mockResolvedValue([legacyRow]);

        await expect(repository.findAllVisibleInMirrorForHeadquarters("branch-1"))
            .resolves.toHaveLength(1);

        const completedStatuses = [...EFORMSIGN_COMPLETED_STATUS_STORAGE_VALUES];
        expect(eformsignDocModel.findMany).toHaveBeenCalledWith(expect.objectContaining({
            where: {
                permanentPurgeRequestedAt: null,
                AND: [
                    {
                        OR: [
                            { branchId: "branch-1" },
                            { branchId: null },
                        ],
                    },
                    {
                        OR: [
                            { statusType: { notIn: completedStatuses } },
                            {
                                statusType: { in: completedStatuses },
                                syncStatus: "ready",
                            },
                        ],
                    },
                ],
            },
        }));
    });

    it.each([
        {
            label: "branch",
            read: (subject: SbEformsignDocRepository) =>
                subject.findAllVisibleInMirror("branch-1"),
            scope: { branchId: "branch-1" },
        },
        {
            label: "headquarters",
            read: (subject: SbEformsignDocRepository) =>
                subject.findAllVisibleInMirrorForHeadquarters("branch-1"),
            scope: {
                OR: [
                    { branchId: "branch-1" },
                    { branchId: null },
                ],
            },
        },
    ])("fails closed for completed $label rows when sync_status is not deployed", async ({
        read,
        scope,
    }) => {
        const missingSyncStatus = Object.assign(
            new Error("The column `eformsign_doc.sync_status` does not exist"),
            {
                code: "P2022",
                meta: { column: "eformsign_doc.sync_status" },
            },
        );
        eformsignDocModel.findMany.mockImplementation(async (query: {
            where?: unknown;
        }) => {
            if (JSON.stringify(query.where).includes("syncStatus")) {
                throw missingSyncStatus;
            }
            return [legacyRow];
        });

        await expect(read(repository)).resolves.toHaveLength(1);

        expect(eformsignDocModel.findMany).toHaveBeenLastCalledWith({
            where: {
                permanentPurgeRequestedAt: null,
                AND: [
                    scope,
                    {
                        statusType: {
                            notIn: [...EFORMSIGN_COMPLETED_STATUS_STORAGE_VALUES],
                        },
                    },
                ],
            },
            select: expect.any(Object),
        });
    });

    it("retries document reads when Prisma reports P2022 without column metadata", async () => {
        eformsignDocModel.findFirst
            .mockRejectedValueOnce(pendingColumnWithoutFieldError)
            .mockResolvedValueOnce(legacyRow);

        const result = await repository.findByDocumentId("branch-1", "doc-1");

        expect(eformsignDocModel.findFirst).toHaveBeenNthCalledWith(1, {
            where: {
                documentId: "doc-1",
                branchId: "branch-1",
                permanentPurgeRequestedAt: null,
            },
        });
        expect(eformsignDocModel.findFirst).toHaveBeenNthCalledWith(2, {
            where: {
                documentId: "doc-1",
                branchId: "branch-1",
                permanentPurgeRequestedAt: null,
            },
            select: expect.objectContaining({
                documentId: true,
                statusType: true,
                clientId: true,
            }),
        });
        expect(result?.documentId).toBe("doc-1");
        expect(result?.documentKind).toBeNull();
    });

    it("uses an explicit ownership-only lookup for a pending permanent-purge retry", async () => {
        eformsignDocModel.findFirst.mockResolvedValue(legacyRow);

        await repository.findByDocumentIdIncludingPurgePending("branch-1", "doc-1");

        expect(eformsignDocModel.findFirst).toHaveBeenCalledWith({
            where: { documentId: "doc-1", branchId: "branch-1" },
        });
    });

    it("reconstitutes an orphaned document with a null clientId", async () => {
        eformsignDocModel.findFirst.mockResolvedValue({
            ...legacyRow,
            clientId: null,
            documentKind: "service_record_snapshot",
            employeeScheduleId: null,
            templateId: "template-1",
        });

        const result = await repository.findByDocumentId("branch-1", "doc-1");

        expect(result?.clientId).toBeNull();
        expect(result?.documentKind).toBe("service_record_snapshot");
    });

    it("finds a document without adding branchId to the unique where clause", async () => {
        eformsignDocModel.findUnique.mockResolvedValue({
            ...legacyRow,
            branchId: null,
            clientId: null,
            documentKind: null,
            employeeScheduleId: null,
            templateId: "template-1",
            documentName: "외부 문서",
            documentNumber: "DOC-001",
            templateName: "표준 계약서",
            customerName: "김고객",
            creatorName: "생성자",
            lastEditorName: "편집자",
            stepRecipientTypes: "05,06",
        });

        const result = await repository.findByDocumentIdUnscoped("doc-1");

        expect(eformsignDocModel.findUnique).toHaveBeenCalledWith({
            where: { documentId: "doc-1" },
        });
        expect(eformsignDocModel.findUnique.mock.calls[0][0].where).not.toHaveProperty("branchId");
        expect(result?.branchId).toBeNull();
        expect(result?.document.documentName).toBe("외부 문서");
    });

    it("loads page display fields with one branch-scoped query", async () => {
        eformsignDocModel.findMany.mockResolvedValue([
            {
                documentId: "doc-1",
                stepRecipientName: "  송진호  ",
            },
            {
                documentId: "doc-2",
                stepRecipientName: "   ",
            },
        ]);

        const result = await repository.findDisplayFieldsByDocumentIds(
            "branch-1",
            ["doc-1", "doc-2"],
        );

        expect(eformsignDocModel.findMany).toHaveBeenCalledTimes(1);
        expect(eformsignDocModel.findMany).toHaveBeenCalledWith({
            where: {
                branchId: "branch-1",
                documentId: { in: ["doc-1", "doc-2"] },
                permanentPurgeRequestedAt: null,
            },
            select: {
                documentId: true,
                stepRecipientName: true,
            },
        });
        expect(result).toEqual([
            { documentId: "doc-1", customerName: "송진호" },
            { documentId: "doc-2", customerName: null },
        ]);
    });

    it("retries status updates without pending classification columns", async () => {
        eformsignDocModel.updateMany
            .mockRejectedValueOnce(pendingColumnError)
            .mockResolvedValueOnce({ count: 1 });
        eformsignDocModel.findFirst
            .mockRejectedValueOnce(pendingColumnError)
            .mockResolvedValueOnce(legacyRow);

        const result = await repository.update("branch-1", createEntity());

        expect(eformsignDocModel.updateMany).toHaveBeenNthCalledWith(
            1,
            expect.objectContaining({
                data: expect.objectContaining({ documentKind: null }),
            }),
        );
        expect(eformsignDocModel.updateMany).toHaveBeenNthCalledWith(
            2,
            expect.objectContaining({
                data: expect.any(Object),
            }),
        );
        const retryData = eformsignDocModel.updateMany.mock.calls[1][0].data;
        expect(retryData).not.toHaveProperty("documentKind");
        expect(retryData).not.toHaveProperty("employeeScheduleId");
        expect(retryData).not.toHaveProperty("templateId");
        expect(retryData).not.toHaveProperty("documentName");
        expect(retryData).not.toHaveProperty("documentNumber");
        expect(result.statusType).toBe("050");
    });

    it("returns the newer branch-owned row when a status CAS refuses a stale webhook", async () => {
        const stale = EformsignDocEntity.reconstitute({
            ...createEntity().toJSON(),
            updatedDate: new Date("2026-07-01T00:00:00.000Z"),
        });
        eformsignDocModel.updateMany.mockResolvedValue({ count: 0 });
        const currentUpdatedDate = new Date("2026-07-02T00:00:00.000Z");
        eformsignDocModel.findFirst.mockResolvedValue({
            ...legacyRow,
            updatedDate: currentUpdatedDate,
        });

        const result = await repository.updateIfSourceNewer("branch-1", stale);

        expect(eformsignDocModel.updateMany).toHaveBeenCalledWith(expect.objectContaining({
            where: {
                id: 1,
                branchId: "branch-1",
                updatedDate: { lt: new Date("2026-07-01T00:00:00.000Z") },
                permanentPurgeRequestedAt: null,
                statusType: { notIn: ["047", "049", "099"] },
            },
        }));
        expect(result).toEqual({
            document: expect.objectContaining({ updatedDate: currentUpdatedDate }),
            applied: false,
        });
    });

    it("fences a stale ordinary update after a concurrent permanent purge", async () => {
        // LinkDocumentToClient can hold this pre-purge payload while the purge commits.
        // The UPDATE predicate, rather than a prior read, must prevent it restoring PII.
        eformsignDocModel.updateMany.mockResolvedValue({ count: 0 });

        await expect(repository.update("branch-1", createEntity())).rejects.toThrow(
            "Eformsign doc not found for branch",
        );

        expect(eformsignDocModel.updateMany).toHaveBeenCalledWith({
            where: {
                id: 1,
                branchId: "branch-1",
                permanentPurgeRequestedAt: null,
                statusType: { notIn: ["047", "049", "099"] },
            },
            data: expect.objectContaining({
                clientId: 55,
                stepRecipientName: "송진호",
                stepRecipientSms: "01066211878",
            }),
        });
        expect(eformsignDocModel.findFirst).not.toHaveBeenCalled();
    });

    it("allows an ordinary update for a live, non-purge-pending document", async () => {
        eformsignDocModel.updateMany.mockResolvedValue({ count: 1 });
        eformsignDocModel.findFirst.mockResolvedValue(legacyRow);

        const result = await repository.update("branch-1", createEntity());

        expect(result.statusType).toBe("050");
        expect(eformsignDocModel.updateMany).toHaveBeenCalledWith(expect.objectContaining({
            where: {
                id: 1,
                branchId: "branch-1",
                permanentPurgeRequestedAt: null,
                statusType: { notIn: ["047", "049", "099"] },
            },
        }));
    });

    it("atomically moves the document pointer from the old client to the new client", async () => {
        const transaction = {
            $queryRaw: jest.fn()
                .mockResolvedValueOnce([{ id: 1, clientId: 7 }])
                .mockResolvedValueOnce([{ id: 7 }, { id: 12 }]),
            client: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
            eformsign_doc: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
        };
        const prisma = {
            eformsign_doc: eformsignDocModel,
            $transaction: jest.fn((callback) => callback(transaction)),
        } as unknown as PrismaService;
        const transactionalRepository = new SbEformsignDocRepository(prisma);

        await expect(
            transactionalRepository.linkClientIfActive("branch-1", "doc-1", 12),
        ).resolves.toBe(true);

        const lockSql = transaction.$queryRaw.mock.calls[0][0];
        expect(lockSql.strings.join(" ")).toContain("permanent_purge_requested_at IS NULL");
        expect(lockSql.strings.join(" ")).toContain("status_type NOT IN ('047', '049', '099')");
        expect(lockSql.strings.join(" ")).toContain("FOR UPDATE");
        expect(transaction.client.updateMany).toHaveBeenCalledTimes(2);
        expect(transaction.client.updateMany).toHaveBeenNthCalledWith(1, {
            where: {
                id: 7,
                branchId: "branch-1",
                eDocId: "doc-1",
            },
            data: { eDocId: null },
        });
        expect(transaction.client.updateMany).toHaveBeenNthCalledWith(2, {
            where: { id: 12, branchId: "branch-1" },
            data: { eDocId: "doc-1" },
        });
        expect(transaction.eformsign_doc.updateMany).toHaveBeenCalledWith({
            where: {
                id: 1,
                branchId: "branch-1",
                permanentPurgeRequestedAt: null,
                statusType: { notIn: ["047", "049", "099"] },
            },
            data: { clientId: 12 },
        });
    });

    it("leaves the old pointer untouched when the target client disappeared before locking", async () => {
        const transaction = {
            $queryRaw: jest.fn()
                .mockResolvedValueOnce([{ id: 1, clientId: 7 }])
                .mockResolvedValueOnce([{ id: 7 }]),
            client: { updateMany: jest.fn() },
            eformsign_doc: { updateMany: jest.fn() },
        };
        const prisma = {
            eformsign_doc: eformsignDocModel,
            $transaction: jest.fn((callback) => callback(transaction)),
        } as unknown as PrismaService;
        const transactionalRepository = new SbEformsignDocRepository(prisma);

        await expect(
            transactionalRepository.linkClientIfActive("branch-1", "doc-1", 12),
        ).resolves.toBe(false);

        expect(transaction.client.updateMany).not.toHaveBeenCalled();
        expect(transaction.eformsign_doc.updateMany).not.toHaveBeenCalled();
    });

    it("does not restore a client pointer when permanent purge owns the document lock", async () => {
        const transaction = {
            $queryRaw: jest.fn().mockResolvedValue([]),
            client: { updateMany: jest.fn() },
            eformsign_doc: { updateMany: jest.fn() },
        };
        const prisma = {
            eformsign_doc: eformsignDocModel,
            $transaction: jest.fn((callback) => callback(transaction)),
        } as unknown as PrismaService;
        const transactionalRepository = new SbEformsignDocRepository(prisma);

        await expect(
            transactionalRepository.linkClientIfActive("branch-1", "doc-1", 7),
        ).resolves.toBe(false);

        expect(transaction.client.updateMany).not.toHaveBeenCalled();
        expect(transaction.eformsign_doc.updateMany).not.toHaveBeenCalled();
    });

    it("adopts an unassigned row for the branch without creating a duplicate", async () => {
        eformsignDocModel.updateMany.mockResolvedValue({ count: 1 });
        eformsignDocModel.findFirst.mockResolvedValue({
            ...legacyRow,
            branchId: "branch-1",
            documentKind: null,
            employeeScheduleId: null,
            templateId: null,
            documentName: "기존 문서명",
            documentNumber: "DOC-001",
        });

        const result = await repository.upsertByDocumentId("branch-1", createEntity());

        expect(eformsignDocModel.updateMany).toHaveBeenCalledWith(
            expect.objectContaining({
                where: {
                    documentId: "doc-1",
                    OR: [{ branchId: null }, { branchId: "branch-1" }],
                },
                data: expect.objectContaining({ branchId: "branch-1" }),
            }),
        );
        expect(eformsignDocModel.create).not.toHaveBeenCalled();
        expect(result.documentName).toBe("기존 문서명");
    });

    it("preserves stored document metadata when adopting without a name or number", async () => {
        eformsignDocModel.updateMany.mockResolvedValue({ count: 1 });
        eformsignDocModel.findFirst.mockResolvedValue({
            ...legacyRow,
            branchId: "branch-1",
            documentKind: null,
            employeeScheduleId: null,
            templateId: null,
            documentName: "기존 문서명",
            documentNumber: "DOC-001",
        });

        const result = await repository.upsertByDocumentId("branch-1", createEntity());

        const updateData = eformsignDocModel.updateMany.mock.calls[0][0].data;
        expect(updateData).not.toHaveProperty("documentId");
        expect(updateData).not.toHaveProperty("documentName");
        expect(updateData).not.toHaveProperty("documentNumber");
        expect(result.documentName).toBe("기존 문서명");
        expect(result.documentNumber).toBe("DOC-001");
    });

    it("creates a branch-owned row through the documentId upsert when no local row exists", async () => {
        eformsignDocModel.updateMany.mockResolvedValue({ count: 0 });
        eformsignDocModel.create.mockResolvedValue({
            ...legacyRow,
            branchId: "branch-1",
            documentKind: null,
            employeeScheduleId: null,
            templateId: null,
            documentName: null,
            documentNumber: null,
        });

        await repository.upsertByDocumentId("branch-1", createEntity());

        expect(eformsignDocModel.create).toHaveBeenCalledWith(
            expect.objectContaining({
                data: expect.objectContaining({
                    documentId: "doc-1",
                    branchId: "branch-1",
                }),
            }),
        );
    });

    it("updates an existing row owned by the same branch through the documentId upsert", async () => {
        eformsignDocModel.updateMany.mockResolvedValue({ count: 1 });
        eformsignDocModel.findFirst.mockResolvedValue({
            ...legacyRow,
            branchId: "branch-1",
            documentKind: null,
            employeeScheduleId: null,
            templateId: null,
            documentName: null,
            documentNumber: null,
        });

        await repository.upsertByDocumentId("branch-1", createEntity());

        expect(eformsignDocModel.updateMany).toHaveBeenCalledWith(
            expect.objectContaining({
                where: {
                    documentId: "doc-1",
                    OR: [{ branchId: null }, { branchId: "branch-1" }],
                },
                data: expect.objectContaining({
                    branchId: "branch-1",
                    statusType: "050",
                }),
            }),
        );
        expect(eformsignDocModel.create).not.toHaveBeenCalled();
    });

    it("retries the conditional documentId update and read without pending columns", async () => {
        eformsignDocModel.updateMany
            .mockRejectedValueOnce(pendingColumnError)
            .mockResolvedValueOnce({ count: 1 });
        eformsignDocModel.findFirst
            .mockRejectedValueOnce(pendingColumnError)
            .mockResolvedValueOnce(legacyRow);

        await repository.upsertByDocumentId("branch-1", createEntity());

        const retry = eformsignDocModel.updateMany.mock.calls[1][0];
        expect(retry.where).toEqual({
            documentId: "doc-1",
            OR: [{ branchId: null }, { branchId: "branch-1" }],
        });
        expect(retry.data).not.toHaveProperty("documentId");
        expect(retry.data).not.toHaveProperty("documentKind");
        expect(retry.data).not.toHaveProperty("employeeScheduleId");
        expect(eformsignDocModel.findFirst).toHaveBeenNthCalledWith(
            2,
            expect.objectContaining({
                select: expect.objectContaining({ documentId: true }),
            }),
        );
    });

    it("does not transfer a document already owned by another branch", async () => {
        eformsignDocModel.updateMany.mockResolvedValue({ count: 0 });
        eformsignDocModel.create.mockRejectedValue(
            Object.assign(new Error("Unique constraint failed"), { code: "P2002" }),
        );

        await expect(
            repository.upsertByDocumentId("branch-1", createEntity()),
        ).rejects.toThrow("belongs to another branch");

        expect(eformsignDocModel.upsert).not.toHaveBeenCalled();
        expect(eformsignDocModel.updateMany).toHaveBeenCalledTimes(2);
    });

    it("allows only one branch to atomically adopt the same unassigned document", async () => {
        let owner: string | null = null;
        eformsignDocModel.updateMany.mockImplementation(
            ({ where, data }: {
                where: {
                    documentId: string;
                    OR?: Array<{ branchId: string | null }>;
                };
                data: { branchId?: string };
            }) => {
                const allowedOwners = where.OR?.map((candidate) => candidate.branchId) ?? [];
                if (where.documentId !== "doc-1" || !allowedOwners.includes(owner)) {
                    return Promise.resolve({ count: 0 });
                }
                owner = data.branchId ?? owner;
                return Promise.resolve({ count: 1 });
            },
        );
        eformsignDocModel.create.mockRejectedValue(
            Object.assign(new Error("Unique constraint failed"), { code: "P2002" }),
        );
        eformsignDocModel.findFirst.mockImplementation(
            ({ where }: {
                where: { OR?: Array<{ branchId: string | null }> };
            }) => Promise.resolve(
                where.OR?.some((candidate) => candidate.branchId === owner)
                    ? {
                        ...legacyRow,
                        branchId: owner,
                        documentKind: null,
                        employeeScheduleId: null,
                        templateId: null,
                        documentName: null,
                        documentNumber: null,
                    }
                    : null,
            ),
        );

        const results = await Promise.allSettled([
            repository.upsertByDocumentId("branch-1", createEntity()),
            repository.upsertByDocumentId("branch-2", createEntity()),
        ]);

        expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
        expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
        expect(owner).toBe("branch-1");
        expect(results[1]).toEqual(expect.objectContaining({
            status: "rejected",
            reason: expect.any(EformsignDocOwnershipConflictError),
        }));
    });

    it("atomically upserts an unassigned document by documentId and only updates status fields", async () => {
        eformsignDocModel.updateMany.mockResolvedValue({ count: 1 });
        eformsignDocModel.findFirst.mockResolvedValue({
            ...legacyRow,
            branchId: null,
            clientId: null,
            documentKind: null,
            employeeScheduleId: null,
            templateId: "template-1",
            documentName: "외부 문서",
            documentNumber: "DOC-001",
            templateName: "표준 계약서",
            customerName: "김고객",
            creatorName: "생성자",
            lastEditorName: "편집자",
            stepRecipientTypes: "05,06",
        });
        const doc = EformsignDocEntity.reconstitute({
            ...legacyRow,
            clientId: null,
            documentKind: null,
            employeeScheduleId: null,
            templateId: "template-1",
            documentName: "외부 문서",
            documentNumber: "DOC-001",
            templateName: "표준 계약서",
            customerName: "김고객",
            creatorName: "생성자",
            lastEditorName: "편집자",
            stepRecipientTypes: ["05", "06"],
        });

        await repository.upsertUnassignedByDocumentId(doc);

        const args = eformsignDocModel.updateMany.mock.calls[0][0];
        expect(args.where).toEqual({
            AND: [
                { documentId: "doc-1", branchId: null },
                {
                    updatedDate: { lte: legacyRow.updatedDate },
                    permanentPurgeRequestedAt: null,
                    statusType: { notIn: ["047", "049", "099"] },
                },
            ],
        });
        expect(args.data).toEqual({
            statusType: "050",
            statusDetail: "완료",
            expiredDate: new Date("2026-08-01T00:00:00.000Z"),
            createdDate: new Date("2026-07-01T00:00:00.000Z"),
            stepType: "05",
            stepIndex: "1",
            stepName: "이용자",
            expired: false,
            updatedDate: legacyRow.updatedDate,
            documentName: "외부 문서",
            documentNumber: "DOC-001",
            templateId: "template-1",
            templateName: "표준 계약서",
        });
        expect(args.data).not.toHaveProperty("branchId");
        expect(args.data).not.toHaveProperty("clientId");
        expect(args.data).not.toHaveProperty("documentKind");
        expect(args.data).not.toHaveProperty("stepRecipientName");
        expect(args.data).not.toHaveProperty("customerName");
        expect(args.data).not.toHaveProperty("creatorName");
        expect(args.data).not.toHaveProperty("lastEditorName");
        expect(args.data).not.toHaveProperty("stepRecipientTypes");
    });

    it("updates an assigned row without writing any local-only ownership fields", async () => {
        eformsignDocModel.updateMany.mockResolvedValue({ count: 1 });
        eformsignDocModel.findFirst.mockResolvedValue({
            ...legacyRow,
            branchId: "branch-1",
            documentKind: "service_record_snapshot",
            employeeScheduleId: 77,
            templateId: "template-1",
            serviceRecordCaseId: "case-1",
            snapshotVersion: 3,
            snapshotChunkIndex: 2,
        });

        await repository.upsertUnassignedByDocumentId(createEntity(), {
            allowAssignedUpdate: true,
            updateListDisplayFields: true,
        });

        const args = eformsignDocModel.updateMany.mock.calls[0][0];
        expect(args.where).toEqual({
            AND: [
                { documentId: "doc-1" },
                {
                    updatedDate: { lte: legacyRow.updatedDate },
                    permanentPurgeRequestedAt: null,
                    statusType: { notIn: ["047", "049", "099"] },
                },
            ],
        });
        expect(args.data).not.toHaveProperty("branchId");
        expect(args.data).not.toHaveProperty("clientId");
        expect(args.data).not.toHaveProperty("documentKind");
        expect(args.data).not.toHaveProperty("employeeScheduleId");
        expect(args.data).not.toHaveProperty("serviceRecordCaseId");
        expect(args.data).not.toHaveProperty("snapshotVersion");
        expect(args.data).not.toHaveProperty("snapshotChunkIndex");
    });

    it("atomically withdraws a completed projection before mirror files are synchronized", async () => {
        eformsignDocModel.updateMany.mockResolvedValue({ count: 1 });
        eformsignDocModel.findFirst.mockResolvedValue({
            ...legacyRow,
            branchId: "branch-1",
        });

        await repository.upsertUnassignedByDocumentId(createEntity(), {
            allowAssignedUpdate: true,
            markMirrorPending: true,
        });

        const update = eformsignDocModel.updateMany.mock.calls[0][0];
        expect(update.data)
            .toEqual(expect.objectContaining({ statusType: "050", syncStatus: "pending" }));
        expect(update.where).toEqual({
            AND: [
                { documentId: "doc-1" },
                {
                    updatedDate: { lte: legacyRow.updatedDate },
                    permanentPurgeRequestedAt: null,
                    statusType: { notIn: ["047", "049", "099"] },
                    OR: [
                        { updatedDate: { lt: legacyRow.updatedDate } },
                        {
                            statusType: {
                                notIn: [...EFORMSIGN_COMPLETED_STATUS_STORAGE_VALUES],
                            },
                        },
                        {
                            statusType: {
                                in: [...UNASSIGNED_REVIEW_STAGE_STATUS_STORAGE_VALUES],
                            },
                        },
                    ],
                },
            ],
        });
    });

    it.each(["072", "050"])(
        "allows a same-generation review-stage row to advance to terminal status %s",
        async (statusType) => {
            eformsignDocModel.updateMany.mockResolvedValue({ count: 1 });
            eformsignDocModel.findFirst.mockResolvedValue({
                ...legacyRow,
                statusType,
                branchId: "branch-1",
            });
            const incoming = EformsignDocEntity.reconstitute({
                ...legacyRow,
                statusType,
                documentKind: null,
                employeeScheduleId: null,
                templateId: null,
            });

            await repository.upsertUnassignedByDocumentId(incoming, {
                allowAssignedUpdate: true,
                markMirrorPending: true,
            });

            const staleGuard = eformsignDocModel.updateMany.mock.calls[0][0].where.AND[1];
            expect(staleGuard.OR).toContainEqual({
                statusType: {
                    in: [...UNASSIGNED_REVIEW_STAGE_STATUS_STORAGE_VALUES],
                },
            });
        },
    );

    it("refuses a same-generation retry of an already terminal status", async () => {
        eformsignDocModel.updateMany.mockResolvedValue({ count: 0 });
        eformsignDocModel.create.mockRejectedValue(
            Object.assign(new Error("Unique constraint failed"), { code: "P2002" }),
        );
        eformsignDocModel.count.mockResolvedValue(1);

        await expect(repository.upsertUnassignedByDocumentId(createEntity(), {
            allowAssignedUpdate: true,
            markMirrorPending: true,
        })).rejects.toBeInstanceOf(EformsignDocStaleUpdateError);

        const staleGuard = eformsignDocModel.updateMany.mock.calls[0][0].where.AND[1];
        expect(staleGuard.OR).toEqual([
            { updatedDate: { lt: legacyRow.updatedDate } },
            {
                statusType: {
                    notIn: [...EFORMSIGN_COMPLETED_STATUS_STORAGE_VALUES],
                },
            },
            {
                statusType: {
                    in: [...UNASSIGNED_REVIEW_STAGE_STATUS_STORAGE_VALUES],
                },
            },
        ]);
    });

    it("refuses a same-generation terminal row moving back to review stage", async () => {
        eformsignDocModel.updateMany.mockResolvedValue({ count: 0 });
        eformsignDocModel.create.mockRejectedValue(
            Object.assign(new Error("Unique constraint failed"), { code: "P2002" }),
        );
        eformsignDocModel.count.mockResolvedValue(1);
        const incoming = EformsignDocEntity.reconstitute({
            ...legacyRow,
            statusType: "062",
            documentKind: null,
            employeeScheduleId: null,
            templateId: null,
        });

        await expect(repository.upsertUnassignedByDocumentId(incoming, {
            allowAssignedUpdate: true,
            markMirrorPending: true,
        })).rejects.toBeInstanceOf(EformsignDocStaleUpdateError);

        const staleGuard = eformsignDocModel.updateMany.mock.calls[0][0].where.AND[1];
        expect(staleGuard.AND[1].OR).toEqual([
            { updatedDate: { lt: legacyRow.updatedDate } },
            {
                statusType: {
                    notIn: [...EFORMSIGN_COMPLETED_STATUS_STORAGE_VALUES],
                },
            },
        ]);
    });

    it("allows a newer terminal generation regardless of the stored completion status", async () => {
        const newerUpdatedDate = new Date("2026-07-02T00:00:00.000Z");
        eformsignDocModel.updateMany.mockResolvedValue({ count: 1 });
        eformsignDocModel.findFirst.mockResolvedValue({
            ...legacyRow,
            updatedDate: newerUpdatedDate,
            statusType: "072",
            branchId: "branch-1",
        });
        const incoming = EformsignDocEntity.reconstitute({
            ...legacyRow,
            updatedDate: newerUpdatedDate,
            statusType: "072",
            documentKind: null,
            employeeScheduleId: null,
            templateId: null,
        });

        await repository.upsertUnassignedByDocumentId(incoming, {
            allowAssignedUpdate: true,
            markMirrorPending: true,
        });

        const staleGuard = eformsignDocModel.updateMany.mock.calls[0][0].where.AND[1];
        expect(staleGuard.OR).toContainEqual({
            updatedDate: { lt: newerUpdatedDate },
        });
    });

    it("creates a newly discovered document with every local-only field unassigned", async () => {
        eformsignDocModel.updateMany.mockResolvedValue({ count: 0 });
        eformsignDocModel.create.mockResolvedValue({
            ...legacyRow,
            branchId: null,
            clientId: null,
            documentKind: null,
            employeeScheduleId: null,
            templateId: "template-1",
            serviceRecordCaseId: null,
            snapshotVersion: null,
            snapshotChunkIndex: null,
        });
        const unassigned = EformsignDocEntity.reconstitute({
            ...legacyRow,
            clientId: null,
            documentKind: null,
            employeeScheduleId: null,
            templateId: "template-1",
        });

        await repository.upsertUnassignedByDocumentId(unassigned, {
            allowAssignedUpdate: true,
        });

        const createData = eformsignDocModel.create.mock.calls[0][0].data;
        expect(createData).toEqual(expect.objectContaining({
            branchId: null,
            clientId: null,
            documentKind: null,
            employeeScheduleId: null,
        }));
        // These nullable relation/snapshot columns are deliberately omitted so Prisma
        // applies their null defaults; the backfill has no source value for them.
        expect(createData).not.toHaveProperty("serviceRecordCaseId");
        expect(createData).not.toHaveProperty("snapshotVersion");
        expect(createData).not.toHaveProperty("snapshotChunkIndex");
    });

    it("guards a terminal row from a non-terminal downgrade in the updateMany predicate", async () => {
        eformsignDocModel.updateMany.mockResolvedValue({ count: 0 });
        eformsignDocModel.create.mockRejectedValue(
            Object.assign(new Error("Unique constraint failed"), { code: "P2002" }),
        );
        eformsignDocModel.count.mockResolvedValue(1);
        const incoming = EformsignDocEntity.reconstitute({
            ...legacyRow,
            updatedDate: new Date("2026-07-02T00:00:00.000Z"),
            statusType: "060",
            statusDetail: "서명 요청",
            documentKind: null,
            employeeScheduleId: null,
            templateId: null,
        });

        await expect(
            repository.upsertUnassignedByDocumentId(incoming, {
                allowAssignedUpdate: true,
            }),
        ).rejects.toBeInstanceOf(EformsignDocStaleUpdateError);

        const staleGuard = eformsignDocModel.updateMany.mock.calls[0][0].where.AND[1];
        expect(staleGuard.AND).toEqual(
            expect.arrayContaining([
                {
                    statusType: {
                        notIn: expect.arrayContaining(["050", "080", "099"]),
                    },
                },
            ]),
        );
    });

    it("allows an unassigned 062 document to advance to 070 in the updateMany predicate", async () => {
        eformsignDocModel.updateMany.mockResolvedValue({ count: 1 });
        eformsignDocModel.findFirst.mockResolvedValue({
            ...legacyRow,
            statusType: "070",
            branchId: null,
            clientId: null,
            documentKind: null,
            employeeScheduleId: null,
            templateId: null,
        });
        const incoming = EformsignDocEntity.reconstitute({
            ...legacyRow,
            statusType: "070",
            statusDetail: "검토 요청",
            documentKind: null,
            employeeScheduleId: null,
            templateId: null,
        });

        await repository.upsertUnassignedByDocumentId(incoming);

        const staleGuard = eformsignDocModel.updateMany.mock.calls[0][0].where.AND[1];
        expect(staleGuard).toEqual({
            updatedDate: { lte: legacyRow.updatedDate },
            permanentPurgeRequestedAt: null,
            statusType: { notIn: [...UNASSIGNED_TERMINAL_STATUS_CODES] },
        });
        expect(staleGuard.statusType.notIn).not.toContain("062");
        expect(staleGuard.statusType.notIn).toEqual(
            expect.arrayContaining(["050", "080", "099"]),
        );
    });

    it.each([
        ["062", "060"],
        ["062", "063"],
        ["071", "060"],
        ["071", "063"],
        ["62", "060"],
        ["71", "060"],
        ["doc_accept_participant", "060"],
        ["doc_reject_reviewer", "060"],
    ])(
        "blocks review-stage status %s from transitioning backward to %s in the updateMany predicate",
        async (storedStatus, incomingStatus) => {
            eformsignDocModel.updateMany.mockResolvedValue({ count: 0 });
            eformsignDocModel.create.mockRejectedValue(
                Object.assign(new Error("Unique constraint failed"), { code: "P2002" }),
            );
            eformsignDocModel.count.mockResolvedValue(1);
            const incoming = EformsignDocEntity.reconstitute({
                ...legacyRow,
                statusType: incomingStatus,
                statusDetail: "서명 요청",
                updatedDate: new Date("2026-07-02T00:00:00.000Z"),
                documentKind: null,
                employeeScheduleId: null,
                templateId: null,
            });

            await expect(
                repository.upsertUnassignedByDocumentId(incoming, {
                    allowAssignedUpdate: true,
                }),
            ).rejects.toBeInstanceOf(EformsignDocStaleUpdateError);

            const staleGuard = eformsignDocModel.updateMany.mock.calls[0][0].where.AND[1];
            expect(staleGuard.AND).toEqual(expect.arrayContaining([
                {
                    OR: [
                        {
                            statusType: {
                                notIn: [...UNASSIGNED_REVIEW_STAGE_STATUS_STORAGE_VALUES],
                            },
                        },
                        { statusType: incomingStatus },
                    ],
                },
            ]));
            expect(staleGuard.AND[1].OR[0].statusType.notIn).toContain(storedStatus);
        },
    );

    // 071 belongs here because the review stage is a cycle: a reviewer can reject what a
    // participant accepted, and the 070 in between is exactly what a backfill reconciles.
    it.each(["070", "071", "080"])(
        "allows review-stage rows to advance to %s in the updateMany predicate",
        async (statusType) => {
            eformsignDocModel.updateMany.mockResolvedValue({ count: 1 });
            eformsignDocModel.findFirst.mockResolvedValue({
                ...legacyRow,
                statusType,
                branchId: null,
                clientId: null,
                documentKind: null,
                employeeScheduleId: null,
                templateId: null,
            });
            const incoming = EformsignDocEntity.reconstitute({
                ...legacyRow,
                statusType,
                documentKind: null,
                employeeScheduleId: null,
                templateId: null,
            });

            await repository.upsertUnassignedByDocumentId(incoming);

            const staleGuard = eformsignDocModel.updateMany.mock.calls[0][0].where.AND[1];
            expect(
                UNASSIGNED_FORWARD_STATUS_CODES_AFTER_REVIEW_STAGE.has(statusType),
            ).toBe(true);
            expect(JSON.stringify(staleGuard)).not.toContain(
                JSON.stringify([...UNASSIGNED_REVIEW_STAGE_STATUS_CODES]),
            );
        },
    );

    it("omits expired from list-sourced updates so an existing expired row is preserved", async () => {
        eformsignDocModel.updateMany.mockResolvedValue({ count: 1 });
        eformsignDocModel.findFirst.mockResolvedValue({
            ...legacyRow,
            expired: true,
            branchId: null,
            clientId: null,
            documentKind: null,
            employeeScheduleId: null,
            templateId: null,
        });

        await repository.upsertUnassignedByDocumentId(createEntity(), {
            updateExpired: false,
        });

        expect(eformsignDocModel.updateMany.mock.calls[0][0].data)
            .not.toHaveProperty("expired");
    });

    it("repairs createdDate on update so the list sorts by when eformsign made the document", async () => {
        // The create and adopt paths store the moment we wrote the row, so a contract
        // adopted long after it was created sorts as if it were new. Creation time is the
        // list's sort key, so reconciling from a response that carries it puts that right.
        eformsignDocModel.updateMany.mockResolvedValue({ count: 1 });
        eformsignDocModel.findFirst.mockResolvedValue({
            ...legacyRow,
            branchId: null,
            clientId: null,
            documentKind: null,
            employeeScheduleId: null,
            templateId: null,
        });

        await repository.upsertUnassignedByDocumentId(createEntity());

        expect(eformsignDocModel.updateMany.mock.calls[0][0].data.createdDate)
            .toEqual(legacyRow.createdDate);
    });

    it("leaves createdDate alone when the caller had to invent one", async () => {
        eformsignDocModel.updateMany.mockResolvedValue({ count: 1 });
        eformsignDocModel.findFirst.mockResolvedValue({
            ...legacyRow,
            branchId: null,
            clientId: null,
            documentKind: null,
            employeeScheduleId: null,
            templateId: null,
        });

        await repository.upsertUnassignedByDocumentId(createEntity(), {
            updateCreatedDate: false,
        });

        expect(eformsignDocModel.updateMany.mock.calls[0][0].data)
            .not.toHaveProperty("createdDate");
    });

    it("repairs createdDate even when the event is refused as stale", async () => {
        // An adopted row stores the moment of adoption as both createdDate and
        // updatedDate, so an unchanged older vendor document is always "stale" and the
        // guarded update never runs — which is exactly the row whose sort key is wrong.
        // update refused → create races → P2002 → same guarded update refused again.
        eformsignDocModel.updateMany.mockResolvedValue({ count: 0 });
        eformsignDocModel.create.mockRejectedValue(
            Object.assign(new Error("Unique constraint failed"), { code: "P2002" }),
        );
        eformsignDocModel.count.mockResolvedValue(1);

        await expect(repository.upsertUnassignedByDocumentId(createEntity()))
            .rejects.toBeInstanceOf(EformsignDocStaleUpdateError);

        const repair = eformsignDocModel.updateMany.mock.calls.at(-1)![0];
        expect(repair.data).toEqual({ createdDate: legacyRow.createdDate });
        // Ownership and destructive-state fences still apply, and rows that
        // already agree are left alone.
        expect(repair.where).toEqual({
            AND: [
                { documentId: "doc-1", branchId: null },
                { permanentPurgeRequestedAt: null },
                { statusType: { notIn: ["047", "049", "099"] } },
                { createdDate: { not: legacyRow.createdDate } },
            ],
        });
    });

    it("omits expiredDate from list-sourced updates so a real expiry survives", async () => {
        // The list carries no expired_date, so what the mirror computed is only its
        // fallback guess — writing it would overwrite a date the vendor actually gave us.
        eformsignDocModel.updateMany.mockResolvedValue({ count: 1 });
        eformsignDocModel.findFirst.mockResolvedValue({
            ...legacyRow,
            branchId: null,
            clientId: null,
            documentKind: null,
            employeeScheduleId: null,
            templateId: null,
        });

        await repository.upsertUnassignedByDocumentId(createEntity(), {
            updateExpiredDate: false,
        });

        expect(eformsignDocModel.updateMany.mock.calls[0][0].data)
            .not.toHaveProperty("expiredDate");
    });

    it("omits statusDetail from list-sourced updates so a webhook-written detail survives", async () => {
        eformsignDocModel.updateMany.mockResolvedValue({ count: 1 });
        eformsignDocModel.findFirst.mockResolvedValue({
            ...legacyRow,
            statusDetail: "만료",
            branchId: null,
            clientId: null,
            documentKind: null,
            employeeScheduleId: null,
            templateId: null,
        });

        await repository.upsertUnassignedByDocumentId(createEntity(), {
            updateStatusDetail: false,
        });

        const { data } = eformsignDocModel.updateMany.mock.calls[0][0];
        expect(data).not.toHaveProperty("statusDetail");
        // The rest of the status still has to land, or the row would freeze.
        expect(data).toHaveProperty("statusType");
    });

    it("upserts the same document twice without creating a duplicate row", async () => {
        let storedRow: Record<string, unknown> | null = null;
        eformsignDocModel.updateMany.mockImplementation(
            ({ data }: { data: Record<string, unknown> }) => {
                if (!storedRow) {
                    return Promise.resolve({ count: 0 });
                }
                storedRow = { ...storedRow, ...data };
                return Promise.resolve({ count: 1 });
            },
        );
        eformsignDocModel.create.mockImplementation(
            ({ data }: { data: Record<string, unknown> }) => {
                storedRow = { id: 1, ...data };
                return Promise.resolve(storedRow);
            },
        );
        eformsignDocModel.findFirst.mockImplementation(() => Promise.resolve(storedRow));

        await repository.upsertUnassignedByDocumentId(createEntity(), {
            allowAssignedUpdate: true,
        });
        await repository.upsertUnassignedByDocumentId(createEntity(), {
            allowAssignedUpdate: true,
        });

        expect(eformsignDocModel.create).toHaveBeenCalledTimes(1);
        expect(eformsignDocModel.updateMany).toHaveBeenCalledTimes(2);
        expect(storedRow).toEqual(expect.objectContaining({ documentId: "doc-1" }));
    });

    it("does not update a branch-owned row when an unassigned mirror loses the ownership race", async () => {
        eformsignDocModel.updateMany.mockResolvedValue({ count: 0 });
        eformsignDocModel.create.mockRejectedValue(
            Object.assign(new Error("Unique constraint failed"), { code: "P2002" }),
        );

        await expect(
            repository.upsertUnassignedByDocumentId(createEntity()),
        ).rejects.toBeInstanceOf(EformsignDocOwnershipConflictError);

        expect(eformsignDocModel.updateMany).toHaveBeenCalledTimes(2);
        expect(eformsignDocModel.updateMany).toHaveBeenNthCalledWith(
            1,
            expect.objectContaining({
                where: expect.objectContaining({
                    AND: expect.arrayContaining([{ documentId: "doc-1", branchId: null }]),
                }),
            }),
        );
        expect(eformsignDocModel.updateMany).toHaveBeenNthCalledWith(
            2,
            expect.objectContaining({
                where: expect.objectContaining({
                    AND: expect.arrayContaining([{ documentId: "doc-1", branchId: null }]),
                }),
            }),
        );
    });

    it("retries an unassigned mirror update after a concurrent create wins with P2002", async () => {
        eformsignDocModel.updateMany
            .mockResolvedValueOnce({ count: 0 })
            .mockResolvedValueOnce({ count: 1 });
        eformsignDocModel.create.mockRejectedValue(
            Object.assign(new Error("Unique constraint failed"), { code: "P2002" }),
        );
        eformsignDocModel.findFirst.mockResolvedValue({
            ...legacyRow,
            branchId: null,
            clientId: null,
            documentKind: null,
            employeeScheduleId: null,
            templateId: null,
            documentName: null,
            documentNumber: null,
        });

        await expect(
            repository.upsertUnassignedByDocumentId(createEntity()),
        ).resolves.toEqual(expect.objectContaining({ documentId: "doc-1" }));

        expect(eformsignDocModel.create).toHaveBeenCalledTimes(1);
        expect(eformsignDocModel.updateMany).toHaveBeenCalledTimes(2);
    });

    it("keeps the pending-column compatibility fallback for unassigned mirror updates", async () => {
        eformsignDocModel.updateMany
            .mockRejectedValueOnce(pendingColumnError)
            .mockResolvedValueOnce({ count: 1 });
        eformsignDocModel.findFirst
            .mockRejectedValueOnce(pendingColumnError)
            .mockResolvedValueOnce(legacyRow);

        await repository.upsertUnassignedByDocumentId(createEntity());

        const retry = eformsignDocModel.updateMany.mock.calls[1][0];
        expect(retry.where).toEqual({
            AND: [
                { documentId: "doc-1", branchId: null },
                {
                    updatedDate: { lte: legacyRow.updatedDate },
                    permanentPurgeRequestedAt: null,
                    statusType: { notIn: ["047", "049", "099"] },
                },
            ],
        });
        expect(retry.data).not.toHaveProperty("documentKind");
        expect(retry.data).not.toHaveProperty("employeeScheduleId");
        expect(retry.data).not.toHaveProperty("templateId");
        expect(eformsignDocModel.findFirst).toHaveBeenNthCalledWith(
            2,
            expect.objectContaining({
                select: expect.objectContaining({ documentId: true }),
            }),
        );
    });

    it("refuses a stale mirror update without reporting an ownership conflict", async () => {
        // Zero updated rows while a row still matches the ownership predicate means the
        // stored state is already at least as new. Reporting a conflict here would send the
        // caller down the branch-owned path and apply the stale event we just refused.
        eformsignDocModel.updateMany.mockResolvedValue({ count: 0 });
        eformsignDocModel.create.mockRejectedValue(
            Object.assign(new Error("Unique constraint failed"), { code: "P2002" }),
        );
        eformsignDocModel.count.mockResolvedValue(1);

        await expect(
            repository.upsertUnassignedByDocumentId(createEntity()),
        ).rejects.toBeInstanceOf(EformsignDocStaleUpdateError);

        expect(eformsignDocModel.count).toHaveBeenCalledWith({
            where: { documentId: "doc-1", branchId: null },
        });
    });

    it("guards the update with the incoming timestamp so a late webhook cannot win a race", async () => {
        eformsignDocModel.updateMany.mockResolvedValue({ count: 1 });
        eformsignDocModel.findFirst.mockResolvedValue(legacyRow);

        await repository.upsertUnassignedByDocumentId(createEntity());

        const args = eformsignDocModel.updateMany.mock.calls[0][0];
        expect(args.where.AND).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    updatedDate: { lte: legacyRow.updatedDate },
                    permanentPurgeRequestedAt: null,
                    statusType: { notIn: ["047", "049", "099"] },
                }),
            ]),
        );
    });

    it("updates all list display fields only for the mirror path", async () => {
        eformsignDocModel.updateMany.mockResolvedValue({ count: 1 });
        eformsignDocModel.findFirst.mockResolvedValue({
            ...legacyRow,
            branchId: null,
            documentKind: null,
            employeeScheduleId: null,
            templateId: "template-1",
            documentName: "외부 문서",
            documentNumber: "DOC-001",
            templateName: "표준 계약서",
            customerName: "김고객",
            creatorName: "생성자",
            lastEditorName: "편집자",
            stepRecipientTypes: "05,06",
        });
        const doc = EformsignDocEntity.reconstitute({
            ...legacyRow,
            clientId: null,
            documentNumber: "DOC-001",
            templateName: "표준 계약서",
            customerName: "김고객",
            creatorName: "생성자",
            lastEditorName: "편집자",
            stepRecipientTypes: ["05", "06"],
        });

        await repository.upsertUnassignedByDocumentId(doc, {
            updateListDisplayFields: true,
        });

        expect(eformsignDocModel.updateMany.mock.calls[0][0].data).toEqual(
            expect.objectContaining({
                documentNumber: "DOC-001",
                templateName: "표준 계약서",
                customerName: "김고객",
                creatorName: "생성자",
                lastEditorName: "편집자",
                stepRecipientTypes: "05,06",
            }),
        );
    });

    it("omits blank optional metadata when updating an unassigned document", async () => {
        eformsignDocModel.updateMany.mockResolvedValue({ count: 1 });
        eformsignDocModel.findFirst.mockResolvedValue({
            ...legacyRow,
            branchId: null,
            clientId: null,
            documentKind: null,
            employeeScheduleId: null,
            templateId: null,
            documentName: "기존 문서명",
            documentNumber: null,
        });
        const doc = EformsignDocEntity.reconstitute({
            ...legacyRow,
            clientId: null,
            documentKind: null,
            employeeScheduleId: null,
            templateId: "   ",
            documentName: "   ",
            documentNumber: null,
            templateName: "   ",
        });

        await repository.upsertUnassignedByDocumentId(doc);

        const update = eformsignDocModel.updateMany.mock.calls[0][0].data;
        expect(update).not.toHaveProperty("documentName");
        expect(update).not.toHaveProperty("documentNumber");
        expect(update).not.toHaveProperty("templateId");
        expect(update).not.toHaveProperty("templateName");
    });

    it.each(["", "   "])(
        "omits documentName when claiming completion with blank input %p",
        async (documentName) => {
            eformsignDocModel.updateMany.mockResolvedValue({ count: 1 });

            await repository.claimCompletionStatus("branch-1", {
                documentId: "doc-1",
                statusType: "050",
                statusDetail: "완료",
                stepType: "05",
                stepIndex: "1",
                stepName: "이용자",
                expired: false,
                documentName,
                templateName: documentName,
            });

            expect(eformsignDocModel.updateMany.mock.calls[0][0].data.documentName).toBeUndefined();
            expect(eformsignDocModel.updateMany.mock.calls[0][0].data.templateName).toBeUndefined();
        },
    );

    it("does not advance completion to wall-clock time when the webhook has no timestamp", async () => {
        eformsignDocModel.updateMany.mockResolvedValue({ count: 1 });

        await repository.claimCompletionStatus("branch-1", {
            documentId: "doc-1",
            statusType: "050",
            statusDetail: "완료",
            stepType: "05",
            stepIndex: "1",
            stepName: "이용자",
            expired: false,
        });

        expect(eformsignDocModel.updateMany.mock.calls[0][0].data)
            .not.toHaveProperty("updatedDate");
    });

    it("refuses a stale completion claim with an atomic vendor timestamp guard", async () => {
        const sourceUpdatedDate = new Date("2026-07-01T00:00:00.000Z");
        eformsignDocModel.updateMany.mockResolvedValue({ count: 0 });
        eformsignDocModel.findFirst.mockResolvedValue({
            id: 1,
            updatedDate: new Date("2026-07-02T00:00:00.000Z"),
        });

        const result = await repository.claimCompletionStatus("branch-1", {
            documentId: "doc-1",
            statusType: "050",
            statusDetail: "완료",
            stepType: "05",
            stepIndex: "1",
            stepName: "이용자",
            expired: false,
            sourceUpdatedDate,
            documentName: "오래된 제목",
        });

        expect(result).toBe("stale");
        expect(eformsignDocModel.updateMany).toHaveBeenCalledTimes(1);
        expect(eformsignDocModel.updateMany).toHaveBeenCalledWith({
            where: {
                branchId: "branch-1",
                documentId: "doc-1",
                permanentPurgeRequestedAt: null,
                statusType: { notIn: ["050", "047", "049", "099"] },
                updatedDate: { lt: sourceUpdatedDate },
            },
            data: expect.objectContaining({ updatedDate: sourceUpdatedDate }),
        });
    });

    it("classifies an older same-status completion as stale without overwriting metadata", async () => {
        const sourceUpdatedDate = new Date("2026-07-01T00:00:00.000Z");
        eformsignDocModel.updateMany.mockResolvedValue({ count: 0 });
        eformsignDocModel.findFirst.mockResolvedValue({
            id: 1,
            statusType: "050",
            updatedDate: new Date("2026-07-02T00:00:00.000Z"),
        });

        const result = await repository.claimCompletionStatus("branch-1", {
            documentId: "doc-1",
            statusType: "050",
            statusDetail: "완료",
            stepType: "05",
            stepIndex: "1",
            stepName: "이용자",
            expired: false,
            sourceUpdatedDate,
            documentName: "오래된 제목",
        });

        expect(result).toBe("stale");
        expect(eformsignDocModel.updateMany).toHaveBeenCalledTimes(1);
    });

    it("does not resurrect a deleted tombstone from a timestamp-less PDF completion", async () => {
        eformsignDocModel.updateMany.mockResolvedValue({ count: 0 });
        eformsignDocModel.findFirst.mockResolvedValue({
            id: 1,
            statusType: "049",
            updatedDate: new Date("2026-07-02T00:00:00.000Z"),
            permanentPurgeRequestedAt: null,
        });

        const result = await repository.claimCompletionStatus("branch-1", {
            documentId: "doc-1",
            statusType: "050",
            statusDetail: "완료",
            stepType: "05",
            stepIndex: "1",
            stepName: "이용자",
            expired: false,
        });

        expect(result).toBe("stale");
        expect(eformsignDocModel.updateMany).toHaveBeenCalledWith(expect.objectContaining({
            where: expect.objectContaining({
                permanentPurgeRequestedAt: null,
                statusType: { notIn: ["050", "047", "049", "099"] },
            }),
        }));
        expect(eformsignDocModel.updateMany).toHaveBeenCalledTimes(1);
    });

    it("preserves earlier metadata when duplicate completion hits a pending list display column", async () => {
        const pendingTemplateNameError = Object.assign(
            new Error("The column `eformsign_doc.template_name` does not exist"),
            {
                code: "P2022",
                meta: { column: "eformsign_doc.template_name" },
            },
        );
        eformsignDocModel.updateMany
            .mockResolvedValueOnce({ count: 0 })
            .mockRejectedValueOnce(pendingTemplateNameError)
            .mockResolvedValueOnce({ count: 1 });
        eformsignDocModel.findFirst.mockResolvedValue({ id: 1 });

        const result = await repository.claimCompletionStatus("branch-1", {
            documentId: "doc-1",
            statusType: "050",
            statusDetail: "완료",
            stepType: "05",
            stepIndex: "1",
            stepName: "이용자",
            expired: false,
            documentName: "제공기록지",
            templateName: "템플릿",
        });

        expect(result).toBe("duplicate");
        expect(eformsignDocModel.updateMany).toHaveBeenNthCalledWith(3, {
            where: { id: 1, branchId: "branch-1" },
            data: { documentName: "제공기록지" },
        });
    });

    it("uses the service record mom name for snapshot document client summaries", async () => {
        const clientFindMany = jest.fn().mockResolvedValue([
            { id: 55, name: "고객 원본명", phone: "01066211878" },
        ]);
        const scheduleFindMany = jest.fn().mockResolvedValue([]);
        eformsignDocModel.findMany.mockResolvedValue([
            {
                documentId: "service-record-doc-1",
                clientId: 55,
                stepRecipientName: "인천 아이미래로",
                documentKind: "service_record_snapshot",
                serviceRecordCase: { momName: "송진호" },
            },
        ]);
        repository = new SbEformsignDocRepository({
            eformsign_doc: eformsignDocModel,
            client: { findMany: clientFindMany },
            employee_schedule: { findMany: scheduleFindMany },
        } as unknown as PrismaService);

        const result = await repository.findClientNamesByBranch("branch-1");

        expect(eformsignDocModel.findMany).toHaveBeenCalledWith({
            where: {
                branchId: "branch-1",
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
        expect(result).toEqual([
            {
                documentId: "service-record-doc-1",
                clientId: 55,
                clientName: "송진호",
                clientPhone: "01066211878",
                providerName: null,
            },
        ]);
    });

    it("keeps orphaned completed documents visible after their client is deleted", async () => {
        const clientFindMany = jest.fn().mockResolvedValue([]);
        const scheduleFindMany = jest.fn().mockResolvedValue([]);
        eformsignDocModel.findMany.mockResolvedValue([
            {
                documentId: "service-record-doc-orphan",
                clientId: null,
                stepRecipientName: "전자문서 수신자",
                documentKind: "service_record_snapshot",
                serviceRecordCase: { momName: "보존된 산모명" },
            },
        ]);
        repository = new SbEformsignDocRepository({
            eformsign_doc: eformsignDocModel,
            client: { findMany: clientFindMany },
            employee_schedule: { findMany: scheduleFindMany },
        } as unknown as PrismaService);

        const result = await repository.findClientNamesByBranch("branch-1");

        expect(result).toEqual([
            {
                documentId: "service-record-doc-orphan",
                clientId: null,
                clientName: "보존된 산모명",
                clientPhone: null,
                providerName: null,
            },
        ]);
        expect(clientFindMany).not.toHaveBeenCalled();
        expect(scheduleFindMany).not.toHaveBeenCalled();
    });
});
