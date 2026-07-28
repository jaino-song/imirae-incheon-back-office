import { EformsignWebhookService } from "application/services/eformsign-webhook.service";
import { LinkDocumentToClientUsecase } from "application/usecases/eformsign-doc/link-document-to-client.usecase";
import { UpdateEformsignDocStatusUsecase } from "application/usecases/eformsign-doc/update-eformsign-doc-status.usecase";
import { ClientEntity } from "domain/entities/client.entity";
import { EformsignDocEntity } from "domain/entities/eformsign-doc.entity";
import { EformsignDocMapper } from "infrastructure/database/mapper/eformsign-doc.mapper";
import { EformsignWebhookPayloadDto } from "interface/dto/eformsign-webhook.dto";

describe("EformsignWebhookService", () => {
    const branchId = "test-branch";
    const documentId = "doc-123";

    const createDocEntity = (overrides: Partial<{
        clientId: number | null;
        documentName: string | null;
    }> = {}): EformsignDocEntity =>
        EformsignDocEntity.reconstitute({
            id: 1,
            documentId,
            documentName: overrides.documentName ?? null,
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
            clientId: overrides.clientId ?? 9,
        });

    const createClientEntity = (): ClientEntity =>
        ClientEntity.reconstitute(
            9,
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
            documentId,
            new Date("2026-04-01T00:00:00.000Z"),
        );

    const createDocumentPayload = (): EformsignWebhookPayloadDto => ({
        webhook_id: "wh-1",
        webhook_name: "test",
        company_id: "company-1",
        event_type: "document",
        document: {
            id: documentId,
            document_title: "산모신생아건강관리서비스 계약서",
            template_id: "template-1",
            template_name: "template",
            workflow_seq: 3,
            workflow_name: "직원 확정",
            status: "doc_complete",
            updated_date: Date.now(),
        },
    });

    const createReadyPdfPayload = (): EformsignWebhookPayloadDto => ({
        webhook_id: "wh-2",
        webhook_name: "test",
        company_id: "company-1",
        event_type: "ready_document_pdf",
        ready_document_pdf: {
            document_id: documentId,
            document_title: "산모신생아건강관리서비스 계약서",
            workflow_seq: 3,
            workflow_name: "직원 확정",
            template_id: "template-1",
            template_name: "template",
            document_status: "doc_complete",
        },
    });

    const updateStatusUsecase = {
        execute: jest.fn(),
    };
    const linkDocumentUsecase = {
        execute: jest.fn(),
    };
    const syncClientEndDateUsecase = {
        execute: jest.fn(),
    };
    const eformsignApiClient = {
        getAccessToken: jest.fn(),
        getDocument: jest.fn(),
    };
    const notificationService = {
        sendToBranchUsers: jest.fn(),
    };
    const clientRepository = {
        findById: jest.fn(),
    };
    const eformsignDocRepository = {
        findByDocumentId: jest.fn(),
        findBranchIdByDocumentId: jest.fn(),
        claimCompletionStatus: jest.fn(),
        update: jest.fn(),
    };
    const employeeScheduleRepository = {
        findByClientId: jest.fn(),
    };
    const employeeRepository = {
        findById: jest.fn(),
    };
    const eventBus = {
        emit: jest.fn(),
        events$: { subscribe: jest.fn() },
    };
    const serviceRecordLifecycle = {
        syncEndDateFromContract: jest.fn(),
    };

    let service: EformsignWebhookService;

    beforeEach(() => {
        service = new EformsignWebhookService(
            updateStatusUsecase as never,
            linkDocumentUsecase as never,
            syncClientEndDateUsecase as never,
            eventBus as never,
            notificationService as never,
            eformsignApiClient as never,
            clientRepository as never,
            eformsignDocRepository as never,
            employeeScheduleRepository as never,
            employeeRepository as never,
            undefined,
            serviceRecordLifecycle as never,
        );

        updateStatusUsecase.execute.mockResolvedValue(createDocEntity());
        linkDocumentUsecase.execute.mockResolvedValue(undefined);
        syncClientEndDateUsecase.execute.mockResolvedValue(undefined);
        eformsignApiClient.getAccessToken.mockResolvedValue({
            oauth_token: {
                access_token: "test-access-token",
                refresh_token: "test-refresh-token",
            },
        });
        eformsignApiClient.getDocument.mockResolvedValue({
            current_status: {
                status_type: "060",
                step_type: "05",
                step_name: "이용자",
                step_recipients: [{ recipient_type: "02" }],
            },
        });
        notificationService.sendToBranchUsers.mockResolvedValue({ sent: 1, failed: 0 });
        eformsignDocRepository.findBranchIdByDocumentId.mockResolvedValue(branchId);
        eformsignDocRepository.findByDocumentId.mockResolvedValue(createDocEntity());
        eformsignDocRepository.claimCompletionStatus.mockResolvedValue("claimed");
        clientRepository.findById.mockResolvedValue(createClientEntity());
        employeeScheduleRepository.findByClientId.mockResolvedValue([]);
        employeeRepository.findById.mockResolvedValue(null);
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    it("should call link and sync usecases for DOC_COMPLETE document events", async () => {
        const target = {
            clientId: 9,
            endDate: new Date("2026-07-31T00:00:00.000Z"),
        };
        syncClientEndDateUsecase.execute.mockResolvedValue(target);

        await expect(service.processWebhook(createDocumentPayload())).resolves.toBeUndefined();

        expect(linkDocumentUsecase.execute).toHaveBeenCalledWith(branchId, documentId);
        expect(syncClientEndDateUsecase.execute).toHaveBeenCalledWith(
            branchId,
            documentId,
            "test-access-token",
            expect.objectContaining({ persist: expect.any(Function) }),
        );
        const options = syncClientEndDateUsecase.execute.mock.calls[0][3] as {
            persist: (value: typeof target) => Promise<void>;
        };
        await options.persist(target);
        expect(serviceRecordLifecycle.syncEndDateFromContract).toHaveBeenCalledWith({
            branchId,
            clientId: 9,
            endDate: target.endDate,
        });
    });

    it("should resolve the branch from the local document before processing webhook status", async () => {
        await expect(service.processWebhook(createDocumentPayload())).resolves.toBeUndefined();

        expect(eformsignDocRepository.findBranchIdByDocumentId).toHaveBeenCalledWith(documentId);
        expect(eformsignDocRepository.claimCompletionStatus).toHaveBeenCalledWith(
            branchId,
            expect.objectContaining({
                documentId,
                documentName: "산모신생아건강관리서비스 계약서",
            }),
        );
    });

    it("should keep processing document events when sync throws", async () => {
        syncClientEndDateUsecase.execute.mockRejectedValue(new Error("sync failed"));

        await expect(service.processWebhook(createDocumentPayload())).resolves.toBeUndefined();

        expect(linkDocumentUsecase.execute).toHaveBeenCalledWith(branchId, documentId);
        expect(syncClientEndDateUsecase.execute).toHaveBeenCalledWith(
            branchId,
            documentId,
            "test-access-token",
            expect.objectContaining({ persist: expect.any(Function) }),
        );
    });

    it("should call link and sync usecases for DOC_COMPLETE ready_document_pdf events", async () => {
        await expect(service.processWebhook(createReadyPdfPayload())).resolves.toBeUndefined();

        expect(linkDocumentUsecase.execute).toHaveBeenCalledWith(branchId, documentId);
        expect(syncClientEndDateUsecase.execute).toHaveBeenCalledWith(
            branchId,
            documentId,
            "test-access-token",
            expect.objectContaining({ persist: expect.any(Function) }),
        );
    });

    it("should keep processing ready_document_pdf events when sync throws", async () => {
        syncClientEndDateUsecase.execute.mockRejectedValue(new Error("sync failed"));

        await expect(service.processWebhook(createReadyPdfPayload())).resolves.toBeUndefined();

        expect(linkDocumentUsecase.execute).toHaveBeenCalledWith(branchId, documentId);
        expect(syncClientEndDateUsecase.execute).toHaveBeenCalledWith(
            branchId,
            documentId,
            "test-access-token",
            expect.objectContaining({ persist: expect.any(Function) }),
        );
    });

    it("should notify branch users when a document reaches review-required status", async () => {
        eformsignApiClient.getDocument.mockResolvedValue({
            current_status: {
                status_type: "070",
                step_type: "06",
                step_name: "제공기관 검토",
                step_recipients: [{ recipient_type: "01" }],
            },
        });
        const payload = createDocumentPayload();
        if (!payload.document) {
            throw new Error("document payload is required");
        }
        payload.document.status = "doc_accept_participant";

        await expect(service.processWebhook(payload)).resolves.toBeUndefined();

        expect(notificationService.sendToBranchUsers).toHaveBeenCalledWith(
            branchId,
            "전자문서 검토 필요",
            "산모신생아건강관리서비스 계약서 검토가 필요합니다. 최종 확인을 진행해 주세요.",
            {
                type: "eformsign-review-required",
                documentId,
                url: `/contracts?documentId=${documentId}`,
            },
            {
                dedupe: {
                    type: "eformsign-review-required",
                    documentId,
                },
            },
        );
    });

    it("should not notify branch users when the current recipient is still external", async () => {
        const payload = createDocumentPayload();
        if (!payload.document) {
            throw new Error("document payload is required");
        }
        payload.document.status = "doc_accept_participant";

        await expect(service.processWebhook(payload)).resolves.toBeUndefined();

        expect(notificationService.sendToBranchUsers).not.toHaveBeenCalled();
    });

    it("should keep the client contract pointer linked on non-complete document status updates", async () => {
        const payload = createDocumentPayload();
        if (!payload.document) {
            throw new Error("document payload is required");
        }
        payload.document.status = "doc_request_participant";

        await expect(service.processWebhook(payload)).resolves.toBeUndefined();

        expect(updateStatusUsecase.execute).toHaveBeenCalledWith(
            branchId,
            expect.objectContaining({
                documentId,
                statusType: "060",
                documentName: "산모신생아건강관리서비스 계약서",
            }),
        );
        expect(linkDocumentUsecase.execute).toHaveBeenCalledWith(branchId, documentId);
    });

    it("preserves the webhook documentName when status persistence is followed by client reassignment", async () => {
        let storedDoc = createDocEntity({
            clientId: 7,
            documentName: "기존 문서명",
        });
        const statefulDocRepository = {
            findBranchIdByDocumentId: jest.fn().mockResolvedValue(branchId),
            findByDocumentId: jest.fn().mockImplementation(() => Promise.resolve(storedDoc)),
            update: jest.fn().mockImplementation((_branchid, doc: EformsignDocEntity) => {
                const storedId = storedDoc.id;
                if (storedId === undefined) {
                    throw new Error("stored document id is required");
                }
                storedDoc = EformsignDocMapper.toDomain({
                    id: storedId,
                    ...EformsignDocMapper.toPrismaCreate(storedDoc),
                    ...EformsignDocMapper.toPrismaUpdate(doc),
                });
                return Promise.resolve(storedDoc);
            }),
        };
        const phoneMatchedClient = createClientEntity();
        const statefulClientRepository = {
            findByPhone: jest.fn().mockResolvedValue(phoneMatchedClient),
            findById: jest.fn(),
            update: jest.fn().mockResolvedValue(phoneMatchedClient),
        };
        const realUpdateStatusUsecase = new UpdateEformsignDocStatusUsecase(
            statefulDocRepository as never,
        );
        const realLinkDocumentUsecase = new LinkDocumentToClientUsecase(
            statefulDocRepository as never,
            statefulClientRepository as never,
        );
        const statefulService = new EformsignWebhookService(
            realUpdateStatusUsecase,
            realLinkDocumentUsecase,
            syncClientEndDateUsecase as never,
            eventBus as never,
            notificationService as never,
            eformsignApiClient as never,
            statefulClientRepository as never,
            statefulDocRepository as never,
            employeeScheduleRepository as never,
            employeeRepository as never,
        );
        const payload = createDocumentPayload();
        if (!payload.document) {
            throw new Error("document payload is required");
        }
        payload.document.status = "doc_request_participant";

        await statefulService.processWebhook(payload);

        expect(statefulDocRepository.update).toHaveBeenCalledTimes(2);
        expect(storedDoc.clientId).toBe(9);
        expect(storedDoc.documentName).toBe("산모신생아건강관리서비스 계약서");
    });

    it("should not notify branch users for a user participant step even when eformsign reports recipient_type 01", async () => {
        eformsignApiClient.getDocument.mockResolvedValue({
            current_status: {
                status_type: "060",
                status_doc_type: "01",
                status_doc_detail: "060",
                step_type: "05",
                step_index: "2",
                step_name: "이용자",
                step_recipients: [{ recipient_type: "01", name: "송진호" }],
                step_group: 3,
                expired_date: Date.now() + 1000 * 60 * 60 * 24,
                _expired: false,
            },
        });
        const payload = createDocumentPayload();
        if (!payload.document) {
            throw new Error("document payload is required");
        }
        payload.document.status = "doc_accept_participant";

        await expect(service.processWebhook(payload)).resolves.toBeUndefined();

        expect(notificationService.sendToBranchUsers).not.toHaveBeenCalled();
    });

    it("should not notify branch users for provider drafting steps", async () => {
        eformsignApiClient.getDocument.mockResolvedValue({
            current_status: {
                status_type: "002",
                status_doc_type: "01",
                status_doc_detail: "002",
                step_type: "00",
                step_index: "1",
                step_name: "제공기관 작성",
                step_recipients: [{ recipient_type: "01", name: "작성 담당자" }],
                step_group: 1,
                expired_date: Date.now() + 1000 * 60 * 60 * 24,
                _expired: false,
            },
        });
        const payload = createDocumentPayload();
        if (!payload.document) {
            throw new Error("document payload is required");
        }
        payload.document.status = "doc_accept_participant";

        await expect(service.processWebhook(payload)).resolves.toBeUndefined();

        expect(notificationService.sendToBranchUsers).not.toHaveBeenCalled();
    });

    it("should keep processing when review-required notification lookup fails", async () => {
        eformsignApiClient.getDocument.mockRejectedValue(new Error("eformsign unavailable"));
        const payload = createDocumentPayload();
        if (!payload.document) {
            throw new Error("document payload is required");
        }
        payload.document.status = "doc_accept_participant";

        await expect(service.processWebhook(payload)).resolves.toBeUndefined();

        expect(eventBus.emit).toHaveBeenCalledWith({
            branchId,
            documentId,
            reason: "doc:doc_accept_participant",
        });
    });

    it("should acknowledge duplicate completion webhooks without repeating completion side effects", async () => {
        eformsignDocRepository.claimCompletionStatus
            .mockResolvedValueOnce("claimed")
            .mockResolvedValueOnce("duplicate");

        await expect(service.processWebhook(createDocumentPayload())).resolves.toBeUndefined();
        await expect(service.processWebhook(createDocumentPayload())).resolves.toBeUndefined();

        expect(linkDocumentUsecase.execute).toHaveBeenCalledTimes(1);
        expect(syncClientEndDateUsecase.execute).toHaveBeenCalledTimes(1);
        expect(eventBus.emit).toHaveBeenCalledTimes(1);
    });

    it("keeps a completed document's status when a stale document_action webhook arrives after completion (P1-11)", async () => {
        // Wire the REAL usecase (the single write gateway) instead of the jest.fn()
        // mock used elsewhere in this file, so the guard inside
        // UpdateEformsignDocStatusUsecase.execute is actually exercised end-to-end.
        const realUpdateStatusUsecase = new UpdateEformsignDocStatusUsecase(eformsignDocRepository as never);
        const serviceWithRealUsecase = new EformsignWebhookService(
            realUpdateStatusUsecase as never,
            linkDocumentUsecase as never,
            syncClientEndDateUsecase as never,
            eventBus as never,
            notificationService as never,
            eformsignApiClient as never,
            clientRepository as never,
            eformsignDocRepository as never,
            employeeScheduleRepository as never,
            employeeRepository as never,
            undefined,
            serviceRecordLifecycle as never,
        );

        eformsignDocRepository.findByDocumentId.mockResolvedValue(
            EformsignDocEntity.reconstitute({
                id: 1,
                documentId,
                createdDate: new Date("2026-05-01T00:00:00.000Z"),
                updatedDate: new Date("2026-05-03T00:00:00.000Z"),
                statusType: "050",
                statusDetail: "완료",
                stepType: "05",
                stepIndex: "3",
                stepName: "이용자",
                stepRecipientType: "01",
                stepRecipientName: "직원",
                stepRecipientSms: "01012345678",
                expiredDate: new Date("2026-06-01T00:00:00.000Z"),
                expired: false,
                clientId: 9,
            }),
        );

        const staleDocumentActionPayload: EformsignWebhookPayloadDto = {
            webhook_id: "wh-3",
            webhook_name: "test",
            company_id: "company-1",
            event_type: "document_action",
            document: {
                id: documentId,
                document_title: "산모신생아건강관리서비스 계약서",
                template_id: "template-1",
                template_name: "template",
                workflow_seq: 3,
                workflow_name: "직원 확정",
                status: "doc_complete",
                action: "doc_open_participant",
                updated_date: Date.now(),
            },
        };

        await expect(serviceWithRealUsecase.processWebhook(staleDocumentActionPayload)).resolves.toBeUndefined();

        expect(eformsignDocRepository.update).not.toHaveBeenCalled();
    });
});
