import { Logger } from "@nestjs/common";
import { SyncClientEndDateUsecase } from "application/usecases/eformsign-doc/sync-client-end-date.usecase";
import { ClientEntity } from "domain/entities/client.entity";
import { EformsignDocEntity } from "domain/entities/eformsign-doc.entity";
import { EformsignApiDocumentResponse } from "domain/repositories/eformsign.client.interface";
import { countBusinessDaysKr, UnsupportedKoreanHolidayYearError } from "domain/utils/business-days";

describe("SyncClientEndDateUsecase", () => {
    const branchId = "test-branch";
    const documentId = "test-doc-id";
    const accessToken = "access-token";

    const createDocumentResponse = (
        fields: Array<{ id: string; value: string; type: string }>
    ): EformsignApiDocumentResponse => ({
        id: documentId,
        document_number: "DOC-1",
        template: {
            id: "template-1",
            name: "template",
        },
        document_name: "산모신생아건강관리서비스 계약서",
        creator: {
            recipient_type: "01",
            id: "creator@example.com",
            name: "creator",
        },
        created_date: 0,
        updated_date: 0,
        current_status: {
            status_type: "060",
            status_doc_type: "060",
            status_doc_detail: "서명 요청됨",
            step_type: "06",
            step_index: "3",
            step_name: "제공기관 확인",
            step_recipients: [],
            step_group: 0,
            expired_date: 0,
            _expired: false,
        },
        fields,
    });

    const createDocEntity = (): EformsignDocEntity =>
        EformsignDocEntity.reconstitute({
            id: 11,
            documentId,
            createdDate: new Date("2026-05-01T00:00:00.000Z"),
            updatedDate: new Date("2026-05-02T00:00:00.000Z"),
            statusType: "060",
            statusDetail: "서명 요청됨",
            stepType: "06",
            stepIndex: "3",
            stepName: "제공기관 확인",
            stepRecipientType: "01",
            stepRecipientName: "직원",
            stepRecipientSms: "01012345678",
            expiredDate: new Date("2026-06-01T00:00:00.000Z"),
            expired: false,
            clientId: 7,
        });

    const createClientEntity = (): ClientEntity =>
        ClientEntity.reconstitute(
            7,
            "테스트 고객",
            "인천",
            "010-1234-5678",
            "A",
            15,
            "1000000",
            "700000",
            "300000",
            new Date("2026-05-01T00:00:00.000Z"),
            new Date("2026-05-20T00:00:00.000Z"),
            false,
            true,
            "900101",
            null,
            "waiting",
            false,
            null,
            new Date("2026-04-01T00:00:00.000Z"),
        );

    const eformsignClient = {
        getDocument: jest.fn(),
    };

    const eformsignDocRepository = {
        findByDocumentId: jest.fn(),
    };

    const clientRepository = {
        findById: jest.fn(),
        update: jest.fn(),
    };

    let usecase: SyncClientEndDateUsecase;
    let warnSpy: jest.SpyInstance;
    let errorSpy: jest.SpyInstance;

    beforeEach(() => {
        usecase = new SyncClientEndDateUsecase(
            eformsignClient as never,
            eformsignDocRepository as never,
            clientRepository as never,
        );

        eformsignDocRepository.findByDocumentId.mockResolvedValue(createDocEntity());
        clientRepository.findById.mockResolvedValue(createClientEntity());
        clientRepository.update.mockImplementation(async (_branchId: string, client: ClientEntity) => client);

        warnSpy = jest.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
        errorSpy = jest.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
    });

    afterEach(() => {
        jest.clearAllMocks();
        warnSpy.mockRestore();
        errorSpy.mockRestore();
    });

    it("should update client.endDate using UTC when all end-date fields exist", async () => {
        eformsignClient.getDocument.mockResolvedValue(
            createDocumentResponse([
                { id: "계약 종료 년도", value: "2026", type: "text" },
                { id: "계약 종료 월", value: "05", type: "text" },
                { id: "계약 종료 일", value: "17", type: "text" },
            ])
        );

        const result = await usecase.execute(branchId, documentId, accessToken);

        expect(clientRepository.update).toHaveBeenCalledTimes(1);
        expect(clientRepository.update).toHaveBeenCalledWith(
            branchId,
            expect.objectContaining({
                endDate: expect.any(Date),
            })
        );

        const updatedClient = clientRepository.update.mock.calls[0][1] as ClientEntity;
        expect(updatedClient.endDate?.toISOString()).toBe("2026-05-17T00:00:00.000Z");
        expect(updatedClient.duration).toBe(countBusinessDaysKr("2026-05-01", "2026-05-17"));
        expect(result).toEqual({
            clientId: 7,
            endDate: new Date("2026-05-17T00:00:00.000Z"),
        });
    });

    it.each(["26", "026"])("normalizes template year %s to 2026", async (year) => {
        eformsignClient.getDocument.mockResolvedValue(
            createDocumentResponse([
                { id: "계약 종료 년도", value: year, type: "text" },
                { id: "계약 종료 월", value: "11", type: "text" },
                { id: "계약 종료 일", value: "30", type: "text" },
            ]),
        );

        await expect(usecase.execute(branchId, documentId, accessToken)).resolves.toEqual({
            clientId: 7,
            endDate: new Date("2026-11-30T00:00:00.000Z"),
        });
    });

    it("fails closed for an end date in an unsupported holiday year", async () => {
        eformsignClient.getDocument.mockResolvedValue(
            createDocumentResponse([
                { id: "계약 종료 년도", value: "2028", type: "text" },
                { id: "계약 종료 월", value: "01", type: "text" },
                { id: "계약 종료 일", value: "03", type: "text" },
            ]),
        );

        await expect(usecase.execute(branchId, documentId, accessToken, { throwOnError: true }))
            .rejects.toBeInstanceOf(UnsupportedKoreanHolidayYearError);
        expect(clientRepository.update).not.toHaveBeenCalled();
    });

    it("should delegate persistence when an atomic lifecycle writer is provided", async () => {
        eformsignClient.getDocument.mockResolvedValue(
            createDocumentResponse([
                { id: "계약 종료 년도", value: "2026", type: "text" },
                { id: "계약 종료 월", value: "05", type: "text" },
                { id: "계약 종료 일", value: "31", type: "text" },
            ])
        );
        const persist = jest.fn().mockResolvedValue(undefined);

        const result = await usecase.execute(branchId, documentId, accessToken, { persist });

        expect(persist).toHaveBeenCalledWith({
            clientId: 7,
            endDate: new Date("2026-05-31T00:00:00.000Z"),
        });
        expect(clientRepository.update).not.toHaveBeenCalled();
        expect(result).toEqual({
            clientId: 7,
            endDate: new Date("2026-05-31T00:00:00.000Z"),
        });
    });

    it("syncs from an already mirrored document without calling eformsign again", async () => {
        const document = createDocumentResponse([
            { id: "계약 종료 년도", value: "2026", type: "text" },
            { id: "계약 종료 월", value: "06", type: "text" },
            { id: "계약 종료 일", value: "01", type: "text" },
        ]);

        const result = await usecase.executeFromDocument(
            branchId,
            documentId,
            document,
        );

        expect(eformsignClient.getDocument).not.toHaveBeenCalled();
        expect(clientRepository.update).toHaveBeenCalledTimes(1);
        expect(result).toEqual({
            clientId: 7,
            endDate: new Date("2026-06-01T00:00:00.000Z"),
        });
    });

    it("should skip update when any end-date field is missing", async () => {
        eformsignClient.getDocument.mockResolvedValue(
            createDocumentResponse([
                { id: "계약 종료 년도", value: "2026", type: "text" },
                { id: "계약 종료 월", value: "", type: "text" },
            ])
        );

        await usecase.execute(branchId, documentId, accessToken);

        expect(clientRepository.update).not.toHaveBeenCalled();
        expect(warnSpy).toHaveBeenCalled();
    });

    it("fails closed on missing end-date fields during strict reconciliation", async () => {
        const document = createDocumentResponse([
            { id: "계약 종료 년도", value: "26", type: "text" },
            { id: "계약 종료 월", value: "", type: "text" },
        ]);

        await expect(usecase.executeFromDocument(
            branchId,
            documentId,
            document,
            { throwOnError: true },
        )).rejects.toThrow(/end date fields missing/i);
    });

    it("should skip client sync when the document belongs to a deleted client", async () => {
        eformsignClient.getDocument.mockResolvedValue(
            createDocumentResponse([
                { id: "계약 종료 년도", value: "2026", type: "text" },
                { id: "계약 종료 월", value: "05", type: "text" },
                { id: "계약 종료 일", value: "17", type: "text" },
            ]),
        );
        eformsignDocRepository.findByDocumentId.mockResolvedValue(
            EformsignDocEntity.reconstitute({
                ...createDocEntity().toJSON(),
                clientId: null,
            }),
        );

        await expect(usecase.execute(branchId, documentId, accessToken)).resolves.toBeUndefined();

        expect(clientRepository.findById).not.toHaveBeenCalled();
        expect(clientRepository.update).not.toHaveBeenCalled();
    });

    it("should swallow getDocument errors and log only a sanitized message", async () => {
        eformsignClient.getDocument.mockRejectedValue(
            new Error(
                "Bearer vendor-token access_token=secret-token phone=010-1234-5678",
            ),
        );

        await expect(usecase.execute(branchId, documentId, accessToken)).resolves.toBeUndefined();

        expect(clientRepository.update).not.toHaveBeenCalled();
        expect(errorSpy).toHaveBeenCalledWith(
            `Failed to sync client endDate for document ${documentId}: ` +
            "Bearer [REDACTED] access_token=[REDACTED] phone=[REDACTED_PHONE]",
        );
        expect(errorSpy.mock.calls.flat().join(" ")).not.toContain("vendor-token");
        expect(errorSpy.mock.calls.flat().join(" ")).not.toContain("secret-token");
        expect(errorSpy.mock.calls.flat().join(" ")).not.toContain("010-1234-5678");
    });

    it("rethrows persistence failures only when strict completion reconciliation requests it", async () => {
        const document = createDocumentResponse([
            { id: "계약 종료 년도", value: "2026", type: "text" },
            { id: "계약 종료 월", value: "05", type: "text" },
            { id: "계약 종료 일", value: "17", type: "text" },
        ]);
        const lifecycleError = new Error("lifecycle database unavailable");
        const persist = jest.fn().mockRejectedValue(lifecycleError);

        await expect(usecase.executeFromDocument(
            branchId,
            documentId,
            document,
            { persist, throwOnError: true },
        )).rejects.toThrow(lifecycleError);
    });
});
