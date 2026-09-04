import { ExecutionContext, INestApplication, ValidationPipe } from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import request from "supertest";
import { ConfigService } from "@nestjs/config";
import { EformsignDocService } from "application/services/eformsign-doc.service";
import { EformsignDocsEventBus } from "application/services/eformsign-docs-event-bus.service";
import { EformsignHeadlessProgressService } from "application/services/eformsign-headless-progress.service";
import { EformsignDocumentJobService } from "application/services/eformsign-document-job.service";
import { EformsignDispatchBoundaryService } from "application/services/eformsign-dispatch-boundary.service";
import { DispatchDocumentHeadlessUsecase } from "application/usecases/eformsign-doc/dispatch-document-headless.usecase";
import { FinalizeDocumentHeadlessUsecase } from "application/usecases/eformsign-doc/finalize-document-headless.usecase";
import { AdoptEformsignDocUsecase } from "application/usecases/eformsign-doc/adopt-eformsign-doc.usecase";
import { ListClientNamesByBranchUsecase } from "application/usecases/eformsign-doc/list-client-names-by-branch.usecase";
import { ListReviewStageContractsUsecase } from "application/usecases/eformsign-doc/list-review-stage-contracts.usecase";
import { JwtGuard } from "infrastructure/auth/jwt.guard";
import { TenantGuard } from "infrastructure/tenant";
import { EformsignDocController } from "interface/controllers/eformsign-doc.controller";

/**
 * The denial that headquarters could see but not interpret.
 *
 * An eformsign-console document has no client, branch or kind attached, so it
 * appears in the headquarters list (which includes branchId: null) while every
 * finalize gate refuses it. The controller used to answer that click with a
 * bare 403, which the frontend could only render as a generic failure — so the
 * operator clicked again. The refusal itself must not move: what changed is
 * that it now arrives in the finalize contract's own shape, which the frontend
 * maps to a sentence naming the missing client registration.
 */
describe("POST /eformsign-docs/finalize-headless (denied targets)", () => {
    let app: INestApplication;
    let eformsignDocService: { findByDocumentId: jest.Mock };
    let finalizeHeadlessUsecase: { execute: jest.Mock };

    const authGuard = {
        canActivate: (context: ExecutionContext) => {
            const req = context.switchToHttp().getRequest();
            req.user = { userId: "user-a", branchId: "branch-a", role: "admin", branchRole: "admin" };
            req.tenant = {
                userId: "user-a",
                branchId: "branch-a",
                globalRole: "admin",
                branchRole: "admin",
            };
            return true;
        },
    };

    beforeEach(async () => {
        eformsignDocService = { findByDocumentId: jest.fn() };
        finalizeHeadlessUsecase = { execute: jest.fn() };

        const moduleFixture: TestingModule = await Test.createTestingModule({
            controllers: [EformsignDocController],
            providers: [
                { provide: EformsignDocService, useValue: eformsignDocService },
                { provide: ListClientNamesByBranchUsecase, useValue: {} },
                { provide: ListReviewStageContractsUsecase, useValue: {} },
                { provide: DispatchDocumentHeadlessUsecase, useValue: {} },
                { provide: FinalizeDocumentHeadlessUsecase, useValue: finalizeHeadlessUsecase },
                { provide: AdoptEformsignDocUsecase, useValue: {} },
                { provide: EformsignDocsEventBus, useValue: {} },
                { provide: EformsignHeadlessProgressService, useValue: {} },
                { provide: ConfigService, useValue: { get: jest.fn(() => undefined) } },
                { provide: EformsignDocumentJobService, useValue: {} },
                { provide: EformsignDispatchBoundaryService, useValue: {} },
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

    it("refuses a document the branch cannot see, without ever reaching the usecase", async () => {
        eformsignDocService.findByDocumentId.mockResolvedValue(null);

        const response = await request(app.getHttpServer())
            .post("/eformsign-docs/finalize-headless")
            .send({ documentId: "document-unassigned" });

        // Still closed: the lookup is branch-scoped, and nothing downstream runs.
        expect(eformsignDocService.findByDocumentId).toHaveBeenCalledWith("branch-a", "document-unassigned");
        expect(finalizeHeadlessUsecase.execute).not.toHaveBeenCalled();

        // Now legible: the frontend maps `authorization_denied` to a sentence
        // about client registration instead of a generic failure toast.
        expect(response.status).toBe(201);
        expect(response.body).toEqual({
            ok: false,
            durationMs: 0,
            reason: "authorization_denied",
            fallbackHint: "manual_check",
        });
    });

    it("says nothing about why — an existing row elsewhere is denied identically", async () => {
        // The refusal must not distinguish "no such document" from "another
        // branch's" from "unclaimed", or it becomes a probe for document ids.
        eformsignDocService.findByDocumentId.mockResolvedValue(null);

        const missing = await request(app.getHttpServer())
            .post("/eformsign-docs/finalize-headless")
            .send({ documentId: "no-such-document" });
        const otherBranch = await request(app.getHttpServer())
            .post("/eformsign-docs/finalize-headless")
            .send({ documentId: "branch-b-document" });

        expect(missing.body).toEqual(otherBranch.body);
    });

    it("runs the usecase for a document the branch can see", async () => {
        eformsignDocService.findByDocumentId.mockResolvedValue({ documentId: "document-1" });
        finalizeHeadlessUsecase.execute.mockResolvedValue({ ok: true, completed: true, durationMs: 12 });

        const response = await request(app.getHttpServer())
            .post("/eformsign-docs/finalize-headless")
            .send({ documentId: "document-1" });

        expect(response.body).toEqual({ ok: true, completed: true, durationMs: 12 });
        expect(finalizeHeadlessUsecase.execute).toHaveBeenCalledTimes(1);
    });
});
