import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { FILE_STORAGE_PORT } from "domain/ports/file-storage.port";
import { RateLimitGuard } from "infrastructure/auth/rate-limit.guard";
import { ReceiptLinkTokenService } from "application/services/receipt-link-token.service";
import { ReceiptLinkController } from "interface/controllers/receipt-link.controller";
import { GlobalValidationPipe } from "infrastructure/pipes/global-validation.pipe";

describe("ReceiptLinkController", () => {
    let app: INestApplication;
    const tokenService = { getStatus: jest.fn(), verifyBirthday: jest.fn(), resolveAccess: jest.fn() };
    const storage = { download: jest.fn() };

    beforeAll(async () => {
        const moduleRef = await Test.createTestingModule({
            controllers: [ReceiptLinkController],
            providers: [
                { provide: ReceiptLinkTokenService, useValue: tokenService },
                { provide: FILE_STORAGE_PORT, useValue: storage },
            ],
        })
            .overrideGuard(RateLimitGuard)
            .useValue({ canActivate: () => true })
            .compile();
        app = moduleRef.createNestApplication();
        app.useGlobalPipes(new GlobalValidationPipe());
        await app.init();
    });

    afterAll(async () => {
        await app.close();
    });

    beforeEach(() => jest.clearAllMocks());

    it("GET status maps expired links to 410 and unknown links to 404", async () => {
        tokenService.getStatus.mockResolvedValueOnce({ ok: false, reason: "expired" });
        await request(app.getHttpServer()).get("/receipt-links/efr_x/status").expect(410, { reason: "expired" });
        tokenService.getStatus.mockResolvedValueOnce({ ok: false, reason: "not_found" });
        await request(app.getHttpServer()).get("/receipt-links/efr_x/status").expect(404, { reason: "not_found" });
        tokenService.getStatus.mockResolvedValueOnce({ ok: true, state: "pending", branchName: "인천 아이미래로", expiresAt: "2026-10-03T00:00:00.000Z", remainingAttempts: 5, lockedUntil: null });
        await request(app.getHttpServer()).get("/receipt-links/efr_x/status").expect(200).expect((res) => expect(res.body.branchName).toBe("인천 아이미래로"));
    });

    it("POST verify returns 401 with remaining attempts, 423 when locked, 200 with the access token", async () => {
        tokenService.verifyBirthday.mockResolvedValueOnce({ ok: false, reason: "verification_failed", remainingAttempts: 3 });
        await request(app.getHttpServer()).post("/receipt-links/efr_x/verify").send({ birthday: "000000" }).expect(401, { reason: "verification_failed", remainingAttempts: 3 });
        tokenService.verifyBirthday.mockResolvedValueOnce({ ok: false, reason: "locked", lockedUntil: "2026-09-03T01:00:00.000Z" });
        await request(app.getHttpServer()).post("/receipt-links/efr_x/verify").send({ birthday: "000000" }).expect(423, { reason: "locked", lockedUntil: "2026-09-03T01:00:00.000Z" });
        tokenService.verifyBirthday.mockResolvedValueOnce({ ok: true, accessToken: "efra_a", clientName: "김산모" });
        await request(app.getHttpServer()).post("/receipt-links/efr_x/verify").send({ birthday: "940315" }).expect(200, { ok: true, accessToken: "efra_a", clientName: "김산모" });
        await request(app.getHttpServer()).post("/receipt-links/efr_x/verify").send({}).expect(400);
    });

    it("GET image requires the access token and streams the png with a download disposition on demand", async () => {
        await request(app.getHttpServer()).get("/receipt-links/efr_x/image").expect(401);
        tokenService.resolveAccess.mockResolvedValue({ id: "t", storagePath: "receipts/b/1/a.png", clientName: "김산모", expiresAt: new Date() });
        storage.download.mockResolvedValue(Buffer.from("png"));

        const inline = await request(app.getHttpServer()).get("/receipt-links/efr_x/image").set("X-Receipt-Access-Token", "efra_a").expect(200);
        expect(inline.headers["content-type"]).toBe("image/png");
        expect(inline.headers["content-disposition"]).toMatch(/^inline;/);
        expect(inline.headers["cache-control"]).toBe("private, no-store");

        const download = await request(app.getHttpServer()).get("/receipt-links/efr_x/image?download=1").set("Authorization", "Bearer efra_a").expect(200);
        expect(download.headers["content-disposition"]).toMatch(/^attachment; filename="[^"]+"; filename\*=UTF-8''%EC%98%81%EC%88%98%EC%A6%9D_/);
        expect(tokenService.resolveAccess).toHaveBeenLastCalledWith("efr_x", "efra_a", expect.any(Date));
    });
});
