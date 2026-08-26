import { CallExtractionRetrySchedulerService } from "application/services/call-extraction-retry-scheduler.service";

describe("CallExtractionRetrySchedulerService", () => {
    const prisma = {
        call_record: { findMany: jest.fn(), updateMany: jest.fn() },
        client_draft: { updateMany: jest.fn() },
    };
    const processingService = { processCallRecord: jest.fn() };
    let scheduler: CallExtractionRetrySchedulerService;

    beforeEach(() => {
        jest.resetAllMocks();
        prisma.call_record.updateMany.mockResolvedValue({ count: 1 });
        prisma.client_draft.updateMany.mockResolvedValue({ count: 0 });
        processingService.processCallRecord.mockResolvedValue(undefined);
        scheduler = new CallExtractionRetrySchedulerService(prisma as never, processingService as never);
    });

    it("retries FAILED records under the attempt cap and stuck RECEIVED records", async () => {
        prisma.call_record.findMany.mockResolvedValue([
            { id: "rec-1", extractionRetryCount: 1, processingStatus: "FAILED" },
            { id: "rec-2", extractionRetryCount: 0, processingStatus: "RECEIVED" },
        ]);

        await scheduler.retryFailedExtractions();

        // FAILED row: reset to RECEIVED + increment counter, then process
        expect(prisma.call_record.updateMany).toHaveBeenCalledWith({
            where: { id: "rec-1", processingStatus: "FAILED", extractionRetryCount: 1 },
            data: { extractionRetryCount: { increment: 1 }, processingStatus: "RECEIVED" },
        });
        // RECEIVED stuck row: only re-process, do NOT increment counter
        expect(prisma.call_record.updateMany).not.toHaveBeenCalledWith(
            expect.objectContaining({ where: { id: "rec-2" } }),
        );
        expect(processingService.processCallRecord).toHaveBeenCalledWith("rec-1");
        expect(processingService.processCallRecord).toHaveBeenCalledWith("rec-2");
    });

    it("does nothing when no candidates but still runs the CONFIRMING sweep", async () => {
        prisma.call_record.findMany.mockResolvedValue([]);
        await scheduler.retryFailedExtractions();
        expect(processingService.processCallRecord).not.toHaveBeenCalled();
        expect(prisma.client_draft.updateMany).toHaveBeenCalledWith({
            where: {
                status: "CONFIRMING",
                OR: [
                    { confirmingStartedAt: { lt: expect.any(Date) } },
                    { confirmingStartedAt: null, createdAt: { lt: expect.any(Date) } },
                ],
            },
            data: { status: "PENDING", confirmingStartedAt: null },
        });
    });

    it("continues with remaining candidates when one throws", async () => {
        prisma.call_record.findMany.mockResolvedValue([
            { id: "rec-1", extractionRetryCount: 0, processingStatus: "RECEIVED" },
            { id: "rec-2", extractionRetryCount: 0, processingStatus: "RECEIVED" },
        ]);
        processingService.processCallRecord
            .mockRejectedValueOnce(new Error("unexpected"))
            .mockResolvedValueOnce(undefined);

        await scheduler.retryFailedExtractions();

        expect(processingService.processCallRecord).toHaveBeenCalledTimes(2);
        expect(processingService.processCallRecord).toHaveBeenLastCalledWith("rec-2");
    });

    it("does not process a FAILED snapshot that lost its generation CAS", async () => {
        prisma.call_record.findMany.mockResolvedValue([
            { id: "rec-1", extractionRetryCount: 2, processingStatus: "FAILED" },
        ]);
        prisma.call_record.updateMany.mockResolvedValue({ count: 0 });

        await scheduler.retryFailedExtractions();

        expect(prisma.call_record.updateMany).toHaveBeenCalledWith({
            where: { id: "rec-1", processingStatus: "FAILED", extractionRetryCount: 2 },
            data: { extractionRetryCount: { increment: 1 }, processingStatus: "RECEIVED" },
        });
        expect(processingService.processCallRecord).not.toHaveBeenCalled();
    });

    it("sweeps stale CONFIRMING drafts back to PENDING", async () => {
        prisma.call_record.findMany.mockResolvedValue([]);
        prisma.client_draft.updateMany.mockResolvedValue({ count: 2 });

        await scheduler.retryFailedExtractions();

        expect(prisma.client_draft.updateMany).toHaveBeenCalledWith({
            where: {
                status: "CONFIRMING",
                OR: [
                    { confirmingStartedAt: { lt: expect.any(Date) } },
                    { confirmingStartedAt: null, createdAt: { lt: expect.any(Date) } },
                ],
            },
            data: { status: "PENDING", confirmingStartedAt: null },
        });
    });
});
