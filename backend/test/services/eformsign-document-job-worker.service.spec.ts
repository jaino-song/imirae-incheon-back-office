import { ConfigService } from "@nestjs/config";

import { EformsignDocumentJobWorkerService } from "application/services/eformsign-document-job-worker.service";
import { EformsignDocumentJobEntity } from "domain/entities/eformsign-document-job.entity";

const branchId = "00000000-0000-0000-0000-000000000010";

function job(overrides: Partial<EformsignDocumentJobEntity> = {}): EformsignDocumentJobEntity {
    return new EformsignDocumentJobEntity({
        id: "00000000-0000-0000-0000-000000000001",
        branchId,
        clientId: 7,
        documentId: null,
        jobType: "create_document",
        source: "staff",
        status: "processing",
        requestKey: "request-1",
        activeKey: "create:branch:7",
        payload: {
            clientId: 7,
            contractData: contractData(),
        },
        payloadFingerprint: "a".repeat(64),
        progressStep: null,
        attempts: 1,
        nextAttemptAt: new Date(),
        heartbeatAt: new Date(),
        startedAt: new Date(),
        completedAt: null,
        lastErrorCode: null,
        createdByUserId: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        ...overrides,
    });
}

function contractData() {
    return {
        customerName: "고객",
        customerContact: "010-0000-0000",
        customerDOB: "1990-01-01",
        customerAddress: "주소",
        caretaker1Name: "담당자",
        caretaker1Contact: "010-1111-1111",
        type: "A",
        days: "5",
        area: "서울",
        contractDuration: "5",
        startYear: "2026",
        startMonth: "08",
        startDay: "13",
        startDate: "2026-08-13",
        endYear: "2026",
        endMonth: "08",
        endDay: "17",
        endDate: "2026-08-17",
        paymentYear: "2026",
        paymentMonth: "08",
        paymentDay: "13",
        fullPrice: "100",
        grant: "50",
        actualPrice: "50",
    };
}

function buildWorker(overrides: {
    repository?: Record<string, jest.Mock>;
    dispatch?: Record<string, jest.Mock>;
    finalize?: Record<string, jest.Mock>;
    reconciliation?: Record<string, jest.Mock>;
} = {}) {
    const repository = {
        recoverStale: jest.fn().mockResolvedValue([]),
        claimDue: jest.fn().mockResolvedValue([]),
        updateProgress: jest.fn().mockResolvedValue(null),
        scheduleRetry: jest.fn().mockResolvedValue(null),
        markReconciling: jest.fn().mockResolvedValue(null),
        markCompleted: jest.fn().mockResolvedValue(null),
        markFailed: jest.fn().mockResolvedValue(null),
        markRequiresAttention: jest.fn().mockResolvedValue(null),
        ...overrides.repository,
    };
    const dispatch = {
        execute: jest.fn(),
        ...overrides.dispatch,
    };
    const finalize = {
        execute: jest.fn(),
        ...overrides.finalize,
    };
    const reconciliation = {
        reconcile: jest.fn().mockResolvedValue({ status: "requires_attention" }),
        ...overrides.reconciliation,
    };
    const worker = new EformsignDocumentJobWorkerService(
        new ConfigService({ EFORMSIGN_DOCUMENT_JOBS_WORKER_ENABLED: "true" }),
        repository as never,
        dispatch as never,
        finalize as never,
        reconciliation as never,
    );
    return { worker, repository, dispatch, finalize, reconciliation };
}

describe("EformsignDocumentJobWorkerService", () => {
    afterEach(() => {
        jest.useRealTimers();
    });

    it("retries a pre-send failure with the first durable backoff", async () => {
        const claimed = job();
        const { worker, repository, dispatch } = buildWorker({
            repository: { claimDue: jest.fn().mockResolvedValue([claimed]) },
            dispatch: {
                execute: jest.fn().mockResolvedValue({
                    ok: false,
                    reason: "editor timeout",
                    fallbackHint: "iframe",
                    durationMs: 10,
                }),
            },
        });

        await worker.processDueJobs();

        expect(dispatch.execute).toHaveBeenCalledWith(
            branchId,
            expect.objectContaining({ clientId: 7, contractData: expect.any(Object), onProgress: expect.any(Function) }),
        );
        expect(repository.scheduleRetry).toHaveBeenCalledWith(
            claimed.id,
            expect.any(Date),
            "HEADLESS_CREATE_PRE_SEND_FAILURE",
        );
        expect(repository.markReconciling).not.toHaveBeenCalled();
    });

    it("does not retry after the provider send becomes ambiguous", async () => {
        const claimed = job();
        const { worker, repository, reconciliation } = buildWorker({
            repository: {
                claimDue: jest.fn().mockResolvedValue([claimed]),
                markReconciling: jest.fn().mockResolvedValue({ ...claimed, status: "reconciling", payload: null }),
            },
            dispatch: {
                execute: jest.fn().mockImplementation(async (_branchId, { onProgress }) => {
                    onProgress?.("creating");
                    return { ok: false, reason: "browser disconnected", durationMs: 10 };
                }),
            },
        });

        await worker.processDueJobs();

        expect(repository.scheduleRetry).not.toHaveBeenCalled();
        expect(repository.markReconciling).toHaveBeenCalledWith(claimed.id, "creating");
        expect(reconciliation.reconcile).toHaveBeenCalledWith(
            expect.objectContaining({ payload: claimed.payload }),
        );
    });

    it("keeps a send-progress marker when the headless call throws", async () => {
        const claimed = job();
        const { worker, repository, reconciliation } = buildWorker({
            repository: {
                claimDue: jest.fn().mockResolvedValue([claimed]),
                markReconciling: jest.fn().mockResolvedValue({ ...claimed, status: "reconciling", payload: null }),
            },
            dispatch: {
                execute: jest.fn().mockImplementation(async (_branchId, { onProgress }) => {
                    onProgress?.("sent");
                    throw new Error("browser disconnected");
                }),
            },
        });

        await worker.processDueJobs();

        expect(repository.scheduleRetry).not.toHaveBeenCalled();
        expect(repository.markReconciling).toHaveBeenCalledWith(claimed.id, "sent");
        expect(reconciliation.reconcile).toHaveBeenCalled();
    });

    it("does not retry a later finalize step after an earlier step was sent", async () => {
        const claimed = job({
            id: "00000000-0000-0000-0000-000000000003",
            jobType: "finalize_document",
            documentId: "doc-3",
            activeKey: "finalize:doc-3",
            payload: { documentId: "doc-3" },
        });
        const { worker, repository, finalize, reconciliation } = buildWorker({
            repository: {
                claimDue: jest.fn().mockResolvedValue([claimed]),
                markReconciling: jest.fn().mockResolvedValue({ ...claimed, status: "reconciling", payload: null }),
            },
            finalize: {
                execute: jest.fn()
                    .mockImplementationOnce(async ({ onProgress }) => {
                        onProgress?.("sent");
                        return { ok: true, completed: false, durationMs: 1 };
                    })
                    .mockResolvedValueOnce({
                        ok: false,
                        reason: "provider timeout",
                        fallbackHint: "iframe",
                        durationMs: 1,
                    }),
            },
        });

        await worker.processDueJobs();

        expect(finalize.execute).toHaveBeenCalledTimes(2);
        expect(repository.scheduleRetry).not.toHaveBeenCalled();
        expect(repository.markReconciling).toHaveBeenCalledWith(claimed.id, "sent");
        expect(reconciliation.reconcile).toHaveBeenCalled();
    });

    it("persists progress and sends a heartbeat while a provider operation is running", async () => {
        jest.useFakeTimers();
        const claimed = job();
        let resolveDispatch!: (value: unknown) => void;
        const dispatchPromise = new Promise((resolve) => {
            resolveDispatch = resolve;
        });
        const { worker, repository } = buildWorker({
            repository: { claimDue: jest.fn().mockResolvedValue([claimed]) },
            dispatch: {
                execute: jest.fn().mockImplementation(async (_branchId, { onProgress }) => {
                    onProgress?.("info-inserted");
                    return dispatchPromise;
                }),
            },
        });

        const processing = worker.processDueJobs();
        await Promise.resolve();
        await Promise.resolve();
        jest.advanceTimersByTime(30_000);
        await Promise.resolve();
        expect(repository.updateProgress).toHaveBeenCalledWith(
            claimed.id,
            "info-inserted",
            expect.any(Date),
        );

        resolveDispatch({ ok: true, documentId: "doc-1", durationMs: 10 });
        await processing;
        expect(repository.markCompleted).toHaveBeenCalledWith(claimed.id, "doc-1");
    });

    it("dispatches creation and consecutive finalization jobs through their typed payloads", async () => {
        const createJob = job();
        const finalizeJob = job({
            id: "00000000-0000-0000-0000-000000000002",
            jobType: "finalize_document",
            documentId: "doc-2",
            activeKey: "finalize:doc-2",
            payload: { documentId: "doc-2", prefillEndDate: "2026-08-17" },
        });
        const { worker, repository, dispatch, finalize } = buildWorker({
            repository: { claimDue: jest.fn().mockResolvedValue([createJob, finalizeJob]) },
            dispatch: { execute: jest.fn().mockResolvedValue({ ok: true, documentId: "doc-1", durationMs: 1 }) },
            finalize: { execute: jest.fn().mockResolvedValue({ ok: true, completed: true, durationMs: 1 }) },
        });

        await worker.processDueJobs();

        expect(dispatch.execute).toHaveBeenCalledTimes(1);
        expect(finalize.execute).toHaveBeenCalledWith(expect.objectContaining({
            documentId: "doc-2",
            prefillEndDate: "2026-08-17",
        }));
        expect(repository.markCompleted).toHaveBeenNthCalledWith(1, createJob.id, "doc-1");
        expect(repository.markCompleted).toHaveBeenNthCalledWith(2, finalizeJob.id, "doc-2");
    });
});
