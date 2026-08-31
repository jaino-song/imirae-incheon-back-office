import { INestApplication } from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import request from "supertest";
import { CallTranscriptWebhookController } from "interface/controllers/call-transcript-webhook.controller";
import { CallIngestionService } from "application/services/call-ingestion.service";
import { CallIngestTokenService } from "application/services/call-ingest-token.service";
import { CallIngestGuard } from "infrastructure/auth/call-ingest.guard";
import { GlobalValidationPipe } from "infrastructure/pipes/global-validation.pipe";

describe("CallTranscriptWebhookController (Integration)", () => {
    let app: INestApplication;
    let ingestionService: jest.Mocked<Pick<CallIngestionService, "ingest">>;
    let tokenService: jest.Mocked<Pick<CallIngestTokenService, "resolveBranchId">>;

    const payload = {
        driveFileId: "drive-1",
        fileName: "통화 녹음 김서연_010-4821-7763.m4a",
        sttModel: "gemini-3.5-transcribe",
        diarized: true,
        vocabularyVersion: "v1",
        transcriptRaw: [{ speaker: "1", text: "산후도우미 문의요" }],
    };

    beforeEach(async () => {
        ingestionService = { ingest: jest.fn() };
        tokenService = { resolveBranchId: jest.fn() };

        const moduleFixture: TestingModule = await Test.createTestingModule({
            controllers: [CallTranscriptWebhookController],
            providers: [
                CallIngestGuard,
                { provide: CallIngestionService, useValue: ingestionService },
                { provide: CallIngestTokenService, useValue: tokenService },
            ],
        }).compile();

        app = moduleFixture.createNestApplication();
        app.useGlobalPipes(new GlobalValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
        await app.init();
    });

    afterEach(async () => { await app.close(); });

    it("202 + accepted on a fresh file, branch comes from the token", async () => {
        tokenService.resolveBranchId.mockResolvedValue("branch-1");
        ingestionService.ingest.mockResolvedValue({ duplicate: false, callRecordId: "rec-1" });

        const response = await request(app.getHttpServer())
            .post("/webhooks/call-transcripts")
            .set({ Authorization: "Bearer cit_valid" })
            .send(payload);

        expect(response.status).toBe(202);
        expect(response.body).toEqual({ accepted: true, duplicate: false, callRecordId: "rec-1" });
        expect(ingestionService.ingest).toHaveBeenCalledWith(
            "branch-1",
            expect.objectContaining({ driveFileId: "drive-1" }),
        );
    });

    it("200 no-op on duplicate", async () => {
        tokenService.resolveBranchId.mockResolvedValue("branch-1");
        ingestionService.ingest.mockResolvedValue({ duplicate: true, callRecordId: "rec-1" });

        const response = await request(app.getHttpServer())
            .post("/webhooks/call-transcripts")
            .set({ Authorization: "Bearer cit_valid" })
            .send(payload);

        expect(response.status).toBe(200);
        expect(response.body).toEqual({ accepted: true, duplicate: true, callRecordId: "rec-1" });
    });

    it("401 without a valid token", async () => {
        tokenService.resolveBranchId.mockResolvedValue(null);
        const response = await request(app.getHttpServer())
            .post("/webhooks/call-transcripts")
            .set({ Authorization: "Bearer cit_bad" })
            .send(payload);
        expect(response.status).toBe(401);
        expect(ingestionService.ingest).not.toHaveBeenCalled();
    });

    it("400 on invalid payload (missing required v2 fields)", async () => {
        tokenService.resolveBranchId.mockResolvedValue("branch-1");
        const response = await request(app.getHttpServer())
            .post("/webhooks/call-transcripts")
            .set({ Authorization: "Bearer cit_valid" })
            .send({ driveFileId: "drive-1", fileName: "x.m4a" });
        expect(response.status).toBe(400);
    });

    it("400 on calendar-impossible recordedAt", async () => {
        tokenService.resolveBranchId.mockResolvedValue("branch-1");
        const response = await request(app.getHttpServer())
            .post("/webhooks/call-transcripts")
            .set({ Authorization: "Bearer cit_valid" })
            .send({ ...payload, recordedAt: "2026-02-31T10:00:00.000Z" });
        expect(response.status).toBe(400);
        expect(ingestionService.ingest).not.toHaveBeenCalled();
    });
});
