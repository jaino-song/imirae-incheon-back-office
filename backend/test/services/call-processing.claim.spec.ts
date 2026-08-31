import { CallProcessingService } from "application/services/call-processing.service";
import { CallExtractionResult } from "domain/ports/call-extraction.port";

type ProcessingStatus = "RECEIVED" | "FAILED" | "PROCESSING" | "EXTRACTED";

type CallRecordState = {
    id: string;
    branchId: string;
    fileName: string;
    transcript: unknown;
    summary: unknown;
    processingStatus: ProcessingStatus;
    processingClaimedAt: Date | null;
    extractionRetryCount: number;
    category: string | null;
    callerName: string | null;
    callerPhone: string | null;
    matchedClientId: number | null;
    failureReason: string | null;
};

function extraction(partial: Partial<CallExtractionResult> = {}): CallExtractionResult {
    return {
        category: "NEW_CONSULTATION",
        callerName: "김서연",
        callerPhoneCandidates: ["010-4821-7763"],
        requestSummary: "신규 문의",
        proposals: [{ field: "name", value: "김서연", evidence: "e", confidence: "high" }],
        ...partial,
    };
}

function createState(overrides: Partial<CallRecordState> = {}) {
    const record: CallRecordState = {
        id: "rec-1",
        branchId: "branch-1",
        fileName: "call.m4a",
        transcript: [],
        summary: null,
        processingStatus: "RECEIVED",
        processingClaimedAt: null,
        extractionRetryCount: 0,
        category: null,
        callerName: null,
        callerPhone: null,
        matchedClientId: null,
        failureReason: null,
        ...overrides,
    };
    const drafts: Array<{ callRecordId: string; type: string; proposals: unknown }> = [];

    const prisma = {
        call_record: {
            findUnique: jest.fn(async () => ({ ...record })),
            updateMany: jest.fn(async ({ where, data }: {
                where: {
                    id: string;
                    processingStatus?: ProcessingStatus;
                    processingClaimedAt?: Date | null;
                    extractionRetryCount?: number;
                };
                data: Partial<CallRecordState>;
            }) => {
                if (where.id !== record.id
                    || (where.processingStatus !== undefined && where.processingStatus !== record.processingStatus)
                    || (where.processingClaimedAt !== undefined
                        && where.processingClaimedAt?.getTime() !== record.processingClaimedAt?.getTime())
                    || (where.extractionRetryCount !== undefined && where.extractionRetryCount !== record.extractionRetryCount)) {
                    return { count: 0 };
                }
                Object.assign(record, data);
                return { count: 1 };
            }),
        },
        client: {
            findMany: jest.fn().mockResolvedValue([]),
        },
        client_draft: {
            createMany: jest.fn(async ({ data }: { data: { callRecordId: string; type: string; proposals: unknown } }) => {
                if (drafts.some((draft) => draft.callRecordId === data.callRecordId)) return { count: 0 };
                drafts.push(data);
                return { count: 1 };
            }),
        },
        $transaction: jest.fn(),
    };
    prisma.$transaction.mockImplementation(async (callback: (transaction: unknown) => Promise<unknown>) => callback(prisma));

    return { record, drafts, prisma };
}

function waitForExtraction(extract: jest.Mock): Promise<void> {
    return new Promise((resolve) => {
        const poll = () => extract.mock.calls.length > 0 ? resolve() : setImmediate(poll);
        poll();
    });
}

describe("CallProcessingService processing claim", () => {
    afterEach(() => {
        jest.restoreAllMocks();
    });

    it("refuses a fresh active PROCESSING claim without invoking extraction", async () => {
        const { record, prisma } = createState({
            processingStatus: "PROCESSING",
            processingClaimedAt: new Date("2026-08-27T12:00:00.000Z"),
        });
        const extractionPort = { extract: jest.fn() };
        const service = new CallProcessingService(
            prisma as never,
            extractionPort as never,
            { refine: jest.fn() } as never,
        );

        await expect(service.processCallRecord("rec-1")).resolves.toBe("in_progress");

        expect(extractionPort.extract).not.toHaveBeenCalled();
        expect(prisma.call_record.updateMany).not.toHaveBeenCalled();
        expect(record.processingStatus).toBe("PROCESSING");
    });

    it("allows only one concurrent processor to extract and publish a draft", async () => {
        const { record, drafts, prisma } = createState();
        const extractionPort = { extract: jest.fn() };
        let resolveExtraction!: (result: CallExtractionResult) => void;
        extractionPort.extract.mockReturnValue(new Promise<CallExtractionResult>((resolve) => {
            resolveExtraction = resolve;
        }));
        const service = new CallProcessingService(
            prisma as never,
            extractionPort as never,
            { refine: jest.fn() } as never,
        );

        const winner = service.processCallRecord("rec-1");
        await waitForExtraction(extractionPort.extract);
        const loser = await service.processCallRecord("rec-1");

        expect(loser).toBe("in_progress");
        expect(extractionPort.extract).toHaveBeenCalledTimes(1);
        resolveExtraction(extraction());
        expect(await winner).toBe("processed");
        expect(record.processingStatus).toBe("EXTRACTED");
        expect(record.processingClaimedAt).toBeNull();
        expect(drafts).toHaveLength(1);
        expect(prisma.client_draft.createMany).toHaveBeenCalledTimes(1);
        expect(prisma.call_record.updateMany).toHaveBeenCalledWith(expect.objectContaining({
            data: expect.objectContaining({
                processingStatus: "PROCESSING",
                processingClaimedAt: expect.any(Date),
            }),
        }));
        expect(prisma.call_record.updateMany).toHaveBeenCalledWith(expect.objectContaining({
            data: expect.objectContaining({
                processingStatus: "EXTRACTED",
                processingClaimedAt: null,
            }),
        }));
    });

    it("reuses an existing draft when a unique-draft race has already published the winner", async () => {
        const { record, drafts, prisma } = createState();
        drafts.push({
            callRecordId: "rec-1",
            type: "NEW_CLIENT",
            proposals: [{ field: "name", value: "winner" }],
        });
        const extractionPort = { extract: jest.fn().mockResolvedValue(extraction()) };
        const service = new CallProcessingService(
            prisma as never,
            extractionPort as never,
            { refine: jest.fn() } as never,
        );

        await expect(service.processCallRecord("rec-1")).resolves.toBe("processed");

        expect(record.processingStatus).toBe("EXTRACTED");
        expect(record.failureReason).toBeNull();
        expect(drafts).toHaveLength(1);
        expect(prisma.call_record.updateMany).not.toHaveBeenCalledWith(expect.objectContaining({
            data: expect.objectContaining({ processingStatus: "FAILED" }),
        }));
        expect(prisma.client_draft.createMany).toHaveBeenCalledWith(expect.objectContaining({
            skipDuplicates: true,
        }));
    });

    it("fences stale-owner completion after a newer retry generation succeeds", async () => {
        const { record, drafts, prisma } = createState();
        const firstExtraction = jest.fn();
        const secondExtraction = jest.fn();
        let resolveFirst!: (result: CallExtractionResult) => void;
        let resolveSecond!: (result: CallExtractionResult) => void;
        firstExtraction.mockReturnValue(new Promise<CallExtractionResult>((resolve) => {
            resolveFirst = resolve;
        }));
        secondExtraction.mockReturnValue(new Promise<CallExtractionResult>((resolve) => {
            resolveSecond = resolve;
        }));
        const first = new CallProcessingService(
            prisma as never,
            { extract: firstExtraction } as never,
            { refine: jest.fn() } as never,
        );
        const second = new CallProcessingService(
            prisma as never,
            { extract: secondExtraction } as never,
            { refine: jest.fn() } as never,
        );

        const staleOwner = first.processCallRecord("rec-1");
        await waitForExtraction(firstExtraction);

        // A recovered retry generation may only publish under its own version.
        // This simulates the old owner being left behind while generation 1 is retried.
        record.processingStatus = "FAILED";
        record.processingClaimedAt = null;
        record.extractionRetryCount = 1;
        const currentOwner = second.processCallRecord("rec-1");
        await waitForExtraction(secondExtraction);
        resolveSecond(extraction({ requestSummary: "retry winner" }));
        expect(await currentOwner).toBe("processed");

        resolveFirst(extraction({ requestSummary: "stale owner" }));
        expect(await staleOwner).toBe("already_processed");

        expect(record.processingStatus).toBe("EXTRACTED");
        expect(record.failureReason).toBeNull();
        expect(drafts).toHaveLength(1);
        expect(drafts[0]?.proposals).toEqual(extraction({ requestSummary: "retry winner" }).proposals);
    });

    it("rejects a stale completion when the claim timestamp changes within one generation", async () => {
        const { record, drafts, prisma } = createState();
        const firstExtraction = jest.fn();
        const secondExtraction = jest.fn();
        let resolveFirst!: (result: CallExtractionResult) => void;
        let resolveSecond!: (result: CallExtractionResult) => void;
        firstExtraction.mockReturnValue(new Promise<CallExtractionResult>((resolve) => {
            resolveFirst = resolve;
        }));
        secondExtraction.mockReturnValue(new Promise<CallExtractionResult>((resolve) => {
            resolveSecond = resolve;
        }));
        const nowSpy = jest.spyOn(Date, "now")
            .mockReturnValueOnce(1_000)
            .mockReturnValue(2_000);
        const stale = new CallProcessingService(
            prisma as never,
            { extract: firstExtraction } as never,
            { refine: jest.fn() } as never,
        );
        const current = new CallProcessingService(
            prisma as never,
            { extract: secondExtraction } as never,
            { refine: jest.fn() } as never,
        );

        const staleOwner = stale.processCallRecord("rec-1");
        await waitForExtraction(firstExtraction);

        // A manual status recovery that does not advance the generation must still
        // invalidate the old owner through the claim timestamp fence.
        record.processingStatus = "RECEIVED";
        record.processingClaimedAt = null;
        const currentOwner = current.processCallRecord("rec-1");
        await waitForExtraction(secondExtraction);

        resolveFirst(extraction({ requestSummary: "stale owner" }));
        expect(await staleOwner).toBe("in_progress");

        resolveSecond(extraction({ requestSummary: "current owner" }));
        expect(await currentOwner).toBe("processed");

        expect(record.processingStatus).toBe("EXTRACTED");
        expect(record.processingClaimedAt).toBeNull();
        expect(drafts).toHaveLength(1);
        expect(prisma.call_record.updateMany).toHaveBeenCalledWith(expect.objectContaining({
            where: expect.objectContaining({
                extractionRetryCount: 0,
                processingClaimedAt: new Date(1_000),
            }),
        }));
        nowSpy.mockRestore();
    });

    it("does not let a losing invocation turn a successful winner into FAILED", async () => {
        const { record, prisma } = createState();
        const extractionPort = { extract: jest.fn().mockResolvedValue(extraction()) };
        const service = new CallProcessingService(
            prisma as never,
            extractionPort as never,
            { refine: jest.fn() } as never,
        );

        const winner = await service.processCallRecord("rec-1");
        const loser = await service.processCallRecord("rec-1");

        expect(winner).toBe("processed");
        expect(loser).toBe("already_processed");
        expect(record.processingStatus).toBe("EXTRACTED");
        expect(record.failureReason).toBeNull();
        expect(prisma.call_record.updateMany).not.toHaveBeenCalledWith(expect.objectContaining({
            data: expect.objectContaining({ processingStatus: "FAILED" }),
        }));
    });

    it("does not let a stale owner's extraction exception overwrite a newer winner", async () => {
        const { record, drafts, prisma } = createState();
        const staleExtraction = jest.fn();
        let rejectStale!: (error: Error) => void;
        staleExtraction.mockReturnValue(new Promise<CallExtractionResult>((_resolve, reject) => {
            rejectStale = reject;
        }));
        const stale = new CallProcessingService(
            prisma as never,
            { extract: staleExtraction } as never,
            { refine: jest.fn() } as never,
        );

        const staleOwner = stale.processCallRecord("rec-1");
        await waitForExtraction(staleExtraction);

        record.processingStatus = "FAILED";
        record.processingClaimedAt = null;
        record.extractionRetryCount = 1;
        const winner = new CallProcessingService(
            prisma as never,
            { extract: jest.fn().mockResolvedValue(extraction({ requestSummary: "winner" })) } as never,
            { refine: jest.fn() } as never,
        );
        expect(await winner.processCallRecord("rec-1")).toBe("processed");

        rejectStale(new Error("late provider exception"));
        expect(await staleOwner).toBe("already_processed");
        expect(record.processingStatus).toBe("EXTRACTED");
        expect(drafts).toHaveLength(1);
        expect(prisma.call_record.updateMany).toHaveBeenCalledWith(expect.objectContaining({
            where: expect.objectContaining({
                id: "rec-1",
                processingStatus: "PROCESSING",
                processingClaimedAt: expect.any(Date),
                extractionRetryCount: 0,
            }),
            data: expect.objectContaining({ processingStatus: "FAILED", processingClaimedAt: null }),
        }));
    });

    it("marks a genuine extraction failure and permits the bounded retry to succeed", async () => {
        const { record, drafts, prisma } = createState();
        const extractionPort = { extract: jest.fn()
            .mockRejectedValueOnce(new Error("provider unavailable"))
            .mockResolvedValueOnce(extraction()) };
        const service = new CallProcessingService(
            prisma as never,
            extractionPort as never,
            { refine: jest.fn() } as never,
        );

        await expect(service.processCallRecord("rec-1")).resolves.toBe("failed");
        expect(record.processingStatus).toBe("FAILED");
        expect(record.processingClaimedAt).toBeNull();
        expect(record.failureReason).toContain("provider unavailable");

        await expect(service.processCallRecord("rec-1")).resolves.toBe("processed");
        expect(record.processingStatus).toBe("EXTRACTED");
        expect(record.processingClaimedAt).toBeNull();
        expect(record.failureReason).toBeNull();
        expect(drafts).toHaveLength(1);
        expect(extractionPort.extract).toHaveBeenCalledTimes(2);
    });
});
