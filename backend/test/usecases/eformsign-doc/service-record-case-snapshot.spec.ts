import { CreateAndSendServiceRecordSnapshotUsecase } from "application/usecases/eformsign-doc/create-and-send-service-record-snapshot.usecase";

const dbDate = (day: number) => new Date(`2026-07-${String(day).padStart(2, "0")}T00:00:00.000Z`);

type PreparedChunk = {
    employeeName: string;
    days: unknown[];
    tier: number;
    templateId: string;
    sourceHash: string;
    documentName: string;
    chunkIndex: number;
    chunkCount: number;
    firstSessionIndex: number;
    lastSessionIndex: number;
};

type PersistedChunkLayout = {
    assignmentId: string | null;
    chunkIndex: number;
    chunkCount: number;
    firstSessionIndex: number;
    lastSessionIndex: number;
    employeeNameSnapshot: string;
};

/** base-only env (only EFORMSIGN_FEEDBACK_TEMPLATE_ID set) — preserves the pre-multi-tier 5-only chunking. */
const BASE_ONLY_TIERS = [5];
const BASE_ONLY_TEMPLATE_BY_TIER = new Map([[5, "template-1"]]);

/** all 4 tiers configured (BJJ-multi-tier). */
const ALL_TIERS = [5, 10, 15, 20];
const ALL_TEMPLATE_BY_TIER = new Map([
    [5, "template-5"],
    [10, "template-10"],
    [15, "template-15"],
    [20, "template-20"],
]);

/** Calls the private buildCaseChunks(record, tiers, templateIdByTier) via cast. */
function callBuildCaseChunks(
    usecase: CreateAndSendServiceRecordSnapshotUsecase,
    record: ReturnType<typeof makeRecord>,
    tiers: number[],
    templateIdByTier: Map<number, string>,
    persistedLayout: PersistedChunkLayout[] = [],
): PreparedChunk[] {
    return (usecase as unknown as {
        buildCaseChunks(
            value: ReturnType<typeof makeRecord>,
            tiers: number[],
            templateIdByTier: Map<number, string>,
            persistedLayout?: PersistedChunkLayout[],
        ): PreparedChunk[];
    }).buildCaseChunks(record, tiers, templateIdByTier, persistedLayout);
}

function makeRecord() {
    return {
        id: "11111111-2222-3333-4444-555555555555",
        branchId: "branch-1",
        clientId: 10,
        status: "FINALIZING",
        startDate: dbDate(1),
        endDate: dbDate(12),
        requiredSessionCount: 7,
        formVersion: 1,
        momName: "김산모",
        momBirth: "900101",
        babyName: "김아기",
        babyBirth: "260701",
        deliveryType: "자연분만",
        babyWeight: "3.2",
        completedAt: new Date(),
        finalizationDueAt: new Date("2026-07-12T11:00:00.000Z"),
        finalizationStartedAt: new Date(),
        finalizedAt: null,
        documentsCompletedAt: null,
        finalizationAttempts: 1,
        nextAttemptAt: null,
        lastError: null,
        version: 1,
        createdAt: new Date(),
        updatedAt: new Date(),
        branch: { name: "인천 아이미래로" },
        client: { name: "김고객" },
        assignments: [
            {
                id: "assignment-a",
                scheduleId: 101,
                employeeId: 1,
                employeeNameSnapshot: "제공A",
                startDate: dbDate(1),
                endDate: dbDate(6),
            },
            {
                id: "assignment-b",
                scheduleId: 102,
                employeeId: 2,
                employeeNameSnapshot: "제공B",
                startDate: dbDate(7),
                endDate: dbDate(12),
            },
        ],
        days: Array.from({ length: 7 }, (_, index) => {
            const sessionIndex = index + 1;
            const secondProvider = sessionIndex === 7;
            return {
                scheduleId: secondProvider ? 102 : 101,
                caseSessionIndex: sessionIndex,
                employeeId: secondProvider ? 2 : 1,
                employeeNameSnapshot: secondProvider ? "제공B" : "제공A",
                serviceDate: dbDate(sessionIndex),
                answers: {},
                etcService: null,
                notes: null,
                paymentConfirmed: true,
                momApproval: "approved",
                clientSignature: null as string | null,
                locked: true,
            };
        }),
    };
}

function setup() {
    const snapshotChunk = {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        update: jest.fn().mockResolvedValue({}),
    };
    const eformsignDoc = {
        upsert: jest.fn().mockResolvedValue({}),
    };
    const prisma = {
        service_record_snapshot_chunk: snapshotChunk,
        eformsign_doc: eformsignDoc,
    };
    const prismaWithTransaction = Object.assign(prisma, {
        $transaction: jest.fn(async (callback: (tx: typeof prisma) => Promise<unknown>) => callback(prisma)),
    });
    const remoteDocument = {
        id: "remote-doc-1",
        document_number: "SR-1",
        template: { id: "template-1", name: "제공기록지" },
        document_name: "서비스 제공기록지 - 김고객 (1/1) [SR-11111111-v1]",
        creator: { recipient_type: "01", id: "reviewer@example.com", name: "검토자" },
        created_date: Date.now(),
        updated_date: Date.now(),
        current_status: {
            status_type: "070",
            status_doc_type: "진행중",
            status_doc_detail: "검토 요청",
            step_type: "06",
            step_index: "2",
            step_name: "제공업체 확인",
            step_recipients: [{ recipient_type: "01", id: "reviewer@example.com", name: "검토자" }],
            step_group: 0,
            expired_date: Date.now() + 86_400_000,
            _expired: false,
        },
    };
    const eformsignClient = {
        createDocument: jest.fn().mockRejectedValue(new TypeError("fetch failed")),
        findDocumentsByTitle: jest.fn().mockResolvedValue([remoteDocument]),
    };
    const usecase = new CreateAndSendServiceRecordSnapshotUsecase(
        eformsignClient as never,
        prismaWithTransaction as never,
        {} as never,
        {} as never,
    );
    return { usecase, prisma: prismaWithTransaction, eformsignClient, remoteDocument };
}

describe("client-owned service record snapshot", () => {
    it("allows a complete record snapshot before the contracted end time", () => {
        const { usecase } = setup();
        const record = makeRecord();
        record.finalizationDueAt = new Date("2099-07-12T11:00:00.000Z");
        const validator = usecase as unknown as {
            assertReadyForSnapshot(value: ReturnType<typeof makeRecord>): void;
        };

        expect(() => validator.assertReadyForSnapshot(record)).not.toThrow();
    });

    it("splits at provider boundaries as well as the five-session template limit", () => {
        const { usecase } = setup();
        const chunks = callBuildCaseChunks(usecase, makeRecord(), BASE_ONLY_TIERS, BASE_ONLY_TEMPLATE_BY_TIER);

        expect(chunks.map((chunk) => [chunk.employeeName, chunk.days.length])).toEqual([
            ["제공A", 5],
            ["제공A", 1],
            ["제공B", 1],
        ]);
    });

    it("uses the preserved mom-name snapshot when the client row has been deleted", () => {
        const { usecase } = setup();
        const record = {
            ...makeRecord(),
            clientId: null,
            client: null,
        } as unknown as ReturnType<typeof makeRecord>;

        const chunks = callBuildCaseChunks(usecase, record, BASE_ONLY_TIERS, BASE_ONLY_TEMPLATE_BY_TIER);

        expect(chunks[0]?.documentName).toContain("김산모");
    });

    it("throws the not-configured error when the base 5회 template env is missing", () => {
        const usecase = new CreateAndSendServiceRecordSnapshotUsecase(
            {} as never,
            {} as never,
            {} as never,
            { get: jest.fn().mockReturnValue(undefined) } as never,
        );
        const reader = usecase as unknown as { getConfiguredTiers(): unknown };

        expect(() => reader.getConfiguredTiers()).toThrow(/EFORMSIGN_FEEDBACK_TEMPLATE_ID/);
    });

    it("sizes each provider segment to the smallest fitting tier and carries that tier's templateId", () => {
        const { usecase } = setup();
        // 제공A has 6 days (5회 doesn't fit → 10회), 제공B has 1 day (→ 5회).
        const chunks = callBuildCaseChunks(usecase, makeRecord(), ALL_TIERS, ALL_TEMPLATE_BY_TIER);

        expect(chunks.map((chunk) => [chunk.employeeName, chunk.days.length, chunk.tier, chunk.templateId])).toEqual([
            ["제공A", 6, 10, "template-10"],
            ["제공B", 1, 5, "template-5"],
        ]);
    });

    it("preserves durable session boundaries when larger tiers are enabled before a retry", () => {
        const { usecase } = setup();
        const record = makeRecord();
        record.requiredSessionCount = 10;
        record.assignments = [{ ...record.assignments[0]!, endDate: dbDate(10) }];
        record.days = Array.from({ length: 10 }, (_, index) => ({
            ...makeRecord().days[0]!,
            scheduleId: 101,
            employeeId: 1,
            employeeNameSnapshot: "제공A",
            caseSessionIndex: index + 1,
            serviceDate: dbDate(index + 1),
        }));
        const persistedLayout: PersistedChunkLayout[] = [
            {
                assignmentId: "assignment-a",
                chunkIndex: 1,
                chunkCount: 2,
                firstSessionIndex: 1,
                lastSessionIndex: 5,
                employeeNameSnapshot: "제공A",
            },
            {
                assignmentId: "assignment-a",
                chunkIndex: 2,
                chunkCount: 2,
                firstSessionIndex: 6,
                lastSessionIndex: 10,
                employeeNameSnapshot: "제공A",
            },
        ];

        const chunks = callBuildCaseChunks(
            usecase,
            record,
            ALL_TIERS,
            ALL_TEMPLATE_BY_TIER,
            persistedLayout,
        );

        expect(chunks.map((chunk) => [
            chunk.chunkIndex,
            chunk.firstSessionIndex,
            chunk.lastSessionIndex,
            chunk.tier,
            chunk.templateId,
        ])).toEqual([
            [1, 1, 5, 5, "template-5"],
            [2, 6, 10, 5, "template-5"],
        ]);
    });

    it("splits a segment longer than the max tier into a max-tier document plus a re-tiered remainder", () => {
        const { usecase } = setup();
        const record = makeRecord();
        record.requiredSessionCount = 23;
        record.assignments = [{ ...record.assignments[0]!, endDate: dbDate(23) }];
        record.days = Array.from({ length: 23 }, (_, index) => ({
            ...makeRecord().days[0]!,
            scheduleId: 101,
            employeeId: 1,
            employeeNameSnapshot: "제공A",
            caseSessionIndex: index + 1,
            serviceDate: dbDate(index + 1),
        }));
        const chunks = callBuildCaseChunks(usecase, record, ALL_TIERS, ALL_TEMPLATE_BY_TIER);

        expect(chunks.map((chunk) => [chunk.days.length, chunk.tier, chunk.templateId])).toEqual([
            [20, 20, "template-20"],
            [3, 5, "template-5"],
        ]);
    });

    it("changes sourceHash when a day's clientSignature changes (legacy session gets a signature)", () => {
        const { usecase } = setup();
        const buildChunks = (record: ReturnType<typeof makeRecord>) =>
            callBuildCaseChunks(usecase, record, BASE_ONLY_TIERS, BASE_ONLY_TEMPLATE_BY_TIER);

        const withoutSignature = makeRecord();
        withoutSignature.requiredSessionCount = 1;
        withoutSignature.days = [withoutSignature.days[0]!];
        const hashWithoutSignature = buildChunks(withoutSignature)[0]!.sourceHash;

        const withSignature = makeRecord();
        withSignature.requiredSessionCount = 1;
        withSignature.days = [{
            ...withSignature.days[0]!,
            clientSignature: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB",
        }];
        const hashWithSignature = buildChunks(withSignature)[0]!.sourceHash;

        expect(hashWithSignature).not.toBe(hashWithoutSignature);
    });

    it("reconciles an ambiguous create attempt by title without creating a second document", async () => {
        const { usecase, prisma, eformsignClient, remoteDocument } = setup();
        const record = makeRecord();
        record.requiredSessionCount = 1;
        record.days = [record.days[0]!];
        record.assignments = [record.assignments[0]!];
        const chunk = callBuildCaseChunks(usecase, record, BASE_ONLY_TIERS, BASE_ONLY_TEMPLATE_BY_TIER)[0]!;
        const processor = usecase as unknown as {
            processChunk(params: Record<string, unknown>): Promise<string>;
        };
        const common = {
            record,
            chunk,
            chunkId: "chunk-1",
            chunkAttempts: 0,
            chunkClaimedAt: null,
            chunkCreateAttemptedAt: null,
            templateId: "template-1",
            accessToken: "access-token",
            reviewer: { name: "검토자", id: "reviewer@example.com" },
        };

        await expect(processor.processChunk({ ...common, chunkStatus: "PENDING" }))
            .rejects.toThrow("fetch failed");
        expect(prisma.service_record_snapshot_chunk.update).toHaveBeenLastCalledWith(expect.objectContaining({
            data: expect.objectContaining({ status: "RECONCILING" }),
        }));

        await expect(processor.processChunk({
            ...common,
            chunkStatus: "RECONCILING",
            chunkAttempts: 1,
            chunkCreateAttemptedAt: new Date(),
        })).resolves.toBe(remoteDocument.id);

        expect(eformsignClient.createDocument).toHaveBeenCalledTimes(1);
        expect(eformsignClient.findDocumentsByTitle).toHaveBeenCalledWith(
            "access-token",
            chunk["documentName"],
        );
        expect(prisma.eformsign_doc.upsert).toHaveBeenCalledWith(expect.objectContaining({
            where: { documentId: remoteDocument.id },
            update: expect.objectContaining({
                statusType: "070",
                statusDetail: "검토 요청",
                stepType: "06",
                stepIndex: "2",
                expired: false,
            }),
        }));
        expect(prisma.service_record_snapshot_chunk.update).toHaveBeenLastCalledWith(expect.objectContaining({
            data: expect.objectContaining({
                status: "CREATED",
                eformsignDocumentId: remoteDocument.id,
            }),
        }));
    });
});
