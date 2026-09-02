import { INestApplication } from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import { ConfigService } from "@nestjs/config";
import { EformsignWebhookService } from "application/services/eformsign-webhook.service";
import { EformsignDocumentMirrorService } from "application/services/eformsign-document-mirror.service";
import { WebhookGuard } from "infrastructure/auth/webhook.guard";
import { EformsignWebhookController } from "interface/controllers/eformsign-webhook.controller";
import { EformsignWebhookPayloadDto } from "interface/dto/eformsign-webhook.dto";
import { GlobalValidationPipe } from "infrastructure/pipes/global-validation.pipe";
import { EformsignApiError } from "infrastructure/api/eformsign-api.error";
import request from "supertest";

describe("EformsignWebhookController (Integration)", () => {
    let app: INestApplication;
    let webhookService: jest.Mocked<Pick<
        EformsignWebhookService,
        "processWebhook" | "publishCompletionEvent" | "publishLocalDocumentChange"
    >>;
    let documentMirrorService: jest.Mocked<Pick<
        EformsignDocumentMirrorService,
        | "syncDocument"
        | "fetchCurrentDetail"
        | "getStoredDetail"
        | "isDocumentReady"
        | "markDocumentsDeleted"
    >>;
    const authHeader = { Authorization: "Bearer webhook-secret" };
    const webhookPrincipal = {
        branchId: "__system__:webhook",
        source: "worker" as const,
    };

    const payload: EformsignWebhookPayloadDto = {
        webhook_id: "webhook-1",
        webhook_name: "contract-status",
        company_id: "company-1",
        event_type: "document",
        document: {
            id: "doc-1",
            document_title: "계약서",
            template_id: "template-1",
            template_name: "산모신생아 계약서",
            workflow_seq: 1,
            workflow_name: "서명",
            status: "doc_complete",
            updated_date: 1780000000000,
        },
    };
    const mirroredDocument = {
        id: "doc-1",
        document_number: "DOC-1",
        template: { id: "template-1", name: "산모신생아 계약서" },
        document_name: "계약서",
        creator: { recipient_type: "01", id: "creator", name: "생성자" },
        created_date: 1779990000000,
        updated_date: 1780000000000,
        current_status: {
            status_type: "050",
            step_type: "06",
            step_index: "1",
            step_name: "완료",
            step_recipients: [],
            step_group: 1,
        },
        fields: [],
    };

    beforeEach(async () => {
        const mockWebhookService = {
            processWebhook: jest.fn().mockResolvedValue({
                completionClaim: "claimed",
                completionBranchId: "branch-1",
            }),
            publishCompletionEvent: jest.fn(),
            publishLocalDocumentChange: jest.fn(),
        };
        const mockDocumentMirrorService = {
            syncDocument: jest.fn().mockResolvedValue(undefined),
            fetchCurrentDetail: jest.fn().mockResolvedValue(mirroredDocument),
            getStoredDetail: jest.fn().mockResolvedValue(mirroredDocument),
            isDocumentReady: jest.fn().mockResolvedValue(true),
            markDocumentsDeleted: jest.fn().mockResolvedValue(undefined),
        };
        const mockConfigService = {
            get: jest.fn((key: string) => {
                switch (key) {
                    case "EFORMSIGN_WEBHOOK_SECRET":
                        return "webhook-secret";
                    case "EFORMSIGN_COMPANY_ID":
                        return "company-1";
                    default:
                        return undefined;
                }
            }),
        };

        const moduleFixture: TestingModule = await Test.createTestingModule({
            controllers: [EformsignWebhookController],
            providers: [
                {
                    provide: EformsignWebhookService,
                    useValue: mockWebhookService,
                },
                {
                    provide: EformsignDocumentMirrorService,
                    useValue: mockDocumentMirrorService,
                },
                {
                    provide: ConfigService,
                    useValue: mockConfigService,
                },
                WebhookGuard,
            ],
        })
            .compile();

        app = moduleFixture.createNestApplication();
        // Mirror the production global pipe (main.ts) so this suite proves the
        // metatype-based exemption keeps webhooks permissive under the strict
        // forbidNonWhitelisted policy that applies everywhere else.
        app.useGlobalPipes(new GlobalValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
        await app.init();

        webhookService = moduleFixture.get(EformsignWebhookService);
        documentMirrorService = moduleFixture.get(EformsignDocumentMirrorService);
    });

    afterEach(async () => {
        await app.close();
    });

    it("mirrors a completion webhook before claiming and publishing it", async () => {
        const response = await request(app.getHttpServer())
            .post("/webhooks/eformsign")
            .set(authHeader)
            .send(payload);

        expect(response.status).toBe(200);
        expect(response.body).toEqual({ success: true });
        expect(documentMirrorService.syncDocument).toHaveBeenCalledWith(
            "doc-1",
            webhookPrincipal,
            {
                force: true,
                skipBranchOwnedProjection: true,
                strictCompletionReconciliation: true,
                deferServiceRecordLifecycle: true,
            },
        );
        expect(webhookService.processWebhook).toHaveBeenCalledWith(payload, {
            mirroredDocument,
            deferCompletionEvent: true,
            deferCompletionEffects: true,
        });
        expect(documentMirrorService.syncDocument.mock.invocationCallOrder[0]!)
            .toBeLessThan(webhookService.processWebhook.mock.invocationCallOrder[0]!);
        expect(webhookService.processWebhook.mock.invocationCallOrder[0]!)
            .toBeLessThan(webhookService.publishCompletionEvent.mock.invocationCallOrder[0]!);
        expect(webhookService.publishCompletionEvent).toHaveBeenCalledWith(payload, {
            branchId: "branch-1",
            mirroredDocument,
        });
        expect(documentMirrorService.getStoredDetail).toHaveBeenCalledWith("doc-1");
        expect(documentMirrorService.fetchCurrentDetail).not.toHaveBeenCalled();
    });

    it("mirrors a completed-PDF webhook before applying its generation-fenced claim", async () => {
        const pdfPayload: EformsignWebhookPayloadDto = {
            ...payload,
            event_type: "ready_document_pdf",
            document: undefined,
            ready_document_pdf: {
                document_id: "doc-1",
                document_title: "계약서",
                workflow_seq: 2,
                workflow_name: "완료",
                template_id: "template-1",
                template_name: "산모신생아 계약서",
                document_status: "doc_complete",
            },
        };

        const response = await request(app.getHttpServer())
            .post("/webhooks/eformsign")
            .set(authHeader)
            .send(pdfPayload);

        expect(response.status).toBe(200);
        expect(webhookService.processWebhook).toHaveBeenCalledWith(
            pdfPayload,
            {
                mirroredDocument,
                deferCompletionEvent: true,
                deferCompletionEffects: true,
            },
        );
        expect(documentMirrorService.syncDocument.mock.invocationCallOrder[0]!)
            .toBeLessThan(webhookService.processWebhook.mock.invocationCallOrder[0]!);
        expect(webhookService.processWebhook.mock.invocationCallOrder[0]!)
            .toBeLessThan(webhookService.publishCompletionEvent.mock.invocationCallOrder[0]!);
        expect(documentMirrorService.getStoredDetail).toHaveBeenCalledWith("doc-1");
        expect(documentMirrorService.fetchCurrentDetail).not.toHaveBeenCalled();
    });

    it("does not republish a duplicate completed-PDF claim", async () => {
        webhookService.processWebhook.mockResolvedValue({
            completionClaim: "duplicate",
        });
        const pdfPayload: EformsignWebhookPayloadDto = {
            ...payload,
            event_type: "ready_document_pdf",
            document: undefined,
            ready_document_pdf: {
                document_id: "doc-1",
                document_title: "계약서",
                workflow_seq: 2,
                workflow_name: "완료",
                template_id: "template-1",
                template_name: "산모신생아 계약서",
                document_status: "doc_complete",
            },
        };

        const response = await request(app.getHttpServer())
            .post("/webhooks/eformsign")
            .set(authHeader)
            .send(pdfPayload);

        expect(response.status).toBe(200);
        expect(webhookService.processWebhook).toHaveBeenCalled();
        expect(webhookService.publishCompletionEvent).not.toHaveBeenCalled();
    });

    it("publishes a generic invalidation when strict mirror sync linked a branchless document before a duplicate claim", async () => {
        documentMirrorService.syncDocument.mockResolvedValue({
            ownershipChanged: true,
        } as never);
        webhookService.processWebhook.mockResolvedValue({
            completionClaim: "duplicate",
            completionBranchId: "branch-1",
        });

        const response = await request(app.getHttpServer())
            .post("/webhooks/eformsign")
            .set(authHeader)
            .send(payload);

        expect(response.status).toBe(200);
        expect(webhookService.publishCompletionEvent).toHaveBeenCalledWith(payload, {
            branchId: "branch-1",
            mirroredDocument,
        });
    });

    it("publishes a generic invalidation after a duplicate service-record retry changes local state", async () => {
        webhookService.processWebhook.mockResolvedValue({
            completionClaim: "duplicate",
            completionBranchId: "branch-1",
            duplicateServiceRecordLifecycleChanged: true,
        });

        const response = await request(app.getHttpServer())
            .post("/webhooks/eformsign")
            .set(authHeader)
            .send(payload);

        expect(response.status).toBe(200);
        expect(webhookService.publishCompletionEvent).toHaveBeenCalledWith(payload, {
            branchId: "branch-1",
            mirroredDocument,
        });
    });

    it("does not publish after a duplicate service-record retry that made no local change", async () => {
        webhookService.processWebhook.mockResolvedValue({
            completionClaim: "duplicate",
            completionBranchId: "branch-1",
            duplicateServiceRecordLifecycleChanged: false,
        });

        const response = await request(app.getHttpServer())
            .post("/webhooks/eformsign")
            .set(authHeader)
            .send(payload);

        expect(response.status).toBe(200);
        expect(webhookService.publishCompletionEvent).not.toHaveBeenCalled();
    });

    it("returns 503 without completion effects after a transient lifecycle failure, then publishes on retry", async () => {
        documentMirrorService.syncDocument
            .mockRejectedValueOnce(new Error("lifecycle database unavailable"));

        const failed = await request(app.getHttpServer())
            .post("/webhooks/eformsign")
            .set(authHeader)
            .send(payload);
        expect(failed.status).toBe(503);
        expect(webhookService.publishCompletionEvent).not.toHaveBeenCalled();
        expect(documentMirrorService.syncDocument).toHaveBeenCalledWith(
            "doc-1",
            webhookPrincipal,
            {
                force: true,
                skipBranchOwnedProjection: true,
                strictCompletionReconciliation: true,
                deferServiceRecordLifecycle: true,
            },
        );

        const retried = await request(app.getHttpServer())
            .post("/webhooks/eformsign")
            .set(authHeader)
            .send(payload);
        expect(retried.status).toBe(200);
        expect(webhookService.publishCompletionEvent).toHaveBeenCalledTimes(1);
        expect(webhookService.publishCompletionEvent).toHaveBeenCalledWith(payload, {
            branchId: "branch-1",
            mirroredDocument,
        });
    });

    it("publishes once when a post-claim lifecycle failure retries through a duplicate claim", async () => {
        webhookService.processWebhook.mockResolvedValue({
            completionClaim: "duplicate",
            completionBranchId: "branch-1",
            duplicateServiceRecordLifecycleChanged: true,
        });
        webhookService.processWebhook.mockRejectedValueOnce(
            new Error("lifecycle database unavailable"),
        );

        const failed = await request(app.getHttpServer())
            .post("/webhooks/eformsign")
            .set(authHeader)
            .send(payload);
        expect(failed.status).toBe(503);
        expect(webhookService.publishCompletionEvent).not.toHaveBeenCalled();

        const retried = await request(app.getHttpServer())
            .post("/webhooks/eformsign")
            .set(authHeader)
            .send(payload);
        expect(retried.status).toBe(200);
        expect(webhookService.publishCompletionEvent).toHaveBeenCalledTimes(1);
        expect(webhookService.publishCompletionEvent).toHaveBeenCalledWith(payload, {
            branchId: "branch-1",
            mirroredDocument,
        });
    });

    it("publishes a DB-refetch invalidation when the vendor disappeared and a tombstone was stored", async () => {
        const deletedAt = new Date(payload.document!.updated_date!);
        documentMirrorService.syncDocument.mockRejectedValue(
            new EformsignApiError("not found", 404),
        );

        const response = await request(app.getHttpServer())
            .post("/webhooks/eformsign")
            .set(authHeader)
            .send(payload);

        expect(response.status).toBe(200);
        expect(documentMirrorService.markDocumentsDeleted)
            .toHaveBeenCalledWith(["doc-1"], deletedAt);
        expect(webhookService.publishLocalDocumentChange)
            .toHaveBeenCalledWith("doc-1");
        expect(documentMirrorService.markDocumentsDeleted.mock.invocationCallOrder[0]!)
            .toBeLessThan(webhookService.publishLocalDocumentChange.mock.invocationCallOrder[0]!);
        expect(webhookService.publishCompletionEvent).not.toHaveBeenCalled();
    });

    it("stores a tombstone for the vendor deleted-document application code", async () => {
        const deletedAt = new Date(payload.document!.updated_date!);
        documentMirrorService.syncDocument.mockRejectedValue(
            new EformsignApiError("deleted", 400, "4000006"),
        );

        const response = await request(app.getHttpServer())
            .post("/webhooks/eformsign")
            .set(authHeader)
            .send(payload);

        expect(response.status).toBe(200);
        expect(documentMirrorService.markDocumentsDeleted)
            .toHaveBeenCalledWith(["doc-1"], deletedAt);
        expect(webhookService.publishLocalDocumentChange)
            .toHaveBeenCalledWith("doc-1");
        expect(webhookService.publishCompletionEvent).not.toHaveBeenCalled();
    });

    it("does not publish an older completion webhook after a newer completed mirror refresh", async () => {
        const staleCompletionPayload: EformsignWebhookPayloadDto = {
            ...payload,
            document: {
                ...payload.document!,
                updated_date: mirroredDocument.updated_date - 1,
            },
        };

        const response = await request(app.getHttpServer())
            .post("/webhooks/eformsign")
            .set(authHeader)
            .send(staleCompletionPayload);

        expect(response.status).toBe(200);
        expect(webhookService.processWebhook).not.toHaveBeenCalled();
        expect(webhookService.publishCompletionEvent).not.toHaveBeenCalled();
    });

    it("returns a retryable failure instead of publishing while a concurrent mirror is not ready", async () => {
        documentMirrorService.isDocumentReady.mockResolvedValue(false);

        const response = await request(app.getHttpServer())
            .post("/webhooks/eformsign")
            .set(authHeader)
            .send(payload);

        expect(response.status).toBe(503);
        expect(documentMirrorService.syncDocument).toHaveBeenCalledWith(
            "doc-1",
            webhookPrincipal,
            {
                force: true,
                skipBranchOwnedProjection: true,
                strictCompletionReconciliation: true,
                deferServiceRecordLifecycle: true,
            },
        );
        expect(webhookService.publishCompletionEvent).not.toHaveBeenCalled();
    });

    it("mirrors and claims a completion without a second vendor detail fetch", async () => {
        const response = await request(app.getHttpServer())
            .post("/webhooks/eformsign")
            .set(authHeader)
            .send(payload);

        expect(response.status).toBe(200);
        expect(webhookService.processWebhook).toHaveBeenCalledWith(payload, {
            mirroredDocument,
            deferCompletionEvent: true,
            deferCompletionEffects: true,
        });
        expect(documentMirrorService.syncDocument).toHaveBeenCalledWith(
            "doc-1",
            webhookPrincipal,
            {
                force: true,
                skipBranchOwnedProjection: true,
                strictCompletionReconciliation: true,
                deferServiceRecordLifecycle: true,
            },
        );
        expect(documentMirrorService.fetchCurrentDetail).not.toHaveBeenCalled();
    });

    it("processes a non-completion event when the mirror is not completion-ready", async () => {
        webhookService.processWebhook.mockResolvedValue(undefined);
        documentMirrorService.isDocumentReady.mockResolvedValue(false);
        const inProgressPayload: EformsignWebhookPayloadDto = {
            ...payload,
            document: {
                ...payload.document!,
                status: "doc_request_participant",
            },
        };

        const response = await request(app.getHttpServer())
            .post("/webhooks/eformsign")
            .set(authHeader)
            .send(inProgressPayload);

        expect(response.status).toBe(200);
        expect(webhookService.processWebhook).toHaveBeenCalledWith(
            inProgressPayload,
            { mirroredDocument },
        );
        expect(documentMirrorService.syncDocument).toHaveBeenCalledWith(
            "doc-1",
            webhookPrincipal,
            {
                force: true,
                skipBranchOwnedProjection: true,
                skipHealthySameVersionFileRepair: true,
            },
        );
        expect(documentMirrorService.syncDocument.mock.invocationCallOrder[0]!)
            .toBeLessThan(webhookService.processWebhook.mock.invocationCallOrder[0]!);
        expect(documentMirrorService.isDocumentReady).not.toHaveBeenCalled();
        expect(webhookService.publishCompletionEvent).not.toHaveBeenCalled();
    });

    it("acknowledges an older non-completion webhook without replaying stale side effects", async () => {
        const stalePayload: EformsignWebhookPayloadDto = {
            ...payload,
            document: {
                ...payload.document!,
                status: "doc_decline",
                updated_date: mirroredDocument.updated_date - 1,
            },
        };

        const response = await request(app.getHttpServer())
            .post("/webhooks/eformsign")
            .set(authHeader)
            .send(stalePayload);

        expect(response.status).toBe(200);
        expect(documentMirrorService.syncDocument).toHaveBeenCalledWith(
            "doc-1",
            webhookPrincipal,
            {
                force: true,
                skipBranchOwnedProjection: true,
                skipHealthySameVersionFileRepair: true,
            },
        );
        expect(webhookService.processWebhook).not.toHaveBeenCalled();
    });

    it("requests a retry when the webhook is newer than the refreshed mirror", async () => {
        const aheadPayload: EformsignWebhookPayloadDto = {
            ...payload,
            document: {
                ...payload.document!,
                status: "doc_request_participant",
                updated_date: mirroredDocument.updated_date + 1,
            },
        };

        const response = await request(app.getHttpServer())
            .post("/webhooks/eformsign")
            .set(authHeader)
            .send(aheadPayload);

        expect(response.status).toBe(503);
        expect(webhookService.processWebhook).not.toHaveBeenCalled();
    });

    it("acknowledges a webhook when its local detail was removed during synchronization", async () => {
        documentMirrorService.getStoredDetail.mockResolvedValue(null);
        const inProgressPayload: EformsignWebhookPayloadDto = {
            ...payload,
            document: {
                ...payload.document!,
                status: "doc_request_participant",
            },
        };

        const response = await request(app.getHttpServer())
            .post("/webhooks/eformsign")
            .set(authHeader)
            .send(inProgressPayload);

        expect(response.status).toBe(200);
        expect(webhookService.processWebhook).not.toHaveBeenCalled();
    });

    it("accepts eformsign payloads carrying fields our DTO does not declare", async () => {
        // Real eformsign webhooks (webhook-example.md) include document.comment
        // and document.recipients[] — undeclared here. Under the production
        // global pipe (forbidNonWhitelisted) these would 400; the controller's
        // own permissive @UsePipes must keep the completion webhook working.
        webhookService.processWebhook.mockResolvedValue(undefined);

        const payloadWithExtras = {
            ...payload,
            document: {
                ...payload.document,
                comment: "",
                recipients: [
                    {
                        step_seq: "2",
                        name: "송진호",
                        id: "",
                        sms: { country_code: "+82", phone_number: "1066211878" },
                        token_id: "e638f0969f634156bb9c32652309017d",
                        sms_template_index: 0,
                    },
                ],
            },
        };

        const response = await request(app.getHttpServer())
            .post("/webhooks/eformsign")
            .set(authHeader)
            .send(payloadWithExtras);

        expect(response.status).toBe(200);
        expect(response.body).toEqual({ success: true });
        expect(webhookService.processWebhook).toHaveBeenCalled();
    });

    it("tombstones a vendor-deleted document without replaying the stale webhook payload", async () => {
        const deletedAt = new Date(payload.document!.updated_date!);
        documentMirrorService.syncDocument.mockRejectedValue(
            new EformsignApiError("not found", 404),
        );
        documentMirrorService.getStoredDetail.mockResolvedValue({
            ...mirroredDocument,
            current_status: {
                ...mirroredDocument.current_status,
                status_type: "049",
                status_doc_type: "deleted",
                status_doc_detail: "삭제",
            },
        });

        const response = await request(app.getHttpServer())
            .post("/webhooks/eformsign")
            .set(authHeader)
            .send({
                ...payload,
                document: {
                    ...payload.document,
                    status: "doc_deleted",
                },
            });

        expect(response.status).toBe(200);
        expect(documentMirrorService.markDocumentsDeleted)
            .toHaveBeenCalledWith(["doc-1"], deletedAt);
        expect(webhookService.processWebhook).not.toHaveBeenCalled();
    });

    it("returns retryable failure when webhook processing fails", async () => {
        webhookService.processWebhook.mockRejectedValue(new Error("database unavailable"));

        const response = await request(app.getHttpServer())
            .post("/webhooks/eformsign")
            .set(authHeader)
            .send(payload);

        expect(response.status).toBe(503);
        expect(response.body).toEqual({
            success: false,
            error: "Webhook processing failed",
            webhookId: "webhook-1",
            documentId: "doc-1",
        });
    });

    it("returns 401 when the webhook secret is missing", async () => {
        const response = await request(app.getHttpServer())
            .post("/webhooks/eformsign")
            .send(payload);

        expect(response.status).toBe(401);
        expect(webhookService.processWebhook).not.toHaveBeenCalled();
    });

    it("returns 401 when the webhook secret is invalid", async () => {
        const response = await request(app.getHttpServer())
            .post("/webhooks/eformsign")
            .set({ Authorization: "Bearer wrong-secret" })
            .send(payload);

        expect(response.status).toBe(401);
        expect(webhookService.processWebhook).not.toHaveBeenCalled();
    });

    it("returns 403 when the company id is unknown", async () => {
        const response = await request(app.getHttpServer())
            .post("/webhooks/eformsign")
            .set(authHeader)
            .send({
                ...payload,
                company_id: "unknown-company",
            });

        expect(response.status).toBe(403);
        expect(webhookService.processWebhook).not.toHaveBeenCalled();
    });
});
