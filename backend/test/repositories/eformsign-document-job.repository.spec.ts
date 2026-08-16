import { PrismaService } from "infrastructure/database/prisma.service";
import { SbEformsignDocumentJobRepository } from "infrastructure/database/repositories/sb.eformsign-document-job.repository";

const sqlText = (value: unknown): string => {
    if (value && typeof value === "object" && "strings" in value) {
        return ((value as { strings: string[] }).strings ?? []).join("");
    }
    return String(value);
};

const row = (overrides: Record<string, unknown> = {}) => ({
    id: "00000000-0000-0000-0000-000000000001",
    branch_id: "00000000-0000-0000-0000-000000000010",
    client_id: 7,
    document_id: null,
    job_type: "create_document",
    source: "staff",
    status: "queued",
    request_key: "request-1",
    active_key: "create:branch:7",
    payload: { clientId: 7 },
    payload_fingerprint: "a".repeat(64),
    progress_step: "queued",
    attempts: 0,
    next_attempt_at: new Date("2026-08-13T00:00:00Z"),
    heartbeat_at: null,
    lease_token: null,
    auto_finalize_outcome_recorded_at: null,
    started_at: null,
    completed_at: null,
    last_error_code: null,
    created_by_user_id: null,
    created_at: new Date("2026-08-13T00:00:00Z"),
    updated_at: new Date("2026-08-13T00:00:00Z"),
    ...overrides,
});

describe("SbEformsignDocumentJobRepository", () => {
    let queryRaw: jest.Mock;
    let executeRaw: jest.Mock;
    let repository: SbEformsignDocumentJobRepository;

    beforeEach(() => {
        queryRaw = jest.fn();
        executeRaw = jest.fn();
        const prisma = {
            $queryRaw: queryRaw,
            $executeRaw: executeRaw,
            $transaction: jest.fn(async (operation: (tx: unknown) => Promise<unknown>) => operation({
                $queryRaw: queryRaw,
                $executeRaw: executeRaw,
            })),
        } as unknown as PrismaService;
        repository = new SbEformsignDocumentJobRepository(prisma);
    });

    it("returns the inserted job and never exposes the payload in a log path", async () => {
        queryRaw.mockResolvedValueOnce([row()]);
        const result = await repository.enqueue({
            branchId: row().branch_id,
            clientId: 7,
            jobType: "create_document",
            source: "staff",
            requestKey: "request-1",
            activeKey: "create:branch:7",
            payload: { clientId: 7 },
            payloadFingerprint: "a".repeat(64),
        });
        expect(result.existing).toBe(false);
        expect(result.job.status).toBe("queued");
        expect(sqlText(queryRaw.mock.calls[0][0])).toContain("ON CONFLICT DO NOTHING");
    });

    it("returns the existing request or active job after a matching unique conflict", async () => {
        queryRaw.mockResolvedValueOnce([]).mockResolvedValueOnce([row()]);
        const result = await repository.enqueue({
            branchId: row().branch_id,
            clientId: 7,
            jobType: "create_document",
            source: "staff",
            requestKey: "request-1",
            activeKey: "create:branch:7",
            payload: {},
            payloadFingerprint: "a".repeat(64),
        });
        expect(result.existing).toBe(true);
        expect(sqlText(queryRaw.mock.calls[1][0])).toContain("request_key");
        expect(sqlText(queryRaw.mock.calls[1][0])).toContain("active_key");
    });

    it("rejects a reused request key with a different payload fingerprint", async () => {
        queryRaw.mockResolvedValueOnce([]).mockResolvedValueOnce([row()]);
        await expect(repository.enqueue({
            branchId: row().branch_id,
            clientId: 7,
            jobType: "create_document",
            source: "staff",
            requestKey: "request-1",
            activeKey: "create:branch:7",
            payload: {},
            payloadFingerprint: "b".repeat(64),
        })).rejects.toThrow("EFORMSIGN_DOCUMENT_JOB_IDEMPOTENCY_MISMATCH");
    });

    it("serializes replicas and refuses a fourth global active job", async () => {
        executeRaw.mockResolvedValue(1);
        queryRaw.mockResolvedValueOnce([{ count: 3 }]);
        await expect(repository.claimDue(2)).resolves.toEqual([]);
        expect(sqlText(executeRaw.mock.calls[0][0])).toContain("pg_advisory_xact_lock");
        expect(queryRaw).toHaveBeenCalledTimes(1);
    });

    it("claims only available capacity with SKIP LOCKED", async () => {
        executeRaw.mockResolvedValue(1);
        queryRaw.mockResolvedValueOnce([{ count: 2 }]).mockResolvedValueOnce([
            row({ status: "processing", attempts: 1 }),
        ]);
        const claimed = await repository.claimDue(3);
        expect(claimed).toHaveLength(1);
        const claimSql = sqlText(queryRaw.mock.calls[1][0]);
        expect(claimSql).toContain("FOR UPDATE SKIP LOCKED");
        expect(claimSql).toContain("attempts = attempts + 1");
        expect(claimSql).toContain("lease_token = gen_random_uuid()");
    });

    it("clears payload and active key on safe terminal transitions", async () => {
        queryRaw.mockResolvedValueOnce([row({ status: "completed", payload: null, active_key: null })]);
        await repository.markCompleted(row().id, "00000000-0000-0000-0000-000000000099", "doc-1");
        const statement = sqlText(queryRaw.mock.calls[0][0]);
        expect(statement).toContain("payload = NULL");
        expect(statement).toContain("active_key = NULL");
    });

    it("retains the active key for attention jobs while clearing sensitive payload", async () => {
        queryRaw.mockResolvedValueOnce([row({ status: "requires_attention", payload: null })]);
        await repository.markRequiresAttention(
            row().id,
            "00000000-0000-0000-0000-000000000099",
            "AMBIGUOUS_PROVIDER_STATE",
        );
        const statement = sqlText(queryRaw.mock.calls[0][0]);
        expect(statement).toContain("payload = NULL");
        expect(statement).not.toContain("active_key = NULL");
    });

    it("records an auto-finalize terminal attempt atomically and releases retry capacity below the cap", async () => {
        const executeRawInTransaction = jest.fn().mockResolvedValue(1);
        const queryRawInTransaction = jest.fn().mockResolvedValueOnce([row({
            job_type: "finalize_document",
            source: "auto_finalize",
            status: "failed",
            document_id: "doc-1",
            active_key: "finalize:doc-1",
            lease_token: "00000000-0000-0000-0000-000000000099",
        })]);
        const prisma = {
            $transaction: jest.fn(async (operation: (tx: unknown) => Promise<unknown>) => operation({
                $queryRaw: queryRawInTransaction,
                $executeRaw: executeRawInTransaction,
                eformsign_doc: {
                    update: jest.fn().mockResolvedValue({ autoFinalizeAttempts: 2 }),
                },
            })),
        } as unknown as PrismaService;
        const autoRepository = new SbEformsignDocumentJobRepository(prisma);

        const transitioned = await autoRepository.markFailed(
            row().id,
            "00000000-0000-0000-0000-000000000099",
            "PRE_SEND_RETRY_EXHAUSTED",
        );

        expect(transitioned).toEqual(expect.objectContaining({
            autoFinalizeOutcomeAttempts: 2,
            activeKey: null,
        }));
        expect(executeRawInTransaction).toHaveBeenCalledTimes(2);
    });

    it("retains the auto-finalize active key when the third terminal attempt is exhausted", async () => {
        const executeRawInTransaction = jest.fn().mockResolvedValue(1);
        const queryRawInTransaction = jest.fn().mockResolvedValueOnce([row({
            job_type: "finalize_document",
            source: "auto_finalize",
            status: "failed",
            document_id: "doc-1",
            active_key: "finalize:doc-1",
            lease_token: "00000000-0000-0000-0000-000000000099",
        })]);
        const prisma = {
            $transaction: jest.fn(async (operation: (tx: unknown) => Promise<unknown>) => operation({
                $queryRaw: queryRawInTransaction,
                $executeRaw: executeRawInTransaction,
                eformsign_doc: {
                    update: jest.fn().mockResolvedValue({ autoFinalizeAttempts: 3 }),
                },
            })),
        } as unknown as PrismaService;
        const autoRepository = new SbEformsignDocumentJobRepository(prisma);

        const transitioned = await autoRepository.markFailed(
            row().id,
            "00000000-0000-0000-0000-000000000099",
            "PRE_SEND_RETRY_EXHAUSTED",
        );

        expect(transitioned).toEqual(expect.objectContaining({
            autoFinalizeOutcomeAttempts: 3,
            activeKey: "finalize:doc-1",
        }));
    });

    it("recovers only pre-send progress to queued and reconciles possible sends", async () => {
        queryRaw.mockResolvedValueOnce([
            row({ progress_step: "validating", status: "queued" }),
            row({ id: "00000000-0000-0000-0000-000000000002", progress_step: "creating", status: "reconciling", payload: null }),
        ]);
        const recovered = await repository.recoverStale(new Date());
        expect(recovered.map((job) => job.status)).toEqual(["queued", "reconciling"]);
        const statement = sqlText(queryRaw.mock.calls[0][0]);
        expect(statement).toContain("progress_step IS NULL");
        expect(statement).toContain("ELSE 'reconciling'");
        expect(statement).toContain("status IN ('processing', 'reconciling')");
    });

    it("scopes summary and every list section to the authenticated branch", async () => {
        queryRaw.mockResolvedValueOnce([{ active_count: 2, attention_count: 1 }]);
        await expect(repository.getSummary(row().branch_id)).resolves.toEqual({
            activeCount: 2,
            requiresAttentionCount: 1,
        });
        expect(sqlText(queryRaw.mock.calls[0][0])).toContain("branch_id = ");

        queryRaw.mockReset();
        queryRaw.mockResolvedValueOnce([]).mockResolvedValueOnce([]).mockResolvedValueOnce([]);
        await repository.listForBranch(row().branch_id, new Date(), 100);
        expect(queryRaw).toHaveBeenCalledTimes(3);
        expect(queryRaw.mock.calls.every((call) => sqlText(call[0]).includes("branch_id = "))).toBe(true);
    });
});
