import { INestApplication, ExecutionContext, ValidationPipe } from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import request from "supertest";
import { ClientDraftController } from "interface/controllers/client-draft.controller";
import { CallInboxService } from "application/services/call-inbox.service";
import { JwtGuard } from "infrastructure/auth/jwt.guard";
import { TenantGuard } from "infrastructure/tenant/tenant.guard";

describe("ClientDraftController (Integration)", () => {
    let app: INestApplication;
    let callInboxService: jest.Mocked<Pick<
        CallInboxService,
        "listDrafts" | "countDrafts" | "getDraft" | "patchDraft" | "confirmNewClient" | "confirm" | "discard"
    >>;

    const mockGuard = {
        canActivate: (context: ExecutionContext) => {
            const req = context.switchToHttp().getRequest();
            req.user = { userId: "user-1", branchId: "branch-1", role: "admin", branchRole: "admin" };
            req.tenant = {
                userId: "user-1",
                branchId: "branch-1",
                globalRole: "admin",
                branchRole: "admin",
            };
            return true;
        },
    };

    beforeEach(async () => {
        callInboxService = {
            listDrafts: jest.fn(),
            countDrafts: jest.fn(),
            getDraft: jest.fn(),
            patchDraft: jest.fn(),
            confirmNewClient: jest.fn(),
            confirm: jest.fn(),
            discard: jest.fn(),
        };

        const moduleFixture: TestingModule = await Test.createTestingModule({
            controllers: [ClientDraftController],
            providers: [{ provide: CallInboxService, useValue: callInboxService }],
        })
            .overrideGuard(JwtGuard).useValue(mockGuard)
            .overrideGuard(TenantGuard).useValue(mockGuard)
            .compile();

        app = moduleFixture.createNestApplication();
        app.useGlobalPipes(new ValidationPipe({
            whitelist: true,
            forbidNonWhitelisted: true,
            transform: true,
        }));
        await app.init();
    });

    afterEach(async () => { await app?.close(); });

    it("GET /client-drafts?status=PENDING&page=2&limit=10 calls listDrafts with correct branch + paging", async () => {
        const mockResult = { data: [], total: 0, page: 2, limit: 10, totalPages: 0 };
        callInboxService.listDrafts.mockResolvedValue(mockResult);

        const res = await request(app.getHttpServer())
            .get("/client-drafts?status=PENDING&page=2&limit=10");

        expect(res.status).toBe(200);
        expect(callInboxService.listDrafts).toHaveBeenCalledWith("branch-1", "PENDING", 2, 10);
    });

    it("GET /client-drafts/count calls countDrafts (not getDraft with id='count') — route-order regression", async () => {
        callInboxService.countDrafts.mockResolvedValue({ count: 5 });

        const res = await request(app.getHttpServer()).get("/client-drafts/count");

        expect(res.status).toBe(200);
        expect(res.body).toEqual({ count: 5 });
        expect(callInboxService.countDrafts).toHaveBeenCalled();
        expect(callInboxService.getDraft).not.toHaveBeenCalled();
    });

    it("POST /client-drafts/draft-1/confirm (NEW_CLIENT) calls confirm with correct args", async () => {
        const body = { fields: { name: "김서연", careCenter: false, voucherClient: false, breastPump: false } };
        callInboxService.confirm.mockResolvedValue({ clientId: 42 });

        const res = await request(app.getHttpServer())
            .post("/client-drafts/draft-1/confirm")
            .send(body);

        expect(res.status).toBe(201);
        expect(res.body).toEqual({ clientId: 42 });
        expect(callInboxService.confirm).toHaveBeenCalledWith(
            "branch-1",
            "user-1",
            "draft-1",
            expect.objectContaining({ fields: body.fields }),
        );
    });

    it("POST /client-drafts/draft-1/confirm rejects unknown NEW_CLIENT nested fields at the DTO boundary", async () => {
        const body = {
            fields: {
                name: "김서연",
                voucherClient: false,
                breastPump: false,
                unexpected: "reject-me",
            },
        };

        const res = await request(app.getHttpServer())
            .post("/client-drafts/draft-1/confirm")
            .send(body);

        expect(res.status).toBe(400);
        expect(callInboxService.confirm).not.toHaveBeenCalled();
    });

    it("POST /client-drafts/draft-2/confirm (CLIENT_UPDATE) passes changes through to confirm", async () => {
        const body = { changes: { startDate: "2026-06-23", serviceStatus: "replacement_requested" } };
        callInboxService.confirm.mockResolvedValue({ clientId: 99 });

        const res = await request(app.getHttpServer())
            .post("/client-drafts/draft-2/confirm")
            .send(body);

        expect(res.status).toBe(201);
        expect(res.body).toEqual({ clientId: 99 });
        expect(callInboxService.confirm).toHaveBeenCalledWith(
            "branch-1",
            "user-1",
            "draft-2",
            expect.objectContaining({ changes: body.changes }),
        );
    });

    it("POST /client-drafts/draft-1/discard passes reason to discard", async () => {
        callInboxService.discard.mockResolvedValue({ id: "draft-1", status: "DISCARDED" });

        const res = await request(app.getHttpServer())
            .post("/client-drafts/draft-1/discard")
            .send({ reason: "오인식" });

        expect(res.status).toBe(201);
        expect(callInboxService.discard).toHaveBeenCalledWith("branch-1", "user-1", "draft-1", "오인식");
    });

    it("service exceptions propagate with correct HTTP status", async () => {
        const { ConflictException } = await import("@nestjs/common");
        callInboxService.confirm.mockRejectedValue(new ConflictException("Draft already reviewed"));

        const res = await request(app.getHttpServer())
            .post("/client-drafts/draft-3/confirm")
            .send({ changes: { startDate: "2026-06-23" } });

        expect(res.status).toBe(409);
    });
});
