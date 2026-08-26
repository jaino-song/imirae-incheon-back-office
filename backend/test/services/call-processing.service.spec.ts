import { CallProcessingService } from "application/services/call-processing.service";
import { CALL_EXTRACTION_PROMPT_VERSION } from "application/services/call-extraction.prompt";
import { CallExtractionResult } from "domain/ports/call-extraction.port";

describe("CallProcessingService", () => {
    const prisma = {
        call_record: { findUnique: jest.fn(), updateMany: jest.fn() },
        client: { findMany: jest.fn() },
        client_draft: { createMany: jest.fn() },
        $transaction: jest.fn(),
    };
    const extractionPort = { extract: jest.fn() };
    let service: CallProcessingService;

    const record = {
        id: "rec-1",
        branchId: "branch-1",
        fileName: "통화 녹음 김서연_010-4821-7763.m4a",
        transcript: [{ speaker: "고객", text: "..." }],
        summary: null,
        processingStatus: "RECEIVED",
        extractionRetryCount: 0,
    };

    function extraction(partial: Partial<CallExtractionResult>): CallExtractionResult {
        return {
            category: "OTHER",
            callerName: null,
            callerPhoneCandidates: [],
            requestSummary: "요약",
            proposals: [],
            ...partial,
        };
    }

    beforeEach(() => {
        jest.resetAllMocks();
        prisma.call_record.findUnique.mockResolvedValue(record);
        prisma.client.findMany.mockResolvedValue([]);
        prisma.call_record.updateMany.mockResolvedValue({ count: 1 });
        prisma.client_draft.createMany.mockResolvedValue({ count: 1 });
        prisma.$transaction.mockImplementation(async (fn: (tx: unknown) => Promise<void>) => fn(prisma));
        service = new CallProcessingService(prisma as never, extractionPort as never);
    });

    it("OTHER: updates record, creates no draft (parking-call fixture)", async () => {
        extractionPort.extract.mockResolvedValue(extraction({
            category: "OTHER",
            requestSummary: "주차 정기권 차량 번호 변경 요청",
        }));

        await service.processCallRecord("rec-1");

        expect(prisma.client_draft.createMany).not.toHaveBeenCalled();
        expect(prisma.call_record.updateMany).toHaveBeenCalledWith(expect.objectContaining({
            where: expect.objectContaining({ id: "rec-1" }),
            data: expect.objectContaining({ category: "OTHER", processingStatus: "EXTRACTED" }),
        }));
    });

    it("NEW_CONSULTATION: creates a NEW_CLIENT draft with normalized phone (from transcript or filename)", async () => {
        extractionPort.extract.mockResolvedValue(extraction({
            category: "NEW_CONSULTATION",
            callerName: "김서연",
            callerPhoneCandidates: ["010-4821-7763"],
            requestSummary: "산후도우미 신규 문의",
            proposals: [
                { field: "name", value: "김서연", evidence: "김서연이요", confidence: "high" },
                { field: "duration", value: "10", evidence: "10일이요", confidence: "high" },
                { field: "careCenter", value: "false", evidence: "조리원은 안 가요", confidence: "high" },
                { field: "hairColor", value: "x", evidence: "x", confidence: "low" },
            ],
        }));

        await service.processCallRecord("rec-1");

        const draftData = prisma.client_draft.createMany.mock.calls[0][0].data;
        expect(draftData.type).toBe("NEW_CLIENT");
        expect(draftData.branchId).toBe("branch-1");
        expect(draftData.callRecordId).toBe("rec-1");
        expect(draftData.proposals).toEqual([
            { field: "name", value: "김서연", evidence: "김서연이요", confidence: "high" },
            { field: "duration", value: 10, evidence: "10일이요", confidence: "high" },
            { field: "careCenter", value: false, evidence: "조리원은 안 가요", confidence: "high" },
        ]);
        expect(draftData.extractionMeta).toEqual(expect.objectContaining({ promptVersion: CALL_EXTRACTION_PROMPT_VERSION }));
        expect(prisma.call_record.updateMany).toHaveBeenCalledWith(expect.objectContaining({
            data: expect.objectContaining({ callerPhone: "01048217763", callerName: "김서연" }),
        }));
    });

    it("CLIENT_SERVICE with phone match: links client on record and draft", async () => {
        prisma.client.findMany.mockResolvedValue([
            { id: 142, name: "박지은", phone: "010-2210-9987" },
        ]);
        extractionPort.extract.mockResolvedValue(extraction({
            category: "CLIENT_SERVICE",
            callerName: "박지은",
            callerPhoneCandidates: ["010 2210 9987"],
            requestSummary: "시작일 6/23 변경 요청",
            proposals: [
                { field: "startDate", value: "2026-06-23", evidence: "23일부터 가능할까요", confidence: "high" },
            ],
        }));

        await service.processCallRecord("rec-1");

        const draftData = prisma.client_draft.createMany.mock.calls[0][0].data;
        expect(draftData.type).toBe("CLIENT_UPDATE");
        expect(draftData.clientId).toBe(142);
        expect(prisma.call_record.updateMany).toHaveBeenCalledWith(expect.objectContaining({
            data: expect.objectContaining({ matchedClientId: 142 }),
        }));
    });

    it("CLIENT_SERVICE unmatched: draft created with clientId null", async () => {
        extractionPort.extract.mockResolvedValue(extraction({
            category: "CLIENT_SERVICE",
            requestSummary: "관리사 교체 요청",
            proposals: [
                { field: "serviceStatus", value: "replacement_requested", evidence: "교체해 주세요", confidence: "high" },
            ],
        }));

        await service.processCallRecord("rec-1");

        expect(prisma.client_draft.createMany.mock.calls[0][0].data.clientId).toBeNull();
    });

    it("does not manufacture a birthDate clear when extraction omits birthDate", async () => {
        extractionPort.extract.mockResolvedValue(extraction({
            category: "CLIENT_SERVICE",
            proposals: [
                { field: "startDate", value: "2026-06-23", evidence: "e", confidence: "high" },
            ],
        }));

        await service.processCallRecord("rec-1");

        const proposals = prisma.client_draft.createMany.mock.calls[0][0].data.proposals;
        expect(proposals).toEqual([
            { field: "startDate", value: "2026-06-23", evidence: "e", confidence: "high" },
        ]);
        expect(proposals.some((proposal: { field: string }) => proposal.field === "birthDate")).toBe(false);
    });

    it("keeps an explicit nullable birthDate clear as a proposal", async () => {
        extractionPort.extract.mockResolvedValue(extraction({
            category: "CLIENT_SERVICE",
            proposals: [
                { field: "birthDate", value: null, evidence: "출산일을 지워 주세요", confidence: "high" },
            ],
        }));

        await service.processCallRecord("rec-1");

        expect(prisma.client_draft.createMany.mock.calls[0][0].data.proposals).toEqual([
            { field: "birthDate", value: null, evidence: "출산일을 지워 주세요", confidence: "high" },
        ]);
    });

    it.each(["name", "voucherClient", "breastPump"])(
        "rejects an explicit null proposal for non-nullable %s without creating a draft",
        async (field) => {
            extractionPort.extract.mockResolvedValue(extraction({
                category: "CLIENT_SERVICE",
                proposals: [{ field, value: null, evidence: "e", confidence: "high" }],
            }));

            await service.processCallRecord("rec-1");

            expect(prisma.client_draft.createMany).not.toHaveBeenCalled();
            expect(prisma.call_record.updateMany).toHaveBeenLastCalledWith(expect.objectContaining({
                where: expect.objectContaining({ id: "rec-1" }),
                data: expect.objectContaining({
                    processingStatus: "FAILED",
                    failureReason: expect.stringContaining("non-nullable"),
                }),
            }));
        },
    );

    it("marks FAILED with reason when extraction throws", async () => {
        extractionPort.extract.mockRejectedValue(new Error("Gemini extraction failed (429)"));

        await service.processCallRecord("rec-1");

        expect(prisma.call_record.updateMany).toHaveBeenCalledWith(expect.objectContaining({
            data: expect.objectContaining({
                processingStatus: "FAILED",
                failureReason: expect.stringContaining("429"),
            }),
        }));
        expect(prisma.client_draft.createMany).not.toHaveBeenCalled();
    });

    it("skips records that are not RECEIVED/FAILED (already extracted)", async () => {
        prisma.call_record.findUnique.mockResolvedValue({ ...record, processingStatus: "EXTRACTED" });
        await service.processCallRecord("rec-1");
        expect(extractionPort.extract).not.toHaveBeenCalled();
    });

    it("leaves client unmatched when two branch clients share the phone", async () => {
        prisma.client.findMany.mockResolvedValue([
            { id: 142, phone: "010-2210-9987" },
            { id: 143, phone: "01022109987" },
        ]);
        extractionPort.extract.mockResolvedValue(extraction({
            category: "CLIENT_SERVICE",
            callerPhoneCandidates: ["010-2210-9987"],
            proposals: [
                { field: "startDate", value: "2026-06-23", evidence: "e", confidence: "high" },
            ],
        }));

        await service.processCallRecord("rec-1");

        expect(prisma.call_record.updateMany).toHaveBeenCalledWith(expect.objectContaining({
            data: expect.objectContaining({ matchedClientId: null }),
        }));
        expect(prisma.client_draft.createMany.mock.calls[0][0].data.clientId).toBeNull();
    });

    it("marks FAILED when the record+draft transaction fails (no silent EXTRACTED-without-draft)", async () => {
        extractionPort.extract.mockResolvedValue(extraction({
            category: "NEW_CONSULTATION",
            requestSummary: "신규 문의",
            proposals: [{ field: "name", value: "김서연", evidence: "e", confidence: "high" }],
        }));
        prisma.$transaction.mockRejectedValue(new Error("db down"));

        await service.processCallRecord("rec-1");

        expect(prisma.call_record.updateMany).toHaveBeenLastCalledWith(expect.objectContaining({
            where: expect.objectContaining({ id: "rec-1" }),
            data: expect.objectContaining({
                processingStatus: "FAILED",
                failureReason: expect.stringContaining("persistence"),
            }),
        }));
    });
});
