import { LinkDocumentToClientUsecase } from "application/usecases/eformsign-doc/link-document-to-client.usecase";
import { ClientEntity } from "domain/entities/client.entity";
import { EFORMSIGN_DOCUMENT_KIND, EformsignDocEntity } from "domain/entities/eformsign-doc.entity";

describe("LinkDocumentToClientUsecase", () => {
    const branchId = "branch-1";
    const documentId = "doc-1";

    const createClient = (id: number, phone: string | null, eDocId: string | null = null): ClientEntity =>
        ClientEntity.reconstitute(
            id,
            `고객 ${id}`,
            null,
            phone,
            null,
            null,
            null,
            null,
            null,
            null,
            null,
            null,
            true,
            null,
            null,
            null,
            false,
            eDocId,
        );

    const createDoc = (overrides: Partial<{
        clientId: number | null;
        documentName: string | null;
        documentNumber: string | null;
        documentKind: EformsignDocEntity["documentKind"];
        stepRecipientSms: string;
    }> = {}): EformsignDocEntity =>
        EformsignDocEntity.reconstitute({
            id: 1,
            documentId,
            documentName: overrides.documentName ?? "기존 문서명",
            documentNumber: overrides.documentNumber ?? "DOC-001",
            createdDate: new Date("2026-07-01T00:00:00.000Z"),
            updatedDate: new Date("2026-07-01T00:00:00.000Z"),
            statusType: "060",
            statusDetail: "대기",
            stepType: "05",
            stepIndex: "1",
            stepName: "이용자",
            stepRecipientType: "05",
            stepRecipientName: "고객",
            stepRecipientSms: overrides.stepRecipientSms ?? "010-1234-5678",
            expiredDate: new Date("2026-08-01T00:00:00.000Z"),
            expired: false,
            clientId: overrides.clientId === undefined ? 7 : overrides.clientId,
            documentKind: overrides.documentKind ?? EFORMSIGN_DOCUMENT_KIND.CONTRACT,
            employeeScheduleId: null,
            templateId: null,
        });

    const eformsignDocRepository = {
        findByDocumentId: jest.fn(),
        update: jest.fn(),
    };
    const clientRepository = {
        findById: jest.fn(),
        findByPhone: jest.fn(),
        update: jest.fn(),
    };

    let usecase: LinkDocumentToClientUsecase;

    beforeEach(() => {
        jest.clearAllMocks();
        usecase = new LinkDocumentToClientUsecase(
            eformsignDocRepository as never,
            clientRepository as never,
        );
    });

    it("links the phone-matched client and reassigns the document when doc clientId is stale", async () => {
        const phoneMatchedClient = createClient(12, "01012345678");
        eformsignDocRepository.findByDocumentId.mockResolvedValue(createDoc({ clientId: 7 }));
        clientRepository.findByPhone.mockResolvedValue(phoneMatchedClient);

        await expect(usecase.execute(branchId, documentId)).resolves.toBeUndefined();

        expect(clientRepository.findByPhone).toHaveBeenCalledWith(branchId, "01012345678");
        expect(eformsignDocRepository.update).toHaveBeenCalledWith(
            branchId,
            expect.objectContaining({
                clientId: 12,
                documentId,
                documentName: "기존 문서명",
                documentNumber: "DOC-001",
            }),
        );
        expect(phoneMatchedClient.eDocId).toBe(documentId);
        expect(clientRepository.update).toHaveBeenCalledWith(branchId, phoneMatchedClient);
        expect(clientRepository.findById).not.toHaveBeenCalled();
    });

    it("falls back to the document client when no recipient phone matches", async () => {
        const documentClient = createClient(7, "01000000000");
        eformsignDocRepository.findByDocumentId.mockResolvedValue(createDoc({ clientId: 7 }));
        clientRepository.findByPhone.mockResolvedValue(null);
        clientRepository.findById.mockResolvedValue(documentClient);

        await expect(usecase.execute(branchId, documentId)).resolves.toBeUndefined();

        expect(eformsignDocRepository.update).not.toHaveBeenCalled();
        expect(documentClient.eDocId).toBe(documentId);
        expect(clientRepository.update).toHaveBeenCalledWith(branchId, documentClient);
    });

    it("can relink an orphaned contract document by its recipient phone", async () => {
        const phoneMatchedClient = createClient(12, "01012345678");
        eformsignDocRepository.findByDocumentId.mockResolvedValue(createDoc({ clientId: null }));
        clientRepository.findByPhone.mockResolvedValue(phoneMatchedClient);

        await expect(usecase.execute(branchId, documentId)).resolves.toBeUndefined();

        expect(eformsignDocRepository.update).toHaveBeenCalledWith(
            branchId,
            expect.objectContaining({ clientId: 12, documentId }),
        );
        expect(clientRepository.findById).not.toHaveBeenCalled();
    });

    it("does not link service-record snapshot documents to the client contract pointer", async () => {
        eformsignDocRepository.findByDocumentId.mockResolvedValue(createDoc({
            documentKind: EFORMSIGN_DOCUMENT_KIND.SERVICE_RECORD_SNAPSHOT,
        }));

        await expect(usecase.execute(branchId, documentId)).resolves.toBeUndefined();

        expect(clientRepository.findByPhone).not.toHaveBeenCalled();
        expect(clientRepository.findById).not.toHaveBeenCalled();
        expect(clientRepository.update).not.toHaveBeenCalled();
        expect(eformsignDocRepository.update).not.toHaveBeenCalled();
    });
});
