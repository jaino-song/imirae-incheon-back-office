import { Logger } from "@nestjs/common";
import { EformsignWebhookService } from "application/services/eformsign-webhook.service";
import { LinkDocumentToClientUsecase } from "application/usecases/eformsign-doc/link-document-to-client.usecase";
import { UpdateEformsignDocStatusUsecase } from "application/usecases/eformsign-doc/update-eformsign-doc-status.usecase";
import {
    EformsignDocMappingError,
    EformsignDocOwnershipConflictError,
} from "domain/repositories/eformsign-doc.repository.interface";
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
        statusType: string;
        templateName: string | null;
        updatedDate: Date;
        expired: boolean;
    }> = {}): EformsignDocEntity =>
        EformsignDocEntity.reconstitute({
            id: 1,
            documentId,
            documentName: overrides.documentName ?? null,
            templateName: overrides.templateName ?? "기존 템플릿명",
            customerName: "기존 고객명",
            creatorName: "기존 생성자",
            lastEditorName: "기존 편집자",
            stepRecipientTypes: ["05", "06"],
            createdDate: new Date("2026-05-01T00:00:00.000Z"),
            updatedDate: overrides.updatedDate ?? new Date("2026-05-02T00:00:00.000Z"),
            statusType: overrides.statusType ?? "060",
            statusDetail: "서명 요청됨",
            stepType: "06",
            stepIndex: "3",
            stepName: "제공기관 확인",
            stepRecipientType: "01",
            stepRecipientName: "직원",
            stepRecipientSms: "01012345678",
            expiredDate: new Date("2026-06-01T00:00:00.000Z"),
            expired: overrides.expired ?? false,
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
        executeWithOutcome: jest.fn(),
    };
    const linkDocumentUsecase = {
        execute: jest.fn(),
    };
    const syncClientEndDateUsecase = {
        execute: jest.fn(),
        executeFromDocument: jest.fn(),
    };
    const eformsignApiClient = {
        getAccessToken: jest.fn(),
        getDocument: jest.fn(),
    };
    const credentialBoundary = {
        withCredentials: jest.fn((
            _principal: unknown,
            _capability: unknown,
            operation: (credentials: { accessToken: string; refreshToken: string }) => unknown,
        ) => operation({ accessToken: "test-access-token", refreshToken: "test-refresh-token" })),
    };
    const notificationService = {
        sendToBranchUsers: jest.fn(),
    };
    const clientRepository = {
        findById: jest.fn(),
    };
    const eformsignDocRepository = {
        findByDocumentId: jest.fn(),
        findByDocumentIdUnscoped: jest.fn(),
        findBranchIdByDocumentId: jest.fn(),
        claimCompletionStatus: jest.fn(),
        upsertUnassignedByDocumentId: jest.fn(),
        update: jest.fn(),
    };
    const mirrorUnassignedDocUsecase = {
        execute: jest.fn(),
        mirrorRemoteDocument: jest.fn(),
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
        completeServiceRecordSnapshotIfReady: jest.fn(),
    };
    const documentSnapshotService = {
        bumpVersion: jest.fn(),
        bumpCompanyEpoch: jest.fn(),
    };
    const documentMirrorService = {
        isDocumentReady: jest.fn().mockResolvedValue(true),
        getStoredDetail: jest.fn().mockResolvedValue({
            current_status: { status_type: "050" },
        }),
    };
    const completedMirrorReconciler = {
        reconcileServiceRecordSnapshotCompletion: jest.fn(),
    };

    const createServiceWithCompletedMirrorReconciler = () =>
        new EformsignWebhookService(
            updateStatusUsecase as never,
            linkDocumentUsecase as never,
            syncClientEndDateUsecase as never,
            eventBus as never,
            notificationService as never,
            eformsignApiClient as never,
            credentialBoundary as never,
            clientRepository as never,
            eformsignDocRepository as never,
            employeeScheduleRepository as never,
            employeeRepository as never,
            mirrorUnassignedDocUsecase as never,
            undefined,
            serviceRecordLifecycle as never,
            documentSnapshotService as never,
            documentMirrorService as never,
            completedMirrorReconciler as never,
        );

    let service: EformsignWebhookService;

    beforeEach(() => {
        service = new EformsignWebhookService(
            updateStatusUsecase as never,
            linkDocumentUsecase as never,
            syncClientEndDateUsecase as never,
            eventBus as never,
            notificationService as never,
            eformsignApiClient as never,
            credentialBoundary as never,
            clientRepository as never,
            eformsignDocRepository as never,
            employeeScheduleRepository as never,
            employeeRepository as never,
            mirrorUnassignedDocUsecase as never,
            undefined,
            serviceRecordLifecycle as never,
            documentSnapshotService as never,
            documentMirrorService as never,
        );

        updateStatusUsecase.executeWithOutcome.mockImplementation(
            async (
                _branchId: string,
                params: { statusType: string; sourceUpdatedDate?: Date },
            ) => ({
                document: createDocEntity({
                    statusType: params.statusType,
                    ...(params.sourceUpdatedDate
                        ? { updatedDate: params.sourceUpdatedDate }
                        : {}),
                }),
                applied: true,
            }),
        );
        linkDocumentUsecase.execute.mockResolvedValue(undefined);
        syncClientEndDateUsecase.execute.mockResolvedValue(undefined);
        syncClientEndDateUsecase.executeFromDocument.mockResolvedValue(undefined);
        serviceRecordLifecycle.completeServiceRecordSnapshotIfReady.mockResolvedValue(false);
        completedMirrorReconciler.reconcileServiceRecordSnapshotCompletion.mockResolvedValue(true);
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
        eformsignDocRepository.findByDocumentIdUnscoped.mockResolvedValue({
            document: createDocEntity(),
            branchId,
        });
        eformsignDocRepository.findByDocumentId.mockResolvedValue(createDocEntity());
        eformsignDocRepository.findBranchIdByDocumentId.mockResolvedValue(branchId);
        eformsignDocRepository.claimCompletionStatus.mockResolvedValue("claimed");
        eformsignDocRepository.upsertUnassignedByDocumentId.mockImplementation(
            (doc: EformsignDocEntity) => Promise.resolve(doc),
        );
        mirrorUnassignedDocUsecase.execute.mockResolvedValue(createDocEntity({ clientId: null }));
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

    it.each([
        {
            label: "end-date synchronization",
            arrange: () => {
                syncClientEndDateUsecase.execute.mockRejectedValue(
                    new Error(
                        "Bearer vendor-token access_token=secret-token 010-1234-5678",
                    ),
                );
            },
            expectedPrefix: `Failed to sync end date for document ${documentId}:`,
        },
        {
            label: "document linking",
            arrange: () => {
                linkDocumentUsecase.execute.mockRejectedValue(
                    new Error(
                        "Bearer vendor-token access_token=secret-token 010-1234-5678",
                    ),
                );
            },
            expectedPrefix: `Failed to link document ${documentId} to client:`,
        },
    ])("sanitizes $label failures before logging", async ({ arrange, expectedPrefix }) => {
        const errorSpy = jest
            .spyOn(Logger.prototype, "error")
            .mockImplementation(() => undefined);
        arrange();

        try {
            await expect(service.processWebhook(createDocumentPayload())).resolves.toBeUndefined();

            const logged = errorSpy.mock.calls.flat().join(" ");
            expect(logged).toContain(expectedPrefix);
            expect(logged).toContain("Bearer [REDACTED]");
            expect(logged).toContain("access_token=[REDACTED]");
            expect(logged).toContain("[REDACTED_PHONE]");
            expect(logged).not.toContain("vendor-token");
            expect(logged).not.toContain("secret-token");
            expect(logged).not.toContain("010-1234-5678");
        } finally {
            errorSpy.mockRestore();
        }
    });

    it("claims a contract completion without durable effects while the controller defers to the ready mirror", async () => {
        await expect(service.processWebhook(createDocumentPayload(), {
            deferCompletionEvent: true,
            deferCompletionEffects: true,
        })).resolves.toEqual({
            completionClaim: "claimed",
            completionBranchId: branchId,
        });

        expect(eformsignDocRepository.claimCompletionStatus).toHaveBeenCalledWith(
            branchId,
            expect.objectContaining({ documentId }),
        );
        expect(linkDocumentUsecase.execute).not.toHaveBeenCalled();
        expect(syncClientEndDateUsecase.execute).not.toHaveBeenCalled();
        expect(syncClientEndDateUsecase.executeFromDocument).not.toHaveBeenCalled();
        expect(eventBus.emit).not.toHaveBeenCalled();
    });

    it("uses the already mirrored detail for completion side effects without another vendor fetch", async () => {
        const mirroredDocument = {
            id: documentId,
            document_number: "DOC-123",
            template: { id: "template-1", name: "template" },
            document_name: "산모신생아건강관리서비스 계약서",
            creator: { recipient_type: "01", id: "creator", name: "생성자" },
            created_date: Date.now() - 1_000,
            updated_date: Date.now(),
            current_status: {
                status_type: "050",
                step_type: "06",
                step_index: "3",
                step_name: "완료",
                step_recipients: [],
                step_group: 3,
            },
            fields: [],
        };

        await expect(service.processWebhook(createDocumentPayload(), {
            mirroredDocument,
        })).resolves.toBeUndefined();

        expect(syncClientEndDateUsecase.executeFromDocument).toHaveBeenCalledWith(
            branchId,
            documentId,
            mirroredDocument,
            expect.objectContaining({ persist: expect.any(Function) }),
        );
        expect(syncClientEndDateUsecase.execute).not.toHaveBeenCalled();
        expect(eformsignApiClient.getAccessToken).not.toHaveBeenCalled();
        expect(eformsignApiClient.getDocument).not.toHaveBeenCalled();
    });

    it("delegates mirrored completion persistence without changing completion claim or event ownership", async () => {
        const mirroredDocument = {
            id: documentId,
            document_number: "DOC-123",
            template: { id: "template-1", name: "template" },
            document_name: "산모신생아건강관리서비스 계약서",
            creator: { recipient_type: "01", id: "creator", name: "생성자" },
            created_date: Date.now() - 1_000,
            updated_date: Date.now(),
            current_status: {
                status_type: "050",
                step_type: "06",
                step_index: "3",
                step_name: "완료",
                step_recipients: [],
                step_group: 3,
            },
            fields: [],
        };
        const completedMirrorReconciler = {
            syncLinkedContract: jest.fn().mockResolvedValue(undefined),
        };
        const serviceWithReconciler = new EformsignWebhookService(
            updateStatusUsecase as never,
            linkDocumentUsecase as never,
            syncClientEndDateUsecase as never,
            eventBus as never,
            notificationService as never,
            eformsignApiClient as never,
            credentialBoundary as never,
            clientRepository as never,
            eformsignDocRepository as never,
            employeeScheduleRepository as never,
            employeeRepository as never,
            mirrorUnassignedDocUsecase as never,
            undefined,
            serviceRecordLifecycle as never,
            documentSnapshotService as never,
            documentMirrorService as never,
            completedMirrorReconciler as never,
        );

        await expect(serviceWithReconciler.processWebhook(createDocumentPayload(), {
            mirroredDocument,
        })).resolves.toBeUndefined();

        expect(eformsignDocRepository.claimCompletionStatus).toHaveBeenCalledWith(
            branchId,
            expect.objectContaining({ documentId }),
        );
        expect(linkDocumentUsecase.execute).toHaveBeenCalledWith(branchId, documentId);
        expect(completedMirrorReconciler.syncLinkedContract).toHaveBeenCalledWith({
            branchId,
            documentId,
            detail: mirroredDocument,
        });
        expect(syncClientEndDateUsecase.executeFromDocument).not.toHaveBeenCalled();
        expect(eventBus.emit).toHaveBeenCalledWith({
            branchId,
            documentId,
            reason: "doc:doc_complete",
        });
    });

    it("uses the lifecycle service for a completed service-record snapshot without contract end-date sync", async () => {
        const previousTemplateId = process.env["EFORMSIGN_SERVICE_RECORD_TEMPLATE_ID"];
        process.env["EFORMSIGN_SERVICE_RECORD_TEMPLATE_ID"] = "service-record-template";
        const payload = createDocumentPayload();
        if (!payload.document) throw new Error("document payload is required");
        payload.document.template_id = "service-record-template";

        try {
            await expect(service.processWebhook(payload)).resolves.toBeUndefined();
        } finally {
            if (previousTemplateId === undefined) {
                delete process.env["EFORMSIGN_SERVICE_RECORD_TEMPLATE_ID"];
            } else {
                process.env["EFORMSIGN_SERVICE_RECORD_TEMPLATE_ID"] = previousTemplateId;
            }
        }

        expect(serviceRecordLifecycle.completeServiceRecordSnapshotIfReady)
            .toHaveBeenCalledWith({ branchId, documentId });
        expect(syncClientEndDateUsecase.execute).not.toHaveBeenCalled();
        expect(syncClientEndDateUsecase.executeFromDocument).not.toHaveBeenCalled();
    });

    it("reconciles a service-record lifecycle after the deferred status claim", async () => {
        const previousTemplateId = process.env["EFORMSIGN_SERVICE_RECORD_TEMPLATE_ID"];
        process.env["EFORMSIGN_SERVICE_RECORD_TEMPLATE_ID"] = "service-record-template";
        service = createServiceWithCompletedMirrorReconciler();
        const payload = createDocumentPayload();
        if (!payload.document) throw new Error("document payload is required");
        payload.document.template_id = "service-record-template";

        try {
            await expect(service.processWebhook(payload, {
                deferCompletionEvent: true,
                deferCompletionEffects: true,
            })).resolves.toEqual({
                completionClaim: "claimed",
                completionBranchId: branchId,
            });
        } finally {
            if (previousTemplateId === undefined) {
                delete process.env["EFORMSIGN_SERVICE_RECORD_TEMPLATE_ID"];
            } else {
                process.env["EFORMSIGN_SERVICE_RECORD_TEMPLATE_ID"] = previousTemplateId;
            }
        }

        expect(eformsignDocRepository.claimCompletionStatus).toHaveBeenCalledWith(
            branchId,
            expect.objectContaining({ documentId }),
        );
        expect(completedMirrorReconciler.reconcileServiceRecordSnapshotCompletion)
            .toHaveBeenCalledWith(documentId);
        expect(eformsignDocRepository.claimCompletionStatus.mock.invocationCallOrder[0]!)
            .toBeLessThan(
                completedMirrorReconciler.reconcileServiceRecordSnapshotCompletion
                    .mock.invocationCallOrder[0]!,
            );
        expect(serviceRecordLifecycle.completeServiceRecordSnapshotIfReady).not.toHaveBeenCalled();
        expect(linkDocumentUsecase.execute).not.toHaveBeenCalled();
        expect(eventBus.emit).not.toHaveBeenCalled();
    });

    it("retries deferred service-record lifecycle reconciliation after a duplicate completion claim", async () => {
        const previousTemplateId = process.env["EFORMSIGN_SERVICE_RECORD_TEMPLATE_ID"];
        process.env["EFORMSIGN_SERVICE_RECORD_TEMPLATE_ID"] = "service-record-template";
        service = createServiceWithCompletedMirrorReconciler();
        eformsignDocRepository.claimCompletionStatus
            .mockResolvedValueOnce("claimed")
            .mockResolvedValueOnce("duplicate");
        completedMirrorReconciler.reconcileServiceRecordSnapshotCompletion
            .mockResolvedValueOnce(null)
            .mockResolvedValueOnce(true);
        const payload = createDocumentPayload();
        if (!payload.document) throw new Error("document payload is required");
        payload.document.template_id = "service-record-template";

        try {
            await expect(service.processWebhook(payload, {
                deferCompletionEvent: true,
                deferCompletionEffects: true,
            })).rejects.toThrow(/mirror is not ready/i);
            await expect(service.processWebhook(payload, {
                deferCompletionEvent: true,
                deferCompletionEffects: true,
            })).resolves.toEqual({
                completionClaim: "duplicate",
                completionBranchId: branchId,
                duplicateServiceRecordLifecycleChanged: true,
            });
        } finally {
            if (previousTemplateId === undefined) {
                delete process.env["EFORMSIGN_SERVICE_RECORD_TEMPLATE_ID"];
            } else {
                process.env["EFORMSIGN_SERVICE_RECORD_TEMPLATE_ID"] = previousTemplateId;
            }
        }

        expect(completedMirrorReconciler.reconcileServiceRecordSnapshotCompletion)
            .toHaveBeenCalledTimes(2);
        expect(completedMirrorReconciler.reconcileServiceRecordSnapshotCompletion)
            .toHaveBeenNthCalledWith(1, documentId);
        expect(completedMirrorReconciler.reconcileServiceRecordSnapshotCompletion)
            .toHaveBeenNthCalledWith(2, documentId);
        expect(eventBus.emit).not.toHaveBeenCalled();
    });

    it("does not report a duplicate service-record retry as changed when its ready lifecycle is idempotent", async () => {
        const previousTemplateId = process.env["EFORMSIGN_SERVICE_RECORD_TEMPLATE_ID"];
        process.env["EFORMSIGN_SERVICE_RECORD_TEMPLATE_ID"] = "service-record-template";
        service = createServiceWithCompletedMirrorReconciler();
        eformsignDocRepository.claimCompletionStatus.mockResolvedValue("duplicate");
        completedMirrorReconciler.reconcileServiceRecordSnapshotCompletion.mockResolvedValue(false);
        const payload = createDocumentPayload();
        if (!payload.document) throw new Error("document payload is required");
        payload.document.template_id = "service-record-template";

        try {
            await expect(service.processWebhook(payload, {
                deferCompletionEvent: true,
                deferCompletionEffects: true,
            })).resolves.toEqual({
                completionClaim: "duplicate",
                completionBranchId: branchId,
            });
        } finally {
            if (previousTemplateId === undefined) {
                delete process.env["EFORMSIGN_SERVICE_RECORD_TEMPLATE_ID"];
            } else {
                process.env["EFORMSIGN_SERVICE_RECORD_TEMPLATE_ID"] = previousTemplateId;
            }
        }

        expect(completedMirrorReconciler.reconcileServiceRecordSnapshotCompletion)
            .toHaveBeenCalledWith(documentId);
        expect(eventBus.emit).not.toHaveBeenCalled();
    });

    it("should resolve the branch from the local document before processing webhook status", async () => {
        await expect(service.processWebhook(createDocumentPayload())).resolves.toBeUndefined();

        expect(eformsignDocRepository.findByDocumentIdUnscoped).toHaveBeenCalledWith(documentId);
        expect(eformsignDocRepository.claimCompletionStatus).toHaveBeenCalledWith(
            branchId,
            expect.objectContaining({
                documentId,
                documentName: "산모신생아건강관리서비스 계약서",
            }),
        );
    });

    it("mirrors a missing document without running branch-owned side effects", async () => {
        eformsignDocRepository.findByDocumentIdUnscoped.mockResolvedValue(null);

        await expect(service.processWebhook(createDocumentPayload())).resolves.toBeUndefined();

        expect(mirrorUnassignedDocUsecase.execute).toHaveBeenCalledWith(
            documentId,
            expect.objectContaining({ branchId: "__system__:webhook", source: "worker" }),
        );
        expect(eformsignDocRepository.claimCompletionStatus).not.toHaveBeenCalled();
        expect(updateStatusUsecase.executeWithOutcome).not.toHaveBeenCalled();
        expect(linkDocumentUsecase.execute).not.toHaveBeenCalled();
        expect(syncClientEndDateUsecase.execute).not.toHaveBeenCalled();
        expect(notificationService.sendToBranchUsers).not.toHaveBeenCalled();
        expect(eventBus.emit).not.toHaveBeenCalled();
    });

    it("retries through the branch-owned path when mirroring loses an ownership race", async () => {
        eformsignDocRepository.findByDocumentIdUnscoped
            .mockResolvedValueOnce(null)
            .mockResolvedValueOnce({
                document: createDocEntity(),
                branchId,
            });
        mirrorUnassignedDocUsecase.execute.mockRejectedValue(
            new EformsignDocOwnershipConflictError(documentId),
        );

        await expect(service.processWebhook(createDocumentPayload())).resolves.toBeUndefined();

        expect(eformsignDocRepository.findByDocumentIdUnscoped).toHaveBeenCalledTimes(2);
        expect(eformsignDocRepository.claimCompletionStatus).toHaveBeenCalledWith(
            branchId,
            expect.objectContaining({ documentId, statusType: "050" }),
        );
        expect(linkDocumentUsecase.execute).toHaveBeenCalledWith(branchId, documentId);
        expect(syncClientEndDateUsecase.execute).toHaveBeenCalled();
        expect(eventBus.emit).toHaveBeenCalledWith({
            branchId,
            documentId,
            reason: "doc:doc_complete",
        });
    });

    it("updates an existing unassigned document from webhook data without an external API call", async () => {
        eformsignDocRepository.findByDocumentIdUnscoped.mockResolvedValue({
            document: createDocEntity({ clientId: null, documentName: "기존 문서명" }),
            branchId: null,
        });
        const payload = createDocumentPayload();
        if (!payload.document) {
            throw new Error("document payload is required");
        }
        payload.document.status = "doc_request_participant";

        await expect(service.processWebhook(payload)).resolves.toBeUndefined();

        expect(mirrorUnassignedDocUsecase.execute).not.toHaveBeenCalled();
        expect(eformsignApiClient.getAccessToken).not.toHaveBeenCalled();
        expect(eformsignApiClient.getDocument).not.toHaveBeenCalled();
        expect(eformsignDocRepository.upsertUnassignedByDocumentId).toHaveBeenCalledWith(
            expect.objectContaining({
                documentId,
                statusType: "060",
                documentName: "산모신생아건강관리서비스 계약서",
                templateName: "template",
                templateId: "template-1",
            }),
            { updateCreatedDate: false },
        );
        expect(updateStatusUsecase.executeWithOutcome).not.toHaveBeenCalled();
        expect(linkDocumentUsecase.execute).not.toHaveBeenCalled();
        expect(syncClientEndDateUsecase.execute).not.toHaveBeenCalled();
        expect(notificationService.sendToBranchUsers).not.toHaveBeenCalled();
        expect(eventBus.emit).not.toHaveBeenCalled();
        expect(documentSnapshotService.bumpCompanyEpoch).toHaveBeenCalledTimes(1);
    });

    it("updates an existing unassigned document from ready_document_pdf without branch side effects", async () => {
        const existing = createDocEntity({ clientId: null });
        eformsignDocRepository.findByDocumentIdUnscoped.mockResolvedValue({
            document: existing,
            branchId: null,
        });

        await expect(service.processWebhook(createReadyPdfPayload())).resolves.toBeUndefined();

        expect(eformsignDocRepository.upsertUnassignedByDocumentId).toHaveBeenCalledWith(
            expect.objectContaining({
                documentId,
                statusType: "050",
                documentName: "산모신생아건강관리서비스 계약서",
                templateId: "template-1",
                updatedDate: existing.updatedDate,
            }),
            { updateCreatedDate: false },
        );
        expect(eformsignDocRepository.claimCompletionStatus).not.toHaveBeenCalled();
        expect(linkDocumentUsecase.execute).not.toHaveBeenCalled();
        expect(syncClientEndDateUsecase.execute).not.toHaveBeenCalled();
        expect(notificationService.sendToBranchUsers).not.toHaveBeenCalled();
        expect(eventBus.emit).not.toHaveBeenCalled();
    });

    it("ignores a stale non-terminal webhook for a terminal unassigned document", async () => {
        eformsignDocRepository.findByDocumentIdUnscoped.mockResolvedValue({
            document: createDocEntity({ clientId: null, statusType: "050" }),
            branchId: null,
        });
        const payload = createDocumentPayload();
        payload.event_type = "document_action";
        if (!payload.document) {
            throw new Error("document payload is required");
        }
        payload.document.action = "doc_open_participant";

        await expect(service.processWebhook(payload)).resolves.toBeUndefined();

        expect(eformsignDocRepository.upsertUnassignedByDocumentId).not.toHaveBeenCalled();
    });

    it("advances an unassigned 062 document to a later 070 reviewer request", async () => {
        eformsignDocRepository.findByDocumentIdUnscoped.mockResolvedValue({
            document: createDocEntity({ clientId: null, statusType: "062" }),
            branchId: null,
        });
        const payload = createDocumentPayload();
        if (!payload.document) {
            throw new Error("document payload is required");
        }
        payload.document.status = "doc_request_reviewer";
        payload.document.updated_date = new Date("2026-05-03T00:00:00.000Z").getTime();

        await expect(service.processWebhook(payload)).resolves.toBeUndefined();

        expect(eformsignDocRepository.upsertUnassignedByDocumentId).toHaveBeenCalledWith(
            expect.objectContaining({
                statusType: "070",
                expired: false,
            }),
            { updateCreatedDate: false },
        );
    });

    it("advances an unassigned 071 rejection to a later 070 reviewer re-request", async () => {
        // 071 sits in the rejected family, so treating it as terminal froze the mirror
        // there permanently — a re-request could never land, and nothing re-mirrors a
        // document that already has a local row.
        eformsignDocRepository.findByDocumentIdUnscoped.mockResolvedValue({
            document: createDocEntity({ clientId: null, statusType: "071" }),
            branchId: null,
        });
        const payload = createDocumentPayload();
        if (!payload.document) {
            throw new Error("document payload is required");
        }
        payload.document.status = "doc_request_reviewer";
        payload.document.updated_date = new Date("2026-05-03T00:00:00.000Z").getTime();

        await expect(service.processWebhook(payload)).resolves.toBeUndefined();

        expect(eformsignDocRepository.upsertUnassignedByDocumentId).toHaveBeenCalledWith(
            expect.objectContaining({ statusType: "070" }),
            { updateCreatedDate: false },
        );
    });

    it("lets a reviewer rejection land on an unassigned 062 acceptance", async () => {
        // A reviewer rejects what a participant accepted. If the 070 in between was
        // missed — the exact gap the backfill exists to close — 071 is the next state we
        // ever observe, and refusing it freezes the row at 062 for good.
        eformsignDocRepository.findByDocumentIdUnscoped.mockResolvedValue({
            document: createDocEntity({ clientId: null, statusType: "062" }),
            branchId: null,
        });
        const payload = createDocumentPayload();
        if (!payload.document) {
            throw new Error("document payload is required");
        }
        payload.document.status = "doc_reject_reviewer";
        payload.document.updated_date = new Date("2026-05-03T00:00:00.000Z").getTime();

        await expect(service.processWebhook(payload)).resolves.toBeUndefined();

        expect(eformsignDocRepository.upsertUnassignedByDocumentId).toHaveBeenCalledWith(
            expect.objectContaining({ statusType: "071", statusDetail: "검토 반려" }),
            { updateCreatedDate: false },
        );
    });

    it("still refuses a backward transition after an unassigned 071 rejection", async () => {
        eformsignDocRepository.findByDocumentIdUnscoped.mockResolvedValue({
            document: createDocEntity({ clientId: null, statusType: "071" }),
            branchId: null,
        });
        const payload = createDocumentPayload();
        if (!payload.document) {
            throw new Error("document payload is required");
        }
        payload.document.status = "doc_request_participant";
        payload.document.updated_date = new Date("2026-05-03T00:00:00.000Z").getTime();

        await expect(service.processWebhook(payload)).resolves.toBeUndefined();

        expect(eformsignDocRepository.upsertUnassignedByDocumentId).not.toHaveBeenCalled();
    });

    it("advances an unassigned 062 document to a later 072 reviewer completion", async () => {
        eformsignDocRepository.findByDocumentIdUnscoped.mockResolvedValue({
            document: createDocEntity({ clientId: null, statusType: "062" }),
            branchId: null,
        });
        const payload = createDocumentPayload();
        if (!payload.document) {
            throw new Error("document payload is required");
        }
        payload.document.status = "doc_accept_reviewer";
        payload.document.updated_date = new Date("2026-05-03T00:00:00.000Z").getTime();

        await expect(service.processWebhook(payload)).resolves.toBeUndefined();

        expect(eformsignDocRepository.upsertUnassignedByDocumentId).toHaveBeenCalledWith(
            expect.objectContaining({
                statusType: "072",
                expired: false,
            }),
            { updateCreatedDate: false },
        );
    });

    it("does not regress an unassigned 062 document to 020 from document_action", async () => {
        eformsignDocRepository.findByDocumentIdUnscoped.mockResolvedValue({
            document: createDocEntity({ clientId: null, statusType: "062" }),
            branchId: null,
        });
        const payload = createDocumentPayload();
        payload.event_type = "document_action";
        if (!payload.document) {
            throw new Error("document payload is required");
        }
        payload.document.action = "doc_open_participant";
        payload.document.updated_date = new Date("2026-05-03T00:00:00.000Z").getTime();

        await expect(service.processWebhook(payload)).resolves.toBeUndefined();

        expect(eformsignDocRepository.upsertUnassignedByDocumentId).not.toHaveBeenCalled();
    });

    it("keeps rejected unassigned documents terminal when a later non-terminal status arrives", async () => {
        eformsignDocRepository.findByDocumentIdUnscoped.mockResolvedValue({
            document: createDocEntity({ clientId: null, statusType: "080" }),
            branchId: null,
        });
        const payload = createDocumentPayload();
        if (!payload.document) {
            throw new Error("document payload is required");
        }
        payload.document.status = "doc_request_reviewer";

        await expect(service.processWebhook(payload)).resolves.toBeUndefined();

        expect(eformsignDocRepository.upsertUnassignedByDocumentId).not.toHaveBeenCalled();
    });

    it("ignores an unassigned webhook older than the stored updatedDate", async () => {
        eformsignDocRepository.findByDocumentIdUnscoped.mockResolvedValue({
            document: createDocEntity({
                clientId: null,
                updatedDate: new Date("2026-05-04T00:00:00.000Z"),
            }),
            branchId: null,
        });
        const payload = createDocumentPayload();
        if (!payload.document) {
            throw new Error("document payload is required");
        }
        payload.document.status = "doc_request_reviewer";
        payload.document.updated_date = new Date("2026-05-03T00:00:00.000Z").getTime();

        await expect(service.processWebhook(payload)).resolves.toBeUndefined();

        expect(eformsignDocRepository.upsertUnassignedByDocumentId).not.toHaveBeenCalled();
    });

    it("stores an unassigned expiration webhook as expired status 080", async () => {
        eformsignDocRepository.findByDocumentIdUnscoped.mockResolvedValue({
            document: createDocEntity({ clientId: null }),
            branchId: null,
        });
        const payload = createDocumentPayload();
        if (!payload.document) {
            throw new Error("document payload is required");
        }
        payload.document.status = "doc_expired";

        await expect(service.processWebhook(payload)).resolves.toBeUndefined();

        expect(eformsignDocRepository.upsertUnassignedByDocumentId).toHaveBeenCalledWith(
            expect.objectContaining({
                statusType: "080",
                statusDetail: "만료",
                expired: true,
            }),
            { updateCreatedDate: false },
        );
    });

    it("stores a branch-owned expiration without running completion or review side effects", async () => {
        const payload = createDocumentPayload();
        if (!payload.document) {
            throw new Error("document payload is required");
        }
        payload.document.status = "doc_expired";

        await expect(service.processWebhook(payload)).resolves.toBeUndefined();

        expect(updateStatusUsecase.executeWithOutcome).toHaveBeenCalledWith(
            branchId,
            expect.objectContaining({
                documentId,
                statusType: "080",
                statusDetail: "만료",
                expired: true,
            }),
        );
        expect(eformsignDocRepository.claimCompletionStatus).not.toHaveBeenCalled();
        expect(linkDocumentUsecase.execute).toHaveBeenCalledWith(branchId, documentId);
        expect(syncClientEndDateUsecase.execute).not.toHaveBeenCalled();
        expect(notificationService.sendToBranchUsers).not.toHaveBeenCalled();
        expect(eventBus.emit).toHaveBeenCalledWith({
            branchId,
            documentId,
            reason: "doc:doc_expired",
        });
    });

    it("does not link, notify, or emit when a stale branch-owned status projection loses its CAS", async () => {
        updateStatusUsecase.executeWithOutcome.mockResolvedValue({
            document: createDocEntity({ statusType: "071" }),
            applied: false,
        });
        const payload = createDocumentPayload();
        if (!payload.document) {
            throw new Error("document payload is required");
        }
        payload.document.status = "doc_expired";

        await expect(service.processWebhook(payload)).resolves.toBeUndefined();

        expect(updateStatusUsecase.executeWithOutcome).toHaveBeenCalledWith(
            branchId,
            expect.objectContaining({
                sourceUpdatedDate: new Date(payload.document.updated_date),
            }),
        );
        expect(linkDocumentUsecase.execute).not.toHaveBeenCalled();
        expect(notificationService.sendToBranchUsers).not.toHaveBeenCalled();
        expect(eventBus.emit).not.toHaveBeenCalled();
    });

    it("does not fire stale side effects when the newer mirror has the same status", async () => {
        const payload = createDocumentPayload();
        if (!payload.document) {
            throw new Error("document payload is required");
        }
        payload.document.status = "doc_expired";
        updateStatusUsecase.executeWithOutcome.mockResolvedValue({
            document: createDocEntity({
                statusType: "080",
                updatedDate: new Date(payload.document.updated_date + 1),
            }),
            applied: false,
        });

        await expect(service.processWebhook(payload)).resolves.toBeUndefined();

        expect(linkDocumentUsecase.execute).not.toHaveBeenCalled();
        expect(notificationService.sendToBranchUsers).not.toHaveBeenCalled();
        expect(eventBus.emit).not.toHaveBeenCalled();
    });

    it("does not replay side effects when the same-generation status CAS is a no-op", async () => {
        const payload = createDocumentPayload();
        if (!payload.document) {
            throw new Error("document payload is required");
        }
        payload.document.status = "doc_expired";
        updateStatusUsecase.executeWithOutcome.mockResolvedValue({
            document: createDocEntity({
                statusType: "080",
                updatedDate: new Date(payload.document.updated_date),
            }),
            applied: false,
        });

        await expect(service.processWebhook(payload)).resolves.toBeUndefined();

        expect(linkDocumentUsecase.execute).not.toHaveBeenCalled();
        expect(notificationService.sendToBranchUsers).not.toHaveBeenCalled();
        expect(eventBus.emit).not.toHaveBeenCalled();
    });

    it("does not claim, link, or emit a stale completion webhook", async () => {
        eformsignDocRepository.claimCompletionStatus.mockResolvedValue("stale");
        const payload = createDocumentPayload();

        await expect(service.processWebhook(payload)).resolves.toBeUndefined();

        expect(eformsignDocRepository.claimCompletionStatus).toHaveBeenCalledWith(
            branchId,
            expect.objectContaining({
                sourceUpdatedDate: new Date(payload.document!.updated_date),
            }),
        );
        expect(linkDocumentUsecase.execute).not.toHaveBeenCalled();
        expect(eventBus.emit).not.toHaveBeenCalled();
    });

    it("does not project or emit a timestamp-less PDF status that conflicts with the ready mirror", async () => {
        const payload = createReadyPdfPayload();
        if (!payload.ready_document_pdf) {
            throw new Error("ready PDF payload is required");
        }
        payload.ready_document_pdf.document_status = "doc_expired";

        await expect(service.processWebhook(payload, {
            mirroredDocument: {
                current_status: {
                    status_type: "071",
                    step_type: "06",
                    step_index: "1",
                    step_name: "검토 반려",
                    step_recipients: [],
                    step_group: 1,
                },
            } as never,
        })).resolves.toBeUndefined();

        expect(updateStatusUsecase.executeWithOutcome).not.toHaveBeenCalled();
        expect(linkDocumentUsecase.execute).not.toHaveBeenCalled();
        expect(eventBus.emit).not.toHaveBeenCalled();
    });

    it("fences a non-completion PDF status to the refreshed mirror generation", async () => {
        const sourceUpdatedDate = Date.now();
        const payload = createReadyPdfPayload();
        if (!payload.ready_document_pdf) {
            throw new Error("ready PDF payload is required");
        }
        payload.ready_document_pdf.document_status = "doc_expired";
        updateStatusUsecase.executeWithOutcome.mockResolvedValueOnce({
            document: createDocEntity({
                statusType: "080",
                updatedDate: new Date(sourceUpdatedDate),
            }),
            applied: false,
        });

        await expect(service.processWebhook(payload, {
            mirroredDocument: {
                updated_date: sourceUpdatedDate,
                current_status: {
                    status_type: "080",
                    step_type: "06",
                    step_index: "1",
                    step_name: "만료",
                    step_recipients: [],
                    step_group: 1,
                },
            } as never,
        })).resolves.toBeUndefined();

        expect(updateStatusUsecase.executeWithOutcome).toHaveBeenCalledWith(
            branchId,
            expect.objectContaining({
                documentId,
                statusType: "080",
                sourceUpdatedDate: new Date(sourceUpdatedDate),
            }),
        );
        expect(linkDocumentUsecase.execute).not.toHaveBeenCalled();
        expect(eventBus.emit).not.toHaveBeenCalled();
    });

    it("fences a completed-PDF claim to the refreshed mirror generation", async () => {
        const sourceUpdatedDate = Date.now();
        const payload = createReadyPdfPayload();

        await expect(service.processWebhook(payload, {
            mirroredDocument: {
                updated_date: sourceUpdatedDate,
                current_status: {
                    status_type: "050",
                    step_type: "06",
                    step_index: "3",
                    step_name: "완료",
                    step_recipients: [],
                    step_group: 1,
                },
            } as never,
            deferCompletionEvent: true,
            deferCompletionEffects: true,
        })).resolves.toEqual({
            completionClaim: "claimed",
            completionBranchId: branchId,
        });

        expect(eformsignDocRepository.claimCompletionStatus).toHaveBeenCalledWith(
            branchId,
            expect.objectContaining({
                sourceUpdatedDate: new Date(sourceUpdatedDate),
            }),
        );
    });

    it("keeps a current document_action at the refreshed mirror's canonical 064 status", async () => {
        const payload = createDocumentPayload();
        payload.event_type = "document_action";
        if (!payload.document) {
            throw new Error("document payload is required");
        }
        payload.document.action = "doc_open_participant";

        await expect(service.processWebhook(payload, {
            mirroredDocument: {
                current_status: {
                    status_type: "064",
                    step_type: "05",
                    step_index: "3",
                    step_name: "이용자 열람",
                    step_recipients: [],
                    step_group: 1,
                },
            } as never,
        })).resolves.toBeUndefined();

        expect(updateStatusUsecase.executeWithOutcome).toHaveBeenCalledWith(
            branchId,
            expect.objectContaining({ statusType: "064" }),
        );
        expect(linkDocumentUsecase.execute).toHaveBeenCalledWith(branchId, documentId);
        expect(eventBus.emit).toHaveBeenCalledWith({
            branchId,
            documentId,
            reason: "action:doc_open_participant",
        });
    });

    it("allows a terminal to terminal transition for an unassigned document", async () => {
        eformsignDocRepository.findByDocumentIdUnscoped.mockResolvedValue({
            document: createDocEntity({ clientId: null, statusType: "050" }),
            branchId: null,
        });
        const payload = createDocumentPayload();
        if (!payload.document) {
            throw new Error("document payload is required");
        }
        payload.document.status = "doc_decline";

        await expect(service.processWebhook(payload)).resolves.toBeUndefined();

        expect(eformsignDocRepository.upsertUnassignedByDocumentId).toHaveBeenCalledWith(
            expect.objectContaining({ statusType: "080" }),
            { updateCreatedDate: false },
        );
    });

    it("swallows unassigned status update failures", async () => {
        eformsignDocRepository.findByDocumentIdUnscoped.mockResolvedValue({
            document: createDocEntity({ clientId: null }),
            branchId: null,
        });
        eformsignDocRepository.upsertUnassignedByDocumentId.mockRejectedValue(
            new Error("write failed"),
        );

        await expect(service.processWebhook(createDocumentPayload())).resolves.toBeUndefined();

        expect(eformsignDocRepository.upsertUnassignedByDocumentId).toHaveBeenCalled();
        expect(eformsignDocRepository.claimCompletionStatus).not.toHaveBeenCalled();
    });

    it("falls back to the branch-only lookup when a local row cannot be mapped", async () => {
        eformsignDocRepository.findByDocumentIdUnscoped.mockRejectedValue(
            new EformsignDocMappingError(documentId, new Error("invalid row")),
        );
        eformsignDocRepository.findBranchIdByDocumentId.mockResolvedValue(branchId);

        await expect(service.processWebhook(createDocumentPayload())).resolves.toBeUndefined();

        expect(eformsignDocRepository.findBranchIdByDocumentId).toHaveBeenCalledWith(documentId);
        expect(eformsignDocRepository.claimCompletionStatus).toHaveBeenCalledWith(
            branchId,
            expect.objectContaining({ documentId }),
        );
    });

    it("sanitizes errors from the branch-only fallback lookup", async () => {
        const warnSpy = jest
            .spyOn(Logger.prototype, "warn")
            .mockImplementation(() => undefined);
        eformsignDocRepository.findByDocumentIdUnscoped.mockRejectedValue(
            new EformsignDocMappingError(
                documentId,
                new Error("Bearer mapping-token 010-1111-2222"),
            ),
        );
        eformsignDocRepository.findBranchIdByDocumentId.mockRejectedValue(
            new Error("access_token=fallback-token 010-3333-4444"),
        );

        try {
            await expect(service.processWebhook(createDocumentPayload())).resolves.toBeUndefined();

            const logged = warnSpy.mock.calls.flat().join(" ");
            expect(logged).toContain("Bearer [REDACTED]");
            expect(logged).toContain("access_token=[REDACTED]");
            expect(logged).toContain("[REDACTED_PHONE]");
            expect(logged).not.toContain("mapping-token");
            expect(logged).not.toContain("fallback-token");
            expect(logged).not.toContain("010-1111-2222");
            expect(logged).not.toContain("010-3333-4444");
        } finally {
            warnSpy.mockRestore();
        }
    });

    it("omits an unassigned document name update when webhook document_title is blank", async () => {
        eformsignDocRepository.findByDocumentIdUnscoped.mockResolvedValue({
            document: createDocEntity({ clientId: null, documentName: "기존 문서명" }),
            branchId: null,
        });
        const payload = createDocumentPayload();
        if (!payload.document) {
            throw new Error("document payload is required");
        }
        payload.document.document_title = "   ";

        await expect(service.processWebhook(payload)).resolves.toBeUndefined();

        expect(eformsignDocRepository.upsertUnassignedByDocumentId).toHaveBeenCalledWith(
            expect.objectContaining({ documentName: null }),
            { updateCreatedDate: false },
        );
    });

    it("updates an unassigned document templateName without changing other list display fields", async () => {
        eformsignDocRepository.findByDocumentIdUnscoped.mockResolvedValue({
            document: createDocEntity({ clientId: null }),
            branchId: null,
        });

        await expect(service.processWebhook(createDocumentPayload())).resolves.toBeUndefined();

        expect(eformsignDocRepository.upsertUnassignedByDocumentId).toHaveBeenCalledWith(
            expect.objectContaining({
                templateName: "template",
                customerName: "기존 고객명",
                creatorName: "기존 생성자",
                lastEditorName: "기존 편집자",
                stepRecipientTypes: ["05", "06"],
            }),
            { updateCreatedDate: false },
        );
    });

    it("keeps an unassigned document templateName when webhook template_name is blank", async () => {
        eformsignDocRepository.findByDocumentIdUnscoped.mockResolvedValue({
            document: createDocEntity({ clientId: null }),
            branchId: null,
        });
        const payload = createDocumentPayload();
        if (!payload.document) {
            throw new Error("document payload is required");
        }
        payload.document.template_name = "   ";

        await expect(service.processWebhook(payload)).resolves.toBeUndefined();

        expect(eformsignDocRepository.upsertUnassignedByDocumentId).toHaveBeenCalledWith(
            expect.objectContaining({ templateName: null }),
            { updateCreatedDate: false },
        );
    });

    it("swallows external API failures while mirroring a missing document", async () => {
        eformsignDocRepository.findByDocumentIdUnscoped.mockResolvedValue(null);
        mirrorUnassignedDocUsecase.execute.mockRejectedValue(new Error("rate limited"));

        await expect(service.processWebhook(createDocumentPayload())).resolves.toBeUndefined();

        expect(mirrorUnassignedDocUsecase.execute).toHaveBeenCalledWith(
            documentId,
            expect.objectContaining({ branchId: "__system__:webhook", source: "worker" }),
        );
        expect(updateStatusUsecase.executeWithOutcome).not.toHaveBeenCalled();
        expect(linkDocumentUsecase.execute).not.toHaveBeenCalled();
        expect(syncClientEndDateUsecase.execute).not.toHaveBeenCalled();
        expect(eventBus.emit).not.toHaveBeenCalled();
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

    it("should notify branch users when a reviewer request reaches the review stage", async () => {
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
        payload.document.status = "doc_request_reviewer";

        await expect(service.processWebhook(payload)).resolves.toBeUndefined();

        expect(updateStatusUsecase.executeWithOutcome).toHaveBeenCalledWith(
            branchId,
            expect.objectContaining({ statusType: "070", statusDetail: "검토 요청" }),
        );
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

    /**
     * The production shape: eformsign advanced the document to the reviewer step,
     * the controller mirrored that detail at 070, and the status webhook follows.
     * While mapStatus collapsed every reviewer status to 060, isCurrentMirrorStatus
     * discarded this update as stale against the 070 mirror, so a branch-owned
     * projection sat at the participant stage for the entire review and only the
     * 6-hourly reconcile sweep ever corrected it.
     */
    it("projects the reviewer request when the mirror has already advanced to 070", async () => {
        const mirroredDocument = {
            current_status: {
                status_type: "070",
                step_type: "06",
                step_name: "제공기관 검토",
                step_recipients: [{ recipient_type: "01" }],
            },
        };
        const payload = createDocumentPayload();
        if (!payload.document) {
            throw new Error("document payload is required");
        }
        payload.document.status = "doc_request_reviewer";

        await expect(
            service.processWebhook(payload, { mirroredDocument } as never),
        ).resolves.toBeUndefined();

        expect(updateStatusUsecase.executeWithOutcome).toHaveBeenCalledWith(
            branchId,
            expect.objectContaining({ statusType: "070", statusDetail: "검토 요청" }),
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

        expect(updateStatusUsecase.executeWithOutcome).toHaveBeenCalledWith(
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
            findByDocumentIdUnscoped: jest.fn().mockImplementation(() => Promise.resolve({
                document: storedDoc,
                branchId,
            })),
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
            updateIfSourceNewer: jest.fn().mockImplementation(
                async (_branchid, doc: EformsignDocEntity) => {
                    const storedId = storedDoc.id;
                    if (storedId === undefined) {
                        throw new Error("stored document id is required");
                    }
                    storedDoc = EformsignDocMapper.toDomain({
                        id: storedId,
                        ...EformsignDocMapper.toPrismaCreate(storedDoc),
                        ...EformsignDocMapper.toPrismaUpdate(doc),
                    });
                    return { document: storedDoc, applied: true };
                },
            ),
            linkClientIfActive: jest.fn().mockImplementation(
                async (_branchid: string, targetDocumentId: string, clientId: number) => {
                    const storedId = storedDoc.id;
                    if (
                        storedId === undefined
                        || storedDoc.documentId !== targetDocumentId
                    ) {
                        return false;
                    }
                    storedDoc = EformsignDocMapper.toDomain({
                        id: storedId,
                        ...EformsignDocMapper.toPrismaCreate(storedDoc),
                        clientId,
                    });
                    return true;
                },
            ),
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
            credentialBoundary as never,
            statefulClientRepository as never,
            statefulDocRepository as never,
            employeeScheduleRepository as never,
            employeeRepository as never,
            mirrorUnassignedDocUsecase as never,
        );
        const payload = createDocumentPayload();
        if (!payload.document) {
            throw new Error("document payload is required");
        }
        payload.document.status = "doc_request_participant";

        await statefulService.processWebhook(payload);

        expect(statefulDocRepository.updateIfSourceNewer).toHaveBeenCalledTimes(1);
        expect(statefulDocRepository.linkClientIfActive).toHaveBeenCalledWith(
            branchId,
            documentId,
            9,
        );
        expect(statefulDocRepository.update).not.toHaveBeenCalled();
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

    it("defers a durable completion update until the controller confirms mirror sync, including duplicate retry", async () => {
        eformsignDocRepository.claimCompletionStatus
            .mockResolvedValueOnce("claimed")
            .mockResolvedValueOnce("duplicate");
        const payload = createDocumentPayload();

        await service.processWebhook(payload, { deferCompletionEvent: true });
        await service.processWebhook(payload, { deferCompletionEvent: true });

        expect(linkDocumentUsecase.execute).toHaveBeenCalledTimes(1);
        expect(eventBus.emit).not.toHaveBeenCalled();

        await service.publishCompletionEvent(payload);

        expect(eventBus.emit).toHaveBeenCalledWith({
            branchId,
            documentId,
            reason: "doc:doc_complete",
        });
    });

    it("rechecks mirror readiness immediately before publishing completion", async () => {
        const payload = createDocumentPayload();
        documentMirrorService.isDocumentReady.mockResolvedValueOnce(false);

        await expect(service.publishCompletionEvent(payload)).rejects.toThrow(
            /mirror is not ready/i,
        );

        expect(documentMirrorService.isDocumentReady).toHaveBeenCalledWith(documentId);
        expect(eventBus.emit).not.toHaveBeenCalled();
    });

    it("publishes from the controller-validated mirror without a second readiness lookup", async () => {
        const payload = createDocumentPayload();
        const mirroredDocument = {
            current_status: { status_type: "050" },
        } as never;
        eformsignDocRepository.findByDocumentIdUnscoped.mockClear();
        documentMirrorService.isDocumentReady.mockClear();
        documentMirrorService.getStoredDetail.mockClear();

        await expect(service.publishCompletionEvent(payload, {
            branchId,
            mirroredDocument,
        })).resolves.toBeUndefined();

        expect(eformsignDocRepository.findByDocumentIdUnscoped).not.toHaveBeenCalled();
        expect(documentMirrorService.isDocumentReady).not.toHaveBeenCalled();
        expect(documentMirrorService.getStoredDetail).not.toHaveBeenCalled();
        expect(eventBus.emit).toHaveBeenCalledWith({
            branchId,
            documentId,
            reason: "mirror:changed",
        });
    });

    it("publishes a generic DB-refetch event for a tombstoned branch document", async () => {
        await expect(service.publishLocalDocumentChange(documentId)).resolves.toBeUndefined();

        expect(eformsignDocRepository.findBranchIdByDocumentId)
            .toHaveBeenCalledWith(documentId);
        expect(eventBus.emit).toHaveBeenCalledWith({
            branchId,
            documentId,
            reason: "mirror:changed",
        });
    });

    it("does not publish a branch event for a tombstoned unassigned document", async () => {
        eformsignDocRepository.findBranchIdByDocumentId.mockResolvedValue(null);

        await expect(service.publishLocalDocumentChange(documentId)).resolves.toBeUndefined();

        expect(eventBus.emit).not.toHaveBeenCalled();
    });

    it("keeps tombstone invalidation retryable when its branch lookup fails", async () => {
        eformsignDocRepository.findBranchIdByDocumentId.mockRejectedValue(
            new Error("database unavailable"),
        );

        await expect(service.publishLocalDocumentChange(documentId))
            .rejects.toThrow("database unavailable");
        expect(eventBus.emit).not.toHaveBeenCalled();
    });

    it("does not publish completion after the refreshed mirror moved to a non-completed status", async () => {
        const payload = createDocumentPayload();
        documentMirrorService.getStoredDetail.mockResolvedValueOnce({
            current_status: { status_type: "071" },
        });

        await expect(service.publishCompletionEvent(payload)).resolves.toBeUndefined();

        expect(eventBus.emit).not.toHaveBeenCalled();
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
            credentialBoundary as never,
            clientRepository as never,
            eformsignDocRepository as never,
            employeeScheduleRepository as never,
            employeeRepository as never,
            mirrorUnassignedDocUsecase as never,
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
