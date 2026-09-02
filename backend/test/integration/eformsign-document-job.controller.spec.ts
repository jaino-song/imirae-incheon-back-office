import { ExecutionContext, INestApplication, ValidationPipe } from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import request from "supertest";
import { ConfigService } from "@nestjs/config";
import { EformsignDocService } from "application/services/eformsign-doc.service";
import { EformsignDocsEventBus } from "application/services/eformsign-docs-event-bus.service";
import { EformsignHeadlessProgressService } from "application/services/eformsign-headless-progress.service";
import { EformsignDocumentJobService } from "application/services/eformsign-document-job.service";
import { DispatchDocumentHeadlessUsecase } from "application/usecases/eformsign-doc/dispatch-document-headless.usecase";
import { FinalizeDocumentHeadlessUsecase } from "application/usecases/eformsign-doc/finalize-document-headless.usecase";
import { AdoptEformsignDocUsecase } from "application/usecases/eformsign-doc/adopt-eformsign-doc.usecase";
import { ListClientNamesByBranchUsecase } from "application/usecases/eformsign-doc/list-client-names-by-branch.usecase";
import { ListReviewStageContractsUsecase } from "application/usecases/eformsign-doc/list-review-stage-contracts.usecase";
import { JwtGuard } from "infrastructure/auth/jwt.guard";
import { TenantGuard } from "infrastructure/tenant";
import { EformsignDocController } from "interface/controllers/eformsign-doc.controller";
import type { EformsignDocumentJobEntity } from "domain/entities/eformsign-document-job.entity";
import { EformsignDispatchBoundaryService } from "application/services/eformsign-dispatch-boundary.service";

const validContractData = {
    customerName: "산모",
    customerContact: "010-1111-2222",
    customerDOB: "900101",
    customerAddress: "인천",
    caretaker1Name: "관리사",
    caretaker1Contact: "010-9999-8888",
    type: "A형",
    days: "10",
    area: "namdong",
    contractDuration: "2026-07-01 ~ 2026-07-14",
    startYear: "26",
    startMonth: "07",
    startDay: "01",
    startDate: "2026-07-01",
    endYear: "26",
    endMonth: "07",
    endDay: "14",
    endDate: "2026-07-14",
    paymentYear: "26",
    paymentMonth: "07",
    paymentDay: "01",
    fullPrice: "1000000",
    grant: "800000",
    actualPrice: "200000",
};

const job = (overrides: Partial<EformsignDocumentJobEntity> = {}): EformsignDocumentJobEntity => ({
    id: "job-1",
    branchId: "branch-a",
    clientId: 42,
    documentId: "document-1",
    jobType: "create_document",
    source: "staff",
    status: "processing",
    requestKey: "request-1",
    activeKey: "active-1",
    payload: { accessToken: "provider-secret", customerName: "산모" },
    payloadFingerprint: "fingerprint-secret",
    progressStep: "provider_submit",
    attempts: 1,
    nextAttemptAt: new Date("2026-08-13T00:00:00.000Z"),
    heartbeatAt: new Date("2026-08-13T00:00:00.000Z"),
    leaseToken: "00000000-0000-0000-0000-000000000099",
    autoFinalizeOutcomeRecordedAt: null,
    autoFinalizeOutcomeAttempts: null,
    startedAt: new Date("2026-08-13T00:00:00.000Z"),
    completedAt: null,
    lastErrorCode: "PROVIDER_RAW_ERROR_SHOULD_NOT_LEAK",
    createdByUserId: "user-a",
    createdAt: new Date("2026-08-13T00:00:00.000Z"),
    updatedAt: new Date("2026-08-13T00:00:00.000Z"),
    ...overrides,
});

let authRole = "admin";

describe("EformsignDocumentJobController (Integration)", () => {
    let app: INestApplication;
    let documentJobService: {
        enqueueCreateDocument: jest.Mock;
        enqueueFinalizeDocument: jest.Mock;
        getSummary: jest.Mock;
        listForBranch: jest.Mock;
    };
    let dispatchBoundary: { reconcile: jest.Mock; findById?: jest.Mock };

    const authGuard = {
        canActivate: (context: ExecutionContext) => {
            const req = context.switchToHttp().getRequest();
            req.user = { userId: "user-a", branchId: "branch-a", role: authRole, branchRole: authRole };
            req.tenant = {
                userId: "user-a",
                branchId: "branch-a",
                globalRole: authRole,
                branchRole: authRole,
            };
            return true;
        },
    };

    beforeEach(async () => {
        authRole = "admin";
        documentJobService = {
            enqueueCreateDocument: jest.fn(),
            enqueueFinalizeDocument: jest.fn(),
            getSummary: jest.fn(),
            listForBranch: jest.fn(),
        };
        dispatchBoundary = {
            reconcile: jest.fn().mockResolvedValue({
                id: "11111111-1111-4111-8111-111111111111",
                status: "reconciled_not_delivered",
                reconciledOutcome: "not_delivered",
                providerDocumentId: null,
            }),
        };

        const moduleFixture: TestingModule = await Test.createTestingModule({
            controllers: [EformsignDocController],
            providers: [
                { provide: EformsignDocService, useValue: {} },
                { provide: ListClientNamesByBranchUsecase, useValue: {} },
                { provide: ListReviewStageContractsUsecase, useValue: {} },
                { provide: DispatchDocumentHeadlessUsecase, useValue: {} },
                { provide: FinalizeDocumentHeadlessUsecase, useValue: {} },
                { provide: AdoptEformsignDocUsecase, useValue: {} },
                { provide: EformsignDocsEventBus, useValue: {} },
                { provide: EformsignHeadlessProgressService, useValue: {} },
                {
                    provide: ConfigService,
                    useValue: {
                        get: jest.fn((key: string) =>
                            key === "EFORMSIGN_DOCUMENT_JOBS_ACCEPTING_ENABLED" ? "true" : undefined,
                        ),
                    },
                },
                { provide: EformsignDocumentJobService, useValue: documentJobService },
                { provide: EformsignDispatchBoundaryService, useValue: dispatchBoundary },
            ],
        })
            .overrideGuard(JwtGuard)
            .useValue(authGuard)
            .overrideGuard(TenantGuard)
            .useValue(authGuard)
            .compile();

        app = moduleFixture.createNestApplication();
        app.useGlobalPipes(new ValidationPipe({
            transform: true,
            whitelist: true,
            forbidNonWhitelisted: true,
        }));
        await app.init();
    });

    afterEach(async () => {
        await app.close();
    });

    it("queues creation with authenticated branch/user context and returns 202 without sensitive fields", async () => {
        documentJobService.enqueueCreateDocument.mockResolvedValue({
            job: job({ status: "queued", documentId: null }),
            existing: false,
        });

        const response = await request(app.getHttpServer())
            .post("/eformsign-docs/jobs/creation")
            .send({ requestKey: "request-creation-1", clientId: 42, contractData: validContractData });

        expect(response.status).toBe(202);
        expect(response.body).toEqual({ jobId: "job-1", status: "queued", existing: false });
        expect(response.body).not.toHaveProperty("payload");
        expect(response.body).not.toHaveProperty("payloadFingerprint");
        expect(documentJobService.enqueueCreateDocument).toHaveBeenCalledWith({
            branchId: "branch-a",
            createdByUserId: "user-a",
            requestKey: "request-creation-1",
            clientId: 42,
            contractData: validContractData,
        });
    });

    it("forwards an active duplicate as an idempotent 202 response", async () => {
        documentJobService.enqueueCreateDocument.mockResolvedValue({
            job: job({ status: "processing" }),
            existing: true,
        });

        const response = await request(app.getHttpServer())
            .post("/eformsign-docs/jobs/creation")
            .send({ requestKey: "request-creation-1", clientId: 42, contractData: validContractData });

        expect(response.status).toBe(202);
        expect(response.body).toEqual({ jobId: "job-1", status: "processing", existing: true });
        expect(documentJobService.enqueueCreateDocument).toHaveBeenCalledTimes(1);
    });

    it("queues finalization with the authenticated branch and staff source", async () => {
        documentJobService.enqueueFinalizeDocument.mockResolvedValue({
            job: job({ jobType: "finalize_document", documentId: "document-99", status: "queued" }),
            existing: false,
        });

        const response = await request(app.getHttpServer())
            .post("/eformsign-docs/jobs/finalization")
            .send({
                requestKey: "request-finalization-1",
                documentId: "document-99",
                prefillEndDate: "2026-08-31",
            });

        expect(response.status).toBe(202);
        expect(documentJobService.enqueueFinalizeDocument).toHaveBeenCalledWith({
            branchId: "branch-a",
            createdByUserId: "user-a",
            requestKey: "request-finalization-1",
            documentId: "document-99",
            prefillEndDate: "2026-08-31",
            source: "staff",
        });
    });

    it("rejects blank/oversized request keys and undeclared sensitive fields before enqueue", async () => {
        const blank = await request(app.getHttpServer())
            .post("/eformsign-docs/jobs/creation")
            .send({ requestKey: " ", clientId: 42, contractData: validContractData });
        const oversized = await request(app.getHttpServer())
            .post("/eformsign-docs/jobs/creation")
            .send({ requestKey: "a".repeat(256), clientId: 42, contractData: validContractData });
        const sensitive = await request(app.getHttpServer())
            .post("/eformsign-docs/jobs/creation")
            .send({
                requestKey: "request-sensitive-field",
                clientId: 42,
                branchId: "branch-attacker",
                contractData: { ...validContractData, accessToken: "provider-secret" },
            });

        expect(blank.status).toBe(400);
        expect(oversized.status).toBe(400);
        expect(sensitive.status).toBe(400);
        expect(documentJobService.enqueueCreateDocument).not.toHaveBeenCalled();
    });

    it("rejects invalid finalization input before enqueue", async () => {
        const response = await request(app.getHttpServer())
            .post("/eformsign-docs/jobs/finalization")
            .send({ requestKey: "request-finalization-2", documentId: "document-2", prefillEndDate: "08/31/2026" });

        expect(response.status).toBe(400);
        expect(documentJobService.enqueueFinalizeDocument).not.toHaveBeenCalled();
    });

    it("reconciles a dispatch intent with the authenticated branch operator", async () => {
        const intentId = "11111111-1111-4111-8111-111111111111";
        const response = await request(app.getHttpServer())
            .post(`/eformsign-docs/dispatch-intents/${intentId}/reconcile`)
            .send({
                outcome: "not_delivered",
                reason: "provider receipt lookup confirms no delivery",
            });

        expect(response.status).toBe(200);
        expect(response.body).toEqual({
            intentId,
            status: "reconciled_not_delivered",
            outcome: "not_delivered",
            providerDocumentId: null,
        });
        expect(dispatchBoundary.reconcile).toHaveBeenCalledWith({
            branchId: "branch-a",
            intentId,
            outcome: "not_delivered",
            actorUserId: "user-a",
            reason: "provider receipt lookup confirms no delivery",
            providerDocumentId: undefined,
        });
    });

    it("reads only the current branch's dispatch intent summary", async () => {
        const intentId = "11111111-1111-4111-8111-111111111111";
        dispatchBoundary.reconcile.mockReset();
        dispatchBoundary.findById = jest.fn().mockResolvedValue({
            id: intentId,
            status: "uncertain",
            reconciledOutcome: null,
            providerDocumentId: null,
        });

        const response = await request(app.getHttpServer())
            .get(`/eformsign-docs/dispatch-intents/${intentId}`);

        expect(response.status).toBe(200);
        expect(response.body).toEqual({
            intentId,
            status: "uncertain",
            outcome: null,
            providerDocumentId: null,
        });
        expect(dispatchBoundary.findById).toHaveBeenCalledWith(
            "branch-a",
            intentId,
        );
    });

    it("validates reconciliation reasons before reaching the repository", async () => {
        const response = await request(app.getHttpServer())
            .post("/eformsign-docs/dispatch-intents/11111111-1111-4111-8111-111111111111/reconcile")
            .send({ outcome: "delivered", reason: " ".repeat(501) });

        expect(response.status).toBe(400);
        expect(dispatchBoundary.reconcile).not.toHaveBeenCalled();
    });

    it("restricts intent reconciliation to owner/admin operators", async () => {
        authRole = "user";
        const response = await request(app.getHttpServer())
            .post("/eformsign-docs/dispatch-intents/11111111-1111-4111-8111-111111111111/reconcile")
            .send({ outcome: "delivered", reason: "provider receipt verified" });

        expect(response.status).toBe(403);
        expect(dispatchBoundary.reconcile).not.toHaveBeenCalled();
    });

    it("returns branch-scoped summary and list with a 24-hour/50 terminal bound", async () => {
        documentJobService.getSummary.mockResolvedValue({ activeCount: 2, requiresAttentionCount: 1 });
        documentJobService.listForBranch.mockResolvedValue({
            active: [job()],
            requiresAttention: [job({ status: "requires_attention", lastErrorCode: "RAW_ERROR" })],
            recent: [job({ status: "completed", completedAt: new Date("2026-08-13T01:00:00.000Z") })],
        });

        const summary = await request(app.getHttpServer()).get("/eformsign-docs/jobs/summary");
        const list = await request(app.getHttpServer()).get("/eformsign-docs/jobs");

        expect(summary.status).toBe(200);
        expect(summary.body).toEqual({ activeCount: 2, requiresAttentionCount: 1 });
        expect(documentJobService.getSummary).toHaveBeenCalledWith("branch-a");
        expect(list.status).toBe(200);
        expect(list.body.active[0]).toEqual(expect.objectContaining({
            jobId: "job-1",
            status: "processing",
            documentId: "document-1",
        }));
        expect(list.body.active[0]).not.toHaveProperty("payload");
        expect(list.body.active[0]).not.toHaveProperty("payloadFingerprint");
        expect(list.body.requiresAttention[0]).not.toHaveProperty("lastErrorCode");
        expect(list.body.active[0]).not.toHaveProperty("requestKey");
        expect(documentJobService.listForBranch).toHaveBeenCalledWith(
            "branch-a",
            expect.any(Date),
            50,
        );
        const terminalSince = documentJobService.listForBranch.mock.calls[0][1] as Date;
        expect(Date.now() - terminalSince.getTime()).toBeGreaterThanOrEqual(24 * 60 * 60 * 1000 - 1000);
        expect(Date.now() - terminalSince.getTime()).toBeLessThan(24 * 60 * 60 * 1000 + 1000);
    });
});
