import { NotFoundException } from "@nestjs/common";
import { UpdateEformsignDocStatusUsecase } from "application/usecases/eformsign-doc/update-eformsign-doc-status.usecase";
import { EformsignDocEntity } from "domain/entities/eformsign-doc.entity";

describe("UpdateEformsignDocStatusUsecase", () => {
    const branchId = "test-branch";
    const documentId = "doc-123";

    const createDocEntity = (statusType: string): EformsignDocEntity =>
        EformsignDocEntity.reconstitute({
            id: 1,
            documentId,
            createdDate: new Date("2026-05-01T00:00:00.000Z"),
            updatedDate: new Date("2026-05-02T00:00:00.000Z"),
            statusType,
            statusDetail: "상태",
            stepType: "05",
            stepIndex: "3",
            stepName: "이용자",
            stepRecipientType: "01",
            stepRecipientName: "직원",
            stepRecipientSms: "01012345678",
            expiredDate: new Date("2026-06-01T00:00:00.000Z"),
            expired: false,
            clientId: 9,
            documentName: "기존 문서명",
            templateId: "existing-template",
        });

    const eformsignDocRepository = {
        findByDocumentId: jest.fn(),
        update: jest.fn(),
    };

    let usecase: UpdateEformsignDocStatusUsecase;

    beforeEach(() => {
        usecase = new UpdateEformsignDocStatusUsecase(eformsignDocRepository as never);
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    it("throws NotFoundException when the document does not exist", async () => {
        eformsignDocRepository.findByDocumentId.mockResolvedValue(null);

        await expect(
            usecase.execute(branchId, {
                documentId,
                statusType: "020",
                statusDetail: "서명 페이지 열림",
            }),
        ).rejects.toThrow(NotFoundException);
        expect(eformsignDocRepository.update).not.toHaveBeenCalled();
    });

    it("ignores a stale downgrade from a completed (terminal) status to a non-terminal status", async () => {
        eformsignDocRepository.findByDocumentId.mockResolvedValue(createDocEntity("050"));

        const result = await usecase.execute(branchId, {
            documentId,
            statusType: "020",
            statusDetail: "서명 페이지 열림",
        });

        expect(result.statusType).toBe("050");
        expect(eformsignDocRepository.update).not.toHaveBeenCalled();
    });

    it("allows a normal non-terminal -> non-terminal transition", async () => {
        eformsignDocRepository.findByDocumentId.mockResolvedValue(createDocEntity("060"));
        eformsignDocRepository.update.mockImplementation((_branchid, doc) => Promise.resolve(doc));

        const result = await usecase.execute(branchId, {
            documentId,
            statusType: "020",
            statusDetail: "서명 페이지 열림",
        });

        expect(result.statusType).toBe("020");
        expect(eformsignDocRepository.update).toHaveBeenCalledTimes(1);
    });

    it("allows a terminal -> terminal transition (e.g. completed -> rejected)", async () => {
        eformsignDocRepository.findByDocumentId.mockResolvedValue(createDocEntity("050"));
        eformsignDocRepository.update.mockImplementation((_branchid, doc) => Promise.resolve(doc));

        const result = await usecase.execute(branchId, {
            documentId,
            statusType: "080",
            statusDetail: "거부",
        });

        expect(result.statusType).toBe("080");
        expect(eformsignDocRepository.update).toHaveBeenCalledTimes(1);
    });

    it("stores webhook documentName without replacing the locally selected templateId", async () => {
        eformsignDocRepository.findByDocumentId.mockResolvedValue(createDocEntity("060"));
        eformsignDocRepository.update.mockImplementation((_branchid, doc) => Promise.resolve(doc));

        const result = await usecase.execute(branchId, {
            documentId,
            statusType: "070",
            statusDetail: "검토 요청",
            documentName: "새 문서명",
        });

        expect(result.documentName).toBe("새 문서명");
        expect(result.templateId).toBe("existing-template");
    });

    it("keeps existing documentName when the webhook value is empty", async () => {
        eformsignDocRepository.findByDocumentId.mockResolvedValue(createDocEntity("060"));
        eformsignDocRepository.update.mockImplementation((_branchid, doc) => Promise.resolve(doc));

        const result = await usecase.execute(branchId, {
            documentId,
            statusType: "070",
            statusDetail: "검토 요청",
            documentName: "   ",
        });

        expect(result.documentName).toBe("기존 문서명");
        expect(result.templateId).toBe("existing-template");
    });
});
