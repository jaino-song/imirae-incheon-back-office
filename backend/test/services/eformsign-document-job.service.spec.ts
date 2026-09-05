import { EformsignDocumentJobService } from "application/services/eformsign-document-job.service";

const branchId = "00000000-0000-0000-0000-000000000010";

const validContractData = {
    customerName: "고객",
    customerContact: "010-1111-2222",
    customerDOB: "900101",
    customerAddress: "서울",
    caretaker1Name: "관리사",
    caretaker1Contact: "010-3333-4444",
    type: "A",
    days: "10",
    area: "서울",
    contractDuration: "10",
    startYear: "2026",
    startMonth: "08",
    startDay: "29",
    startDate: "2026-08-29",
    endYear: "2026",
    endMonth: "09",
    endDay: "11",
    endDate: "2026-09-11",
    paymentYear: "2026",
    paymentMonth: "08",
    paymentDay: "29",
    fullPrice: "100000",
    grant: "50000",
    actualPrice: "50000",
};

function buildService() {
    const repository = { enqueue: jest.fn() };
    const documents = { findByDocumentId: jest.fn() };
    const clients = { findById: jest.fn() };
    const service = new EformsignDocumentJobService(
        repository as never,
        documents as never,
        clients as never,
    );
    return { service, repository, documents, clients };
}

describe("EformsignDocumentJobService", () => {
    it("refuses finalization when the authenticated branch does not own the document", async () => {
        const { service, repository, documents } = buildService();
        documents.findByDocumentId.mockResolvedValue(null);

        await expect(service.enqueueFinalizeDocument({
            branchId,
            documentId: "foreign-document",
            requestKey: "request-1",
            source: "staff",
        })).rejects.toThrow("EFORMSIGN_DOCUMENT_JOB_DOCUMENT_NOT_FOUND");
        expect(documents.findByDocumentId).toHaveBeenCalledWith(branchId, "foreign-document");
        expect(repository.enqueue).not.toHaveBeenCalled();
    });

    it("allows finalization when the authenticated branch owns the document", async () => {
        const { service, repository, documents } = buildService();
        documents.findByDocumentId.mockResolvedValue({ documentId: "owned-document" });
        repository.enqueue.mockResolvedValue({ job: { id: "job-1" }, existing: false });

        await expect(service.enqueueFinalizeDocument({
            branchId,
            documentId: "owned-document",
            requestKey: "request-1",
            source: "staff",
        })).resolves.toEqual({ job: { id: "job-1" }, existing: false });
        expect(repository.enqueue).toHaveBeenCalledWith(expect.objectContaining({
            branchId,
            documentId: "owned-document",
            activeKey: "finalize:owned-document",
        }));
    });

    it("refuses creation when the authenticated branch does not own the client", async () => {
        const { service, repository, clients } = buildService();
        clients.findById.mockResolvedValue(null);

        await expect(service.enqueueCreateDocument({
            branchId,
            clientId: 7,
            contractData: {} as never,
            requestKey: "request-1",
        })).rejects.toThrow("EFORMSIGN_DOCUMENT_JOB_CLIENT_NOT_FOUND");
        expect(clients.findById).toHaveBeenCalledWith(branchId, 7);
        expect(repository.enqueue).not.toHaveBeenCalled();
    });

    it.each(["customerContact", "caretaker1Contact", "issuerPhone"])(
        "refuses creation with malformed %s before persisting a durable job",
        async (field) => {
            const { service, repository, clients } = buildService();
            clients.findById.mockResolvedValue({ id: 7 });

            await expect(service.enqueueCreateDocument({
                branchId,
                clientId: 7,
                contractData: { ...validContractData, [field]: "not-a-phone" } as never,
                requestKey: "request-1",
            })).rejects.toThrow("올바른 국내 전화번호 형식이 아닙니다.");
            expect(repository.enqueue).not.toHaveBeenCalled();
        },
    );
});
