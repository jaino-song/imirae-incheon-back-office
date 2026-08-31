import { CallIngestionService } from "application/services/call-ingestion.service";

describe("CallIngestionService", () => {
    const prisma = {
        call_record: { findUnique: jest.fn(), create: jest.fn() },
    };
    const processingService = { processCallRecord: jest.fn() };
    let service: CallIngestionService;

    const payload = {
        driveFileId: "drive-1",
        fileName: "통화 녹음 김서연_010-4821-7763.m4a",
        recordedAt: "2026-06-10T05:02:11.000Z",
        sttModel: "gemini-3.5-transcribe",
        diarized: true,
        vocabularyVersion: "v1",
        transcriptRaw: [{ speaker: "1", text: "산후도우미 문의요" }],
    };

    beforeEach(() => {
        jest.resetAllMocks();
        processingService.processCallRecord.mockResolvedValue(undefined);
        service = new CallIngestionService(prisma as never, processingService as never);
    });

    it("creates a RECEIVED call_record and kicks off processing", async () => {
        prisma.call_record.findUnique.mockResolvedValue(null);
        prisma.call_record.create.mockResolvedValue({ id: "rec-1" });

        const result = await service.ingest("branch-1", payload);

        expect(result).toEqual({ duplicate: false, callRecordId: "rec-1" });
        expect(prisma.call_record.create).toHaveBeenCalledWith({
            data: expect.objectContaining({
                branchId: "branch-1",
                driveFileId: "drive-1",
                fileName: payload.fileName,
                recordedAt: new Date(payload.recordedAt),
                transcript: payload.transcriptRaw,
                transcriptRaw: payload.transcriptRaw,
                sttMeta: {
                    sttModel: payload.sttModel,
                    diarized: payload.diarized,
                    vocabularyVersion: payload.vocabularyVersion,
                },
                processingStatus: "RECEIVED",
            }),
        });
        // summary is no longer received on the webhook — ingestion must not
        // touch the column at all (it stays null until extraction writes it).
        const createArgs = prisma.call_record.create.mock.calls[0][0];
        expect("summary" in createArgs.data).toBe(false);
        expect(processingService.processCallRecord).toHaveBeenCalledWith("rec-1");
    });

    it("is idempotent on driveFileId", async () => {
        prisma.call_record.findUnique.mockResolvedValue({ id: "rec-existing" });

        const result = await service.ingest("branch-1", payload);

        expect(result).toEqual({ duplicate: true, callRecordId: "rec-existing" });
        expect(prisma.call_record.create).not.toHaveBeenCalled();
        expect(processingService.processCallRecord).not.toHaveBeenCalled();
    });

    it("does not fail ingestion when processing kickoff rejects", async () => {
        prisma.call_record.findUnique.mockResolvedValue(null);
        prisma.call_record.create.mockResolvedValue({ id: "rec-1" });
        processingService.processCallRecord.mockRejectedValue(new Error("LLM down"));

        await expect(service.ingest("branch-1", payload)).resolves.toEqual({
            duplicate: false,
            callRecordId: "rec-1",
        });
    });

    it("returns duplicate when a concurrent create loses the unique race (P2002)", async () => {
        prisma.call_record.findUnique
            .mockResolvedValueOnce(null)                     // pre-check misses
            .mockResolvedValueOnce({ id: "rec-winner" });    // post-P2002 re-read
        const p2002 = Object.assign(new Error("Unique constraint failed"), { code: "P2002" });
        prisma.call_record.create.mockRejectedValue(p2002);

        await expect(service.ingest("branch-1", payload)).resolves.toEqual({
            duplicate: true,
            callRecordId: "rec-winner",
        });
        expect(processingService.processCallRecord).not.toHaveBeenCalled();
    });
});
