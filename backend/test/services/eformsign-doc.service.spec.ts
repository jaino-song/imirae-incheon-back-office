import { EformsignDocService } from "application/services/eformsign-doc.service";
import { CreateEformsignDocParams } from "application/usecases/eformsign-doc";
import { EformsignDocEntity } from "domain/entities/eformsign-doc.entity";
import { EformsignApiDocumentResponse } from "domain/repositories/eformsign.client.interface";

describe("EformsignDocService", () => {
    const branchId = "test-branch";
    const otherBranchId = "other-branch";
    const documentId = "doc-123";

    const createDocEntity = (overrides: Partial<{ statusType: string; statusDetail: string }> = {}): EformsignDocEntity =>
        EformsignDocEntity.reconstitute({
            id: 1,
            documentId,
            createdDate: new Date("2026-05-01T00:00:00.000Z"),
            updatedDate: new Date("2026-05-02T00:00:00.000Z"),
            statusType: overrides.statusType ?? "060",
            statusDetail: overrides.statusDetail ?? "서명 요청됨",
            stepType: "06",
            stepIndex: "3",
            stepName: "제공기관 확인",
            stepRecipientType: "01",
            stepRecipientName: "직원",
            stepRecipientSms: "01012345678",
            expiredDate: new Date("2026-06-01T00:00:00.000Z"),
            expired: false,
            clientId: 9,
        });

    // Minimal API doc response; only current_status drives syncStatusFromApi.
    const createApiDocument = (
        currentStatus: Partial<EformsignApiDocumentResponse["current_status"]>,
    ): EformsignApiDocumentResponse =>
        ({
            id: documentId,
            current_status: currentStatus,
        }) as unknown as EformsignApiDocumentResponse;

    const createParams = (): CreateEformsignDocParams => ({
        documentId,
        clientId: 9,
        statusType: "010",
        statusDetail: "created",
        stepType: "01",
        stepIndex: "1",
        stepName: "시작",
        stepRecipientType: "signer",
        stepRecipientName: "직원",
        stepRecipientSms: "01012345678",
        expiredDate: new Date("2026-06-01T00:00:00.000Z"),
        linkToClient: true,
    });

    const findEformsignDocByIdUsecase = { execute: jest.fn() };
    const findEformsignDocByDocumentIdUsecase = { execute: jest.fn() };
    const findEformsignDocsByClientIdUsecase = { execute: jest.fn() };
    const listEformsignDocsUsecase = { execute: jest.fn() };
    const listOtherBranchDocumentIdsUsecase = { execute: jest.fn() };
    const listEformsignDocDisplayFieldsUsecase = { execute: jest.fn() };
    const createEformsignDocUsecase = { execute: jest.fn() };
    const updateEformsignDocStatusUsecase = { execute: jest.fn() };
    const linkDocumentToClientUsecase = { execute: jest.fn() };
    const fetchAllEformsignDocsFromApiUsecase = { execute: jest.fn() };
    const fetchEformsignDocFromApiUsecase = { execute: jest.fn() };
    const createAndSendContractUsecase = { execute: jest.fn() };
    const principal = { branchId, globalRole: "owner" };

    let service: EformsignDocService;

    beforeEach(() => {
        service = new EformsignDocService(
            findEformsignDocByIdUsecase as never,
            findEformsignDocByDocumentIdUsecase as never,
            findEformsignDocsByClientIdUsecase as never,
            listEformsignDocsUsecase as never,
            listOtherBranchDocumentIdsUsecase as never,
            listEformsignDocDisplayFieldsUsecase as never,
            createEformsignDocUsecase as never,
            updateEformsignDocStatusUsecase as never,
            linkDocumentToClientUsecase as never,
            fetchAllEformsignDocsFromApiUsecase as never,
            fetchEformsignDocFromApiUsecase as never,
            createAndSendContractUsecase as never,
        );

        updateEformsignDocStatusUsecase.execute.mockResolvedValue(createDocEntity());
        linkDocumentToClientUsecase.execute.mockResolvedValue(undefined);
        createEformsignDocUsecase.execute.mockResolvedValue(createDocEntity());
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    // ============ Local DB facade: branch/tenant scoping on every read+write ============

    describe("local DB delegation and branch scoping", () => {
        it("create forwards branchid and params, returning the created entity", async () => {
            const entity = createDocEntity();
            createEformsignDocUsecase.execute.mockResolvedValue(entity);
            const params = createParams();

            await expect(service.create(branchId, params)).resolves.toBe(entity);

            expect(createEformsignDocUsecase.execute).toHaveBeenCalledWith(branchId, params);
        });

        it("findById scopes the read to the supplied branch", async () => {
            const entity = createDocEntity();
            findEformsignDocByIdUsecase.execute.mockResolvedValue(entity);

            await expect(service.findById(otherBranchId, 1)).resolves.toBe(entity);

            expect(findEformsignDocByIdUsecase.execute).toHaveBeenCalledWith(otherBranchId, 1);
        });

        it("findById returns null when the usecase finds nothing (not-found handling)", async () => {
            findEformsignDocByIdUsecase.execute.mockResolvedValue(null);

            await expect(service.findById(branchId, 999)).resolves.toBeNull();
        });

        it("findByDocumentId scopes the read to the supplied branch", async () => {
            const entity = createDocEntity();
            findEformsignDocByDocumentIdUsecase.execute.mockResolvedValue(entity);

            await expect(service.findByDocumentId(branchId, documentId)).resolves.toBe(entity);

            expect(findEformsignDocByDocumentIdUsecase.execute).toHaveBeenCalledWith(branchId, documentId);
        });

        it("findByDocumentId returns null when nothing matches", async () => {
            findEformsignDocByDocumentIdUsecase.execute.mockResolvedValue(null);

            await expect(service.findByDocumentId(branchId, "missing")).resolves.toBeNull();
        });

        it("findByClientId scopes the read to the supplied branch", async () => {
            const docs = [createDocEntity()];
            findEformsignDocsByClientIdUsecase.execute.mockResolvedValue(docs);

            await expect(service.findByClientId(branchId, 9)).resolves.toBe(docs);

            expect(findEformsignDocsByClientIdUsecase.execute).toHaveBeenCalledWith(branchId, 9);
            expect(fetchEformsignDocFromApiUsecase.execute).not.toHaveBeenCalled();
        });

        it("findAll scopes the list to the supplied branch", async () => {
            const docs = [createDocEntity()];
            listEformsignDocsUsecase.execute.mockResolvedValue(docs);

            await expect(service.findAll(branchId)).resolves.toBe(docs);

            expect(listEformsignDocsUsecase.execute).toHaveBeenCalledWith(branchId);
        });

        it("findDocumentIdsForOtherBranches delegates to the list-other-branch usecase", async () => {
            const ids = ["doc-a", "doc-b"];
            listOtherBranchDocumentIdsUsecase.execute.mockResolvedValue(ids);

            await expect(service.findDocumentIdsForOtherBranches(branchId)).resolves.toBe(ids);

            expect(listOtherBranchDocumentIdsUsecase.execute).toHaveBeenCalledWith(branchId);
        });

        it("findDisplayFieldsByDocumentIds scopes the page lookup to the supplied branch", async () => {
            const displayFields = [{ documentId, customerName: "고객" }];
            listEformsignDocDisplayFieldsUsecase.execute.mockResolvedValue(displayFields);

            await expect(
                service.findDisplayFieldsByDocumentIds(branchId, [documentId]),
            ).resolves.toBe(displayFields);

            expect(listEformsignDocDisplayFieldsUsecase.execute).toHaveBeenCalledWith(
                branchId,
                [documentId],
            );
        });

        it("createAndSendContract forwards branchid and params", async () => {
            const result = { success: true, documentId };
            createAndSendContractUsecase.execute.mockResolvedValue(result);
            const params = { clientId: 9, templateId: "tpl-1", templateName: "계약서" };

            await expect(service.createAndSendContract(branchId, params, principal)).resolves.toBe(result);

            expect(createAndSendContractUsecase.execute).toHaveBeenCalledWith(branchId, params, principal);
        });
    });

    // ============ External API facade: token + fetch (no branch scoping) ============

    describe("external API delegation", () => {
        it("fetchAllFromApi delegates with the access token", async () => {
            const docs = [createApiDocument({ status_type: "060" })];
            fetchAllEformsignDocsFromApiUsecase.execute.mockResolvedValue(docs);

            await expect(service.fetchAllFromApi("access-token")).resolves.toBe(docs);

            expect(fetchAllEformsignDocsFromApiUsecase.execute).toHaveBeenCalledWith("access-token");
        });

        it("fetchFromApi delegates with the access token and documentId", async () => {
            const doc = createApiDocument({ status_type: "060" });
            fetchEformsignDocFromApiUsecase.execute.mockResolvedValue(doc);

            await expect(service.fetchFromApi("access-token", documentId)).resolves.toBe(doc);

            expect(fetchEformsignDocFromApiUsecase.execute).toHaveBeenCalledWith("access-token", documentId);
        });
    });

    // ============ syncStatusFromApi: orchestration + status mapping ============

    describe("syncStatusFromApi", () => {
        it("fetches the remote doc then persists the mapped status under the same branch", async () => {
            fetchEformsignDocFromApiUsecase.execute.mockResolvedValue(
                createApiDocument({
                    status_type: "060",
                    step_type: "06",
                    step_index: "3",
                    step_name: "제공기관 확인",
                    _expired: false,
                }),
            );
            const updated = createDocEntity();
            updateEformsignDocStatusUsecase.execute.mockResolvedValue(updated);

            await expect(
                service.syncStatusFromApi(branchId, "access-token", documentId),
            ).resolves.toBe(updated);

            expect(fetchEformsignDocFromApiUsecase.execute).toHaveBeenCalledWith("access-token", documentId);
            expect(updateEformsignDocStatusUsecase.execute).toHaveBeenCalledWith(branchId, {
                documentId,
                statusType: "060",
                statusDetail: "제공기관 확인",
                stepType: "06",
                stepIndex: "3",
                stepName: "제공기관 확인",
                expired: false,
            });
        });

        it("maps a completed status code to the 완료 detail", async () => {
            fetchEformsignDocFromApiUsecase.execute.mockResolvedValue(
                createApiDocument({ status_type: "050", step_name: "최종 완료" }),
            );

            await service.syncStatusFromApi(branchId, "access-token", documentId);

            expect(updateEformsignDocStatusUsecase.execute).toHaveBeenCalledWith(
                branchId,
                expect.objectContaining({ statusType: "050", statusDetail: "완료" }),
            );
        });

        it("maps a rejected status code to the 거부 detail", async () => {
            fetchEformsignDocFromApiUsecase.execute.mockResolvedValue(
                createApiDocument({ status_type: "080", step_name: "반려됨" }),
            );

            await service.syncStatusFromApi(branchId, "access-token", documentId);

            expect(updateEformsignDocStatusUsecase.execute).toHaveBeenCalledWith(
                branchId,
                expect.objectContaining({ statusType: "080", statusDetail: "거부" }),
            );
        });

        it("falls back to the step name for an in-progress status code", async () => {
            fetchEformsignDocFromApiUsecase.execute.mockResolvedValue(
                createApiDocument({ status_type: "060", step_name: "  이용자 서명  " }),
            );

            await service.syncStatusFromApi(branchId, "access-token", documentId);

            expect(updateEformsignDocStatusUsecase.execute).toHaveBeenCalledWith(
                branchId,
                expect.objectContaining({ statusType: "060", statusDetail: "이용자 서명" }),
            );
        });

        it("falls back to 진행중 when an in-progress status has no step name", async () => {
            fetchEformsignDocFromApiUsecase.execute.mockResolvedValue(
                createApiDocument({ status_type: "060", step_name: "   " }),
            );

            await service.syncStatusFromApi(branchId, "access-token", documentId);

            expect(updateEformsignDocStatusUsecase.execute).toHaveBeenCalledWith(
                branchId,
                expect.objectContaining({ statusType: "060", statusDetail: "진행중" }),
            );
        });

        it("normalizes a short status code by left-padding to three digits", async () => {
            fetchEformsignDocFromApiUsecase.execute.mockResolvedValue(
                createApiDocument({ status_type: "50", step_name: "완료 단계" }),
            );

            await service.syncStatusFromApi(branchId, "access-token", documentId);

            // "50" -> "050" which is in COMPLETED_STATUS_CODES
            expect(updateEformsignDocStatusUsecase.execute).toHaveBeenCalledWith(
                branchId,
                expect.objectContaining({ statusType: "050", statusDetail: "완료" }),
            );
        });

        it("trims surrounding whitespace before normalizing the status code", async () => {
            fetchEformsignDocFromApiUsecase.execute.mockResolvedValue(
                createApiDocument({ status_type: " 80 ", step_name: "반려" }),
            );

            await service.syncStatusFromApi(branchId, "access-token", documentId);

            // " 80 " -> trim -> "80" -> pad -> "080" which is REJECTED
            expect(updateEformsignDocStatusUsecase.execute).toHaveBeenCalledWith(
                branchId,
                expect.objectContaining({ statusType: "080", statusDetail: "거부" }),
            );
        });

        it("defaults a missing status code to 000 and treats it as in-progress", async () => {
            fetchEformsignDocFromApiUsecase.execute.mockResolvedValue(
                createApiDocument({ status_type: undefined, step_name: undefined }),
            );

            await service.syncStatusFromApi(branchId, "access-token", documentId);

            expect(updateEformsignDocStatusUsecase.execute).toHaveBeenCalledWith(
                branchId,
                expect.objectContaining({ statusType: "000", statusDetail: "진행중" }),
            );
        });

        it("handles a fully absent current_status block without throwing", async () => {
            fetchEformsignDocFromApiUsecase.execute.mockResolvedValue(
                createApiDocument(undefined as never),
            );

            await service.syncStatusFromApi(branchId, "access-token", documentId);

            expect(updateEformsignDocStatusUsecase.execute).toHaveBeenCalledWith(branchId, {
                documentId,
                statusType: "000",
                statusDetail: "진행중",
                stepType: undefined,
                stepIndex: undefined,
                stepName: undefined,
                expired: undefined,
            });
        });

        it("propagates a not-found error raised by the status update usecase", async () => {
            fetchEformsignDocFromApiUsecase.execute.mockResolvedValue(
                createApiDocument({ status_type: "060", step_name: "서명" }),
            );
            updateEformsignDocStatusUsecase.execute.mockRejectedValue(
                new Error("EformsignDoc with documentId doc-123 not found"),
            );

            await expect(
                service.syncStatusFromApi(branchId, "access-token", documentId),
            ).rejects.toThrow("not found");

            expect(updateEformsignDocStatusUsecase.execute).toHaveBeenCalledTimes(1);
        });

        it("propagates a remote fetch failure without attempting a status update", async () => {
            fetchEformsignDocFromApiUsecase.execute.mockRejectedValue(new Error("eformsign unavailable"));

            await expect(
                service.syncStatusFromApi(branchId, "access-token", documentId),
            ).rejects.toThrow("eformsign unavailable");

            expect(updateEformsignDocStatusUsecase.execute).not.toHaveBeenCalled();
        });
    });
});
