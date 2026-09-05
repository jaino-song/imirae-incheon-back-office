import { BadRequestException, ExecutionContext, INestApplication, NotFoundException } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { JwtGuard } from "infrastructure/auth/jwt.guard";
import { TenantGuard } from "infrastructure/tenant";
import { ReceiptLinkManualSendService } from "application/services/receipt-link-manual-send.service";
import { ReceiptLinkAdminController } from "interface/controllers/receipt-link-admin.controller";
import { GlobalValidationPipe } from "infrastructure/pipes/global-validation.pipe";

const BRANCH = "11111111-1111-1111-1111-111111111111";

describe("ReceiptLinkAdminController", () => {
    let app: INestApplication;
    const manualSendService = { send: jest.fn() };

    beforeAll(async () => {
        // Stands in for both JwtGuard and TenantGuard: populates exactly what each real guard
        // would have set on the request (request.user from the JWT, request.tenant from the
        // resolved membership) so the controller's @CurrentTenant()/request.user reads are
        // exercised the same way they are in production.
        const mockGuard = {
            canActivate: (context: ExecutionContext) => {
                const req = context.switchToHttp().getRequest();
                req.user = { userId: "user-1" };
                req.tenant = { branchId: BRANCH };
                return true;
            },
        };

        const moduleRef = await Test.createTestingModule({
            controllers: [ReceiptLinkAdminController],
            providers: [{ provide: ReceiptLinkManualSendService, useValue: manualSendService }],
        })
            .overrideGuard(JwtGuard)
            .useValue(mockGuard)
            .overrideGuard(TenantGuard)
            .useValue(mockGuard)
            .compile();

        app = moduleRef.createNestApplication();
        // Same pipe options as main.ts:61, so this test app's validation behavior
        // (whitelist + forbidNonWhitelisted + transform) matches production exactly.
        app.useGlobalPipes(new GlobalValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
        await app.init();
    });

    afterAll(async () => {
        await app.close();
    });

    beforeEach(() => jest.clearAllMocks());

    it("declares JwtGuard and TenantGuard at the controller level", () => {
        const guards = Reflect.getMetadata("__guards__", ReceiptLinkAdminController) ?? [];
        expect(guards).toContain(JwtGuard);
        expect(guards).toContain(TenantGuard);
    });

    it("POST /receipt-links/send returns 200 (not 201) with the service result and derives branchId/userId from the tenant/auth context, not the body", async () => {
        manualSendService.send.mockResolvedValue({
            jobId: "job-1",
            scheduledFor: new Date("2026-09-03T00:00:00.000Z"),
            clientName: "김산모",
        });

        const res = await request(app.getHttpServer())
            .post("/receipt-links/send")
            .send({ documentId: "doc-ext-1" })
            .expect(200);

        expect(res.body).toEqual({ jobId: "job-1", scheduledFor: "2026-09-03T00:00:00.000Z", clientName: "김산모" });
        expect(manualSendService.send).toHaveBeenCalledWith({ branchId: BRANCH, documentId: "doc-ext-1", userId: "user-1" });
    });

    it("maps NotFoundException({ reason }) from the service to 404 with that body", async () => {
        manualSendService.send.mockRejectedValue(new NotFoundException({ reason: "document_not_found" }));
        await request(app.getHttpServer())
            .post("/receipt-links/send")
            .send({ documentId: "doc-ext-1" })
            .expect(404, { reason: "document_not_found" });
    });

    it("maps BadRequestException({ reason, message }) from the service to 400 with that body", async () => {
        manualSendService.send.mockRejectedValue(
            new BadRequestException({ reason: "missing_phone", message: "산모 연락처가 없거나 형식이 올바르지 않습니다" }),
        );
        await request(app.getHttpServer())
            .post("/receipt-links/send")
            .send({ documentId: "doc-ext-1" })
            .expect(400, { reason: "missing_phone", message: "산모 연락처가 없거나 형식이 올바르지 않습니다" });
    });

    it("rejects an empty body with 400 under the production validation pipe (documentId is required)", async () => {
        await request(app.getHttpServer()).post("/receipt-links/send").send({}).expect(400);
        expect(manualSendService.send).not.toHaveBeenCalled();
    });
});
