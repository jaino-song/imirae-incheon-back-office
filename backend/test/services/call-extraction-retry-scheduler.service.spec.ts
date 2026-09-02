import { CallExtractionRetrySchedulerService } from "application/services/call-extraction-retry-scheduler.service";
import { createSchedulerLeaseMock } from "../utils/mocks/scheduler-lease.mock";

const CALL_PROCESSING_CLAIM_LEASE_MS = 10 * 60 * 1000;
const MAX_ATTEMPTS = 3;

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
        scheduler = new CallExtractionRetrySchedulerService(
            prisma as never,
            processingService as never,
            createSchedulerLeaseMock(),
        );
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    it("retries FAILED records under the attempt cap and stuck RECEIVED records", async () => {
        prisma.call_record.findMany.mockResolvedValue([
            { id: "rec-1", extractionRetryCount: 1, processingStatus: "FAILED", processingClaimedAt: null },
            { id: "rec-2", extractionRetryCount: 0, processingStatus: "RECEIVED", processingClaimedAt: null },
        ]);

        await scheduler.retryFailedExtractions();

        // FAILED row: reset to RECEIVED + increment counter, then process
        expect(prisma.call_record.updateMany).toHaveBeenCalledWith({
            where: { id: "rec-1", processingStatus: "FAILED", extractionRetryCount: 1 },
            data: {
                extractionRetryCount: { increment: 1 },
                processingStatus: "RECEIVED",
                processingClaimedAt: null,
            },
        });
        // RECEIVED stuck row: only re-process, do NOT increment counter
        expect(prisma.call_record.updateMany).not.toHaveBeenCalledWith(
            expect.objectContaining({ where: { id: "rec-2" } }),
        );
        expect(processingService.processCallRecord).toHaveBeenCalledWith("rec-1");
        expect(processingService.processCallRecord).toHaveBeenCalledWith("rec-2");
    });

    it("reclaims an expired PROCESSING claim with a generation CAS", async () => {
        const now = new Date("2026-08-27T12:00:00.000Z");
        const expiredAt = new Date(now.getTime() - CALL_PROCESSING_CLAIM_LEASE_MS - 1);
        const nowSpy = jest.spyOn(Date, "now").mockReturnValue(now.getTime());
        prisma.call_record.findMany.mockResolvedValue([
            {
                id: "rec-1",
                extractionRetryCount: 0,
                processingStatus: "PROCESSING",
                processingClaimedAt: expiredAt,
            },
        ]);

        await scheduler.retryFailedExtractions();

        expect(prisma.call_record.updateMany).toHaveBeenCalledWith({
            where: {
                id: "rec-1",
                processingStatus: "PROCESSING",
                processingClaimedAt: expiredAt,
                extractionRetryCount: 0,
            },
            data: {
                extractionRetryCount: { increment: 1 },
                processingStatus: "RECEIVED",
                processingClaimedAt: null,
            },
        });
        expect(processingService.processCallRecord).toHaveBeenCalledWith("rec-1");
        expect(prisma.call_record.findMany).toHaveBeenCalledWith(expect.objectContaining({
            where: expect.objectContaining({
                OR: expect.arrayContaining([
                    expect.objectContaining({
                        processingStatus: "PROCESSING",
                        processingClaimedAt: { lt: expect.any(Date) },
                    }),
                ]),
            }),
        }));

        nowSpy.mockRestore();
    });

    it("does not reclaim a fresh PROCESSING claim", async () => {
        const now = new Date("2026-08-27T12:00:00.000Z");
        const freshAt = new Date(now.getTime() - CALL_PROCESSING_CLAIM_LEASE_MS + 1);
        const nowSpy = jest.spyOn(Date, "now").mockReturnValue(now.getTime());
        prisma.call_record.findMany.mockResolvedValue([
            {
                id: "rec-1",
                extractionRetryCount: 0,
                processingStatus: "PROCESSING",
                processingClaimedAt: freshAt,
            },
        ]);

        await scheduler.retryFailedExtractions();

        const query = prisma.call_record.findMany.mock.calls[0]?.[0];
        const processingPredicate = query?.where?.OR?.find(
            (predicate: { processingStatus?: string }) => predicate.processingStatus === "PROCESSING",
        );
        expect(processingPredicate).toEqual({
            processingStatus: "PROCESSING",
            processingClaimedAt: { lt: new Date(now.getTime() - CALL_PROCESSING_CLAIM_LEASE_MS) },
        });
        expect(prisma.call_record.updateMany).not.toHaveBeenCalled();
        expect(processingService.processCallRecord).not.toHaveBeenCalled();
        nowSpy.mockRestore();
    });

    it("terminally fails an expired PROCESSING claim at the retry cap", async () => {
        const now = new Date("2026-08-27T12:00:00.000Z");
        const expiredAt = new Date(now.getTime() - CALL_PROCESSING_CLAIM_LEASE_MS - 1);
        const nowSpy = jest.spyOn(Date, "now").mockReturnValue(now.getTime());
        prisma.call_record.findMany.mockResolvedValue([
            {
                id: "rec-1",
                extractionRetryCount: MAX_ATTEMPTS,
                processingStatus: "PROCESSING",
                processingClaimedAt: expiredAt,
            },
        ]);

        await scheduler.retryFailedExtractions();

        expect(prisma.call_record.updateMany).toHaveBeenCalledWith({
            where: {
                id: "rec-1",
                processingStatus: "PROCESSING",
                processingClaimedAt: expiredAt,
                extractionRetryCount: MAX_ATTEMPTS,
            },
            data: {
                processingStatus: "FAILED",
                processingClaimedAt: null,
                failureReason: "processing claim lease expired after retry limit",
            },
        });
        expect(processingService.processCallRecord).not.toHaveBeenCalled();
        nowSpy.mockRestore();
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
            { id: "rec-1", extractionRetryCount: 0, processingStatus: "RECEIVED", processingClaimedAt: null },
            { id: "rec-2", extractionRetryCount: 0, processingStatus: "RECEIVED", processingClaimedAt: null },
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
            { id: "rec-1", extractionRetryCount: 2, processingStatus: "FAILED", processingClaimedAt: null },
        ]);
        prisma.call_record.updateMany.mockResolvedValue({ count: 0 });

        await scheduler.retryFailedExtractions();

        expect(prisma.call_record.updateMany).toHaveBeenCalledWith({
            where: { id: "rec-1", processingStatus: "FAILED", extractionRetryCount: 2 },
            data: {
                extractionRetryCount: { increment: 1 },
                processingStatus: "RECEIVED",
                processingClaimedAt: null,
            },
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

    it("skips the run when the scheduler lease is not held", async () => {
        scheduler = new CallExtractionRetrySchedulerService(
            prisma as never,
            processingService as never,
            createSchedulerLeaseMock(false),
        );

        await scheduler.retryFailedExtractions();

        expect(prisma.call_record.findMany).not.toHaveBeenCalled();
    });
});
