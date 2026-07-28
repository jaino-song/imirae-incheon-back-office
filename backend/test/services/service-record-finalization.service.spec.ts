import { ServiceRecordFinalizationService } from "application/services/service-record-finalization.service";
import {
    SERVICE_RECORD_CASE_STATUS,
    ServiceRecordLifecycleService,
} from "application/services/service-record-lifecycle.service";
import { CreateAndSendServiceRecordSnapshotUsecase } from "application/usecases/eformsign-doc/create-and-send-service-record-snapshot.usecase";
import { PrismaService } from "infrastructure/database/prisma.service";

const mockCaptureServiceRecordError = jest.fn();

jest.mock("infrastructure/observability/service-record-sentry", () => ({
    captureServiceRecordError: (...args: unknown[]) => mockCaptureServiceRecordError(...args),
}));

function setup(options: {
    claimCount?: number;
    snapshotError?: Error;
    staleCount?: number;
    includeCandidate?: boolean;
} = {}) {
    const candidate = {
        id: "case-1",
        branchId: "branch-1",
        finalizationAttempts: 0,
    };
    const prisma = {
        service_record_case: {
            findMany: jest.fn()
                .mockResolvedValueOnce([])
                .mockResolvedValueOnce([])
                .mockResolvedValueOnce(options.includeCandidate === false ? [] : [candidate]),
            updateMany: jest.fn().mockImplementation(({ where }) => {
                if (where.status === SERVICE_RECORD_CASE_STATUS.FINALIZING && where.finalizationStartedAt) {
                    return Promise.resolve({ count: options.staleCount ?? 0 });
                }
                if (where.id === candidate.id && where.OR) {
                    return Promise.resolve({ count: options.claimCount ?? 1 });
                }
                return Promise.resolve({ count: 1 });
            }),
        },
        service_record_snapshot_chunk: {
            count: jest.fn().mockResolvedValue(0),
        },
        service_record_token: {
            updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        },
    };
    const transaction = jest.fn(async (callback: (tx: typeof prisma) => Promise<unknown>) => callback(prisma));
    const prismaWithTransaction = Object.assign(prisma, { $transaction: transaction });
    const lifecycle = { recompute: jest.fn() };
    const snapshot = {
        executeCase: options.snapshotError
            ? jest.fn().mockRejectedValue(options.snapshotError)
            : jest.fn().mockResolvedValue({
                documentIds: ["doc-1", "doc-2"],
                documentId: "doc-1",
                chunkCount: 2,
            }),
    };
    const service = new ServiceRecordFinalizationService(
        prismaWithTransaction as unknown as PrismaService,
        lifecycle as unknown as ServiceRecordLifecycleService,
        snapshot as unknown as CreateAndSendServiceRecordSnapshotUsecase,
    );
    return { service, prisma: prismaWithTransaction, lifecycle, snapshot };
}

describe("ServiceRecordFinalizationService", () => {
    beforeEach(() => {
        mockCaptureServiceRecordError.mockClear();
    });
    it("claims a ready case once, creates every chunk, and revokes remaining links", async () => {
        const { service, prisma, snapshot } = setup();

        await expect(service.processDueCases(new Date("2026-07-13T00:00:00.000Z"))).resolves.toBe(1);

        expect(snapshot.executeCase).toHaveBeenCalledWith("branch-1", "case-1");
        expect(prisma.service_record_case.updateMany).toHaveBeenCalledWith(
            expect.objectContaining({
                where: expect.objectContaining({ id: "case-1" }),
                data: expect.objectContaining({ status: SERVICE_RECORD_CASE_STATUS.FINALIZING }),
            }),
        );
        expect(prisma.service_record_case.updateMany).toHaveBeenCalledWith(
            expect.objectContaining({
                where: { id: "case-1", status: SERVICE_RECORD_CASE_STATUS.FINALIZING },
                data: expect.objectContaining({ status: SERVICE_RECORD_CASE_STATUS.DOCUMENTS_CREATED }),
            }),
        );
        expect(prisma.service_record_token.updateMany).toHaveBeenCalledWith({
            where: { serviceRecordCaseId: "case-1", active: true },
            data: { active: false, revokedAt: expect.any(Date) },
        });
        expect(prisma.service_record_case.findMany).toHaveBeenNthCalledWith(3, expect.objectContaining({
            where: {
                snapshotChunks: { none: { status: "MANUAL_REVIEW" } },
                OR: [
                    { status: SERVICE_RECORD_CASE_STATUS.READY_TO_FINALIZE },
                    {
                        status: SERVICE_RECORD_CASE_STATUS.FINALIZATION_FAILED,
                        nextAttemptAt: { lte: new Date("2026-07-13T00:00:00.000Z") },
                    },
                ],
            },
        }));
        expect(prisma.service_record_case.findMany).toHaveBeenNthCalledWith(2, expect.objectContaining({
            where: {
                OR: [
                    { status: SERVICE_RECORD_CASE_STATUS.WAITING_FOR_END },
                    {
                        finalizationDueAt: { lte: new Date("2026-07-13T00:00:00.000Z") },
                        status: {
                            in: [
                                SERVICE_RECORD_CASE_STATUS.SCHEDULED,
                                SERVICE_RECORD_CASE_STATUS.IN_PROGRESS,
                            ],
                        },
                    },
                ],
            },
        }));
    });

    it("does not call eformsign when another instance already owns the DB claim", async () => {
        const { service, snapshot } = setup({ claimCount: 0 });

        await expect(service.processDueCases()).resolves.toBe(0);
        expect(snapshot.executeCase).not.toHaveBeenCalled();
    });

    it("records a retryable case failure when snapshot creation fails", async () => {
        const snapshotError = new Error("network failed");
        const { service, prisma } = setup({ snapshotError });

        await expect(service.processDueCases()).resolves.toBe(0);

        expect(prisma.service_record_case.updateMany).toHaveBeenCalledWith(
            expect.objectContaining({
                where: { id: "case-1", status: SERVICE_RECORD_CASE_STATUS.FINALIZING },
                data: expect.objectContaining({
                    status: SERVICE_RECORD_CASE_STATUS.FINALIZATION_FAILED,
                    nextAttemptAt: expect.any(Date),
                    lastError: "network failed",
                }),
            }),
        );
        expect(mockCaptureServiceRecordError).toHaveBeenCalledTimes(1);
        expect(mockCaptureServiceRecordError).toHaveBeenCalledWith(snapshotError, {
            operation: "auto-finalize",
            handled: true,
            caseId: "case-1",
            retryCount: 1,
        });
    });

    it("recovers a stale FINALIZING claim for a later reconciliation run", async () => {
        const { service, prisma, snapshot } = setup({ staleCount: 1, includeCandidate: false });
        const referenceDate = new Date("2026-07-13T00:00:00.000Z");

        await expect(service.processDueCases(referenceDate)).resolves.toBe(0);

        expect(prisma.service_record_case.updateMany).toHaveBeenCalledWith({
            where: {
                status: SERVICE_RECORD_CASE_STATUS.FINALIZING,
                finalizationStartedAt: { lte: new Date("2026-07-12T23:40:00.000Z") },
            },
            data: {
                status: SERVICE_RECORD_CASE_STATUS.FINALIZATION_FAILED,
                nextAttemptAt: referenceDate,
                lastError: "Recovered stale finalization claim",
                version: { increment: 1 },
            },
        });
        expect(snapshot.executeCase).not.toHaveBeenCalled();
    });
});
