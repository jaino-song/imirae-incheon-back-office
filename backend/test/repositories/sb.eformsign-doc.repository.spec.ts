import { SbEformsignDocRepository } from "infrastructure/database/repositories/sb.eformsign-doc.repository";
import { PrismaService } from "infrastructure/database/prisma.service";
import { EformsignDocEntity } from "domain/entities/eformsign-doc.entity";

describe("SbEformsignDocRepository", () => {
    const pendingColumnError = Object.assign(
        new Error("The column `eformsign_doc.document_kind` does not exist"),
        { code: "P2022" },
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
        });

    const createMockPrismaEformsignDoc = () => ({
        findFirst: jest.fn(),
        findMany: jest.fn(),
        create: jest.fn(),
        updateMany: jest.fn(),
        deleteMany: jest.fn(),
        findUnique: jest.fn(),
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
            where: { clientId: 55, branchId: "branch-1" },
        });
        expect(eformsignDocModel.findMany).toHaveBeenNthCalledWith(2, {
            where: { clientId: 55, branchId: "branch-1" },
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

    it("retries document reads when Prisma reports P2022 without column metadata", async () => {
        eformsignDocModel.findFirst
            .mockRejectedValueOnce(pendingColumnWithoutFieldError)
            .mockResolvedValueOnce(legacyRow);

        const result = await repository.findByDocumentId("branch-1", "doc-1");

        expect(eformsignDocModel.findFirst).toHaveBeenNthCalledWith(1, {
            where: { documentId: "doc-1", branchId: "branch-1" },
        });
        expect(eformsignDocModel.findFirst).toHaveBeenNthCalledWith(2, {
            where: { documentId: "doc-1", branchId: "branch-1" },
            select: expect.objectContaining({
                documentId: true,
                statusType: true,
                clientId: true,
            }),
        });
        expect(result?.documentId).toBe("doc-1");
        expect(result?.documentKind).toBeNull();
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
        expect(result.statusType).toBe("050");
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
            where: { branchId: "branch-1" },
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
