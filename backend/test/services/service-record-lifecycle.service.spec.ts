import { ConflictException } from "@nestjs/common";
import {
    SERVICE_RECORD_CASE_STATUS,
    ServiceRecordLifecycleService,
} from "application/services/service-record-lifecycle.service";
import { PrismaService } from "infrastructure/database/prisma.service";

const date = (value: string) => new Date(`${value}T00:00:00.000Z`);
const rawQueryBranchId = "11111111-1111-1111-1111-111111111111";
const rawQueryCaseId = "22222222-2222-2222-2222-222222222222";
const rawQueryDocumentId = "33333333-3333-3333-3333-333333333333";

function lockedSnapshot(overrides: Record<string, unknown> = {}) {
    return {
        id: 7,
        documentId: rawQueryDocumentId,
        branchId: rawQueryBranchId,
        documentKind: "service_record_snapshot",
        statusType: "062",
        detailPayload: { id: "snapshot-062" },
        detailSourceUpdatedDate: new Date("2026-07-30T01:00:00.000Z"),
        detailSyncedAt: new Date("2026-07-30T01:01:00.000Z"),
        syncStatus: "ready",
        permanentPurgeRequestedAt: null,
        hasCurrentDocumentPdf: true,
        hasCurrentAuditTrailPdf: true,
        ...overrides,
    };
}

function conflictCode(error: unknown): unknown {
    return error instanceof ConflictException ? error.getResponse() : null;
}

async function expectConflict(promise: Promise<unknown>, code: string): Promise<void> {
    try {
        await promise;
        throw new Error("Expected ConflictException");
    } catch (error) {
        expect(error).toBeInstanceOf(ConflictException);
        expect(conflictCode(error)).toEqual({ code });
    }
}

describe("ServiceRecordLifecycleService", () => {
    afterEach(() => {
        jest.useRealTimers();
    });

    it("locks the service start date once service has started", async () => {
        const prisma = {
            service_record_case: {
                findUnique: jest.fn().mockResolvedValue({
                    status: SERVICE_RECORD_CASE_STATUS.IN_PROGRESS,
                    startDate: date("2026-07-01"),
                    endDate: date("2026-07-20"),
                    requiredSessionCount: 10,
                    days: [],
                }),
            },
        };
        const service = new ServiceRecordLifecycleService(prisma as unknown as PrismaService);

        await expectConflict(service.validatePeriodChange({
            clientId: 1,
            startDate: date("2026-07-02"),
            now: new Date("2026-07-01T01:00:00.000Z"),
        }), "SERVICE_RECORD_START_DATE_LOCKED");
    });

    it("allows extending the end date without deleting existing sessions", async () => {
        const rows = [{ serviceDate: date("2026-07-08"), locked: true }];
        const prisma = {
            service_record_case: {
                findUnique: jest.fn().mockResolvedValue({
                    status: SERVICE_RECORD_CASE_STATUS.IN_PROGRESS,
                    startDate: date("2026-07-01"),
                    endDate: date("2026-07-10"),
                    requiredSessionCount: 5,
                    days: rows,
                }),
            },
            service_record_day: { deleteMany: jest.fn() },
        };
        const service = new ServiceRecordLifecycleService(prisma as unknown as PrismaService);

        await expect(service.validatePeriodChange({
            clientId: 1,
            endDate: date("2026-07-20"),
        })).resolves.toBeUndefined();
        expect(prisma.service_record_day.deleteMany).not.toHaveBeenCalled();
    });

    it("derives required sessions from the actual service period instead of voucher duration", async () => {
        const record = { id: "case-1" };
        const prisma = {
            client: {
                findUnique: jest.fn().mockResolvedValue({
                    id: 1,
                    branchId: "branch-1",
                    startDate: date("2026-08-03"),
                    endDate: date("2026-08-10"),
                    duration: 15,
                    serviceStatus: "in_progress",
                    employeeSchedules: [],
                }),
            },
            service_record_case: {
                findUnique: jest.fn().mockResolvedValue(null),
                upsert: jest.fn().mockResolvedValue(record),
            },
        };
        const service = new ServiceRecordLifecycleService(prisma as unknown as PrismaService);
        jest.spyOn(service, "recompute").mockResolvedValue(record as never);

        await service.ensureForClient(1);

        expect(prisma.service_record_case.upsert).toHaveBeenCalledWith(expect.objectContaining({
            create: expect.objectContaining({ requiredSessionCount: 6 }),
            update: expect.objectContaining({ requiredSessionCount: 6 }),
        }));
    });

    it("persists a contract end date and aggregate refresh in one transaction", async () => {
        const transactionClient = {
            service_record_case: {
                findUnique: jest.fn().mockResolvedValue({
                    status: SERVICE_RECORD_CASE_STATUS.IN_PROGRESS,
                    startDate: date("2026-07-01"),
                    endDate: date("2026-07-10"),
                    requiredSessionCount: 5,
                    days: [{ serviceDate: date("2026-07-08"), locked: true }],
                }),
            },
            client: {
                updateMany: jest.fn().mockResolvedValue({ count: 1 }),
            },
        };
        const prisma = {
            $transaction: jest.fn((callback: (tx: typeof transactionClient) => Promise<unknown>) =>
                callback(transactionClient)),
        };
        const service = new ServiceRecordLifecycleService(prisma as unknown as PrismaService);
        const ensureSpy = jest.spyOn(service, "ensureForClient").mockResolvedValue(null);

        await service.syncEndDateFromContract({
            branchId: "11111111-1111-1111-1111-111111111111",
            clientId: 1,
            endDate: date("2026-07-20"),
        });

        expect(transactionClient.client.updateMany).toHaveBeenCalledWith({
            where: {
                id: 1,
                OR: [
                    { branchId: "11111111-1111-1111-1111-111111111111" },
                    { branchId: null },
                ],
            },
            data: { endDate: date("2026-07-20") },
        });
        expect(ensureSpy).toHaveBeenCalledWith(1, transactionClient);
    });

    it("does not let a stale mirror version update a client after the parent-row fence loses", async () => {
        const transactionClient = {
            $queryRaw: jest.fn().mockResolvedValue([]),
            client: { updateMany: jest.fn() },
        };
        const prisma = {
            $transaction: jest.fn((callback: (tx: typeof transactionClient) => Promise<unknown>) =>
                callback(transactionClient)),
        };
        const service = new ServiceRecordLifecycleService(prisma as unknown as PrismaService);
        const ensureSpy = jest.spyOn(service, "ensureForClient");

        await expect(service.syncEndDateFromMirroredContract({
            branchId: rawQueryBranchId,
            clientId: 1,
            endDate: date("2026-07-20"),
            documentId: rawQueryDocumentId,
            detailSourceUpdatedDate: new Date("2026-07-30T01:00:00.000Z"),
            detailSyncedAt: new Date("2026-07-30T01:01:00.000Z"),
        })).resolves.toBe(false);

        expect(transactionClient.$queryRaw).toHaveBeenCalledTimes(1);
        const [fenceQuery] = transactionClient.$queryRaw.mock.calls[0] ?? [];
        const fenceSql = fenceQuery.strings.join(" ");
        expect(fenceSql).toMatch(/branch_id\s*=\s*::uuid/);
        expect(fenceQuery.text).toMatch(/\$\d+::uuid/);
        expect(fenceSql).toContain("permanent_purge_requested_at IS NULL");
        expect(fenceSql).toContain("file_type = 'document'");
        expect(fenceSql).toContain("file_type = 'audit_trail'");
        expect(transactionClient.client.updateMany).not.toHaveBeenCalled();
        expect(ensureSpy).not.toHaveBeenCalled();
    });

    it("completes a service-record case idempotently when every locked snapshot is in the completed set", async () => {
        const transactionClient = {
            eformsign_doc: {
                findFirst: jest.fn().mockResolvedValue({ serviceRecordCaseId: rawQueryCaseId }),
            },
            $queryRaw: jest.fn()
                .mockResolvedValueOnce([{ id: rawQueryCaseId }])
                .mockResolvedValueOnce([lockedSnapshot()])
                .mockResolvedValueOnce([{ id: rawQueryCaseId }])
                .mockResolvedValueOnce([lockedSnapshot()]),
            service_record_case: {
                updateMany: jest.fn().mockResolvedValue({ count: 1 }),
            },
        };
        const prisma = {
            $transaction: jest.fn((callback: (tx: typeof transactionClient) => Promise<unknown>) =>
                callback(transactionClient)),
        };
        const service = new ServiceRecordLifecycleService(prisma as unknown as PrismaService);

        await expect(service.completeServiceRecordSnapshotIfReady({
            branchId: rawQueryBranchId,
            documentId: rawQueryDocumentId,
            mirrorVersion: {
                detailSourceUpdatedDate: new Date("2026-07-30T01:00:00.000Z"),
                detailSyncedAt: new Date("2026-07-30T01:01:00.000Z"),
            },
        })).resolves.toBe(true);

        expect(transactionClient.$queryRaw).toHaveBeenCalledTimes(2);
        const [caseLockQuery] = transactionClient.$queryRaw.mock.calls[0];
        const [snapshotLockQuery] = transactionClient.$queryRaw.mock.calls[1];
        expect(caseLockQuery.strings.join(" ")).toContain("FROM service_record_case");
        expect(caseLockQuery.text.match(/\$\d+::uuid/g)).toHaveLength(2);
        expect(caseLockQuery.strings.join(" ")).toContain("FOR UPDATE");
        expect(snapshotLockQuery.strings.join(" ")).toContain("ORDER BY id ASC");
        expect(snapshotLockQuery.text.match(/\$\d+::uuid/g)).toHaveLength(2);
        expect(snapshotLockQuery.strings.join(" ")).toContain("FOR UPDATE");
        expect(snapshotLockQuery.strings.join(" ")).toContain("file_type = 'document'");
        expect(snapshotLockQuery.strings.join(" ")).toContain("file_type = 'audit_trail'");
        expect(transactionClient.service_record_case.updateMany).toHaveBeenCalledWith(
            expect.objectContaining({
                where: expect.objectContaining({ status: SERVICE_RECORD_CASE_STATUS.DOCUMENTS_CREATED }),
            }),
        );

        transactionClient.service_record_case.updateMany.mockResolvedValue({ count: 0 });
        await expect(service.completeServiceRecordSnapshotIfReady({
            branchId: rawQueryBranchId,
            documentId: rawQueryDocumentId,
        })).resolves.toBe(false);

        expect(transactionClient.$queryRaw).toHaveBeenCalledTimes(4);
    });

    it("does not lock snapshots when the case is absent or no longer awaits documents", async () => {
        const transactionClient = {
            eformsign_doc: {
                findFirst: jest.fn().mockResolvedValue({ serviceRecordCaseId: "case-1" }),
            },
            $queryRaw: jest.fn().mockResolvedValue([]),
            service_record_case: { updateMany: jest.fn() },
        };
        const prisma = {
            $transaction: jest.fn((callback: (tx: typeof transactionClient) => Promise<unknown>) =>
                callback(transactionClient)),
        };
        const service = new ServiceRecordLifecycleService(prisma as unknown as PrismaService);

        await expect(service.completeServiceRecordSnapshotIfReady({
            branchId: "branch-1",
            documentId: "snapshot-062",
        })).resolves.toBe(false);

        expect(transactionClient.$queryRaw).toHaveBeenCalledTimes(1);
        expect(transactionClient.service_record_case.updateMany).not.toHaveBeenCalled();
    });

    it("does not include a permanently purged snapshot tombstone in lifecycle readiness", async () => {
        const transactionClient = {
            // purgeContent clears the service-record linkage before its purge
            // intent is cleared, so a tombstone cannot reveal a client through
            // this lifecycle path or affect case completion.
            eformsign_doc: {
                findFirst: jest.fn().mockResolvedValue(null),
            },
            $queryRaw: jest.fn(),
            service_record_case: { updateMany: jest.fn() },
        };
        const prisma = {
            $transaction: jest.fn((callback: (tx: typeof transactionClient) => Promise<unknown>) =>
                callback(transactionClient)),
        };
        const service = new ServiceRecordLifecycleService(prisma as unknown as PrismaService);

        await expect(service.completeServiceRecordSnapshotIfReady({
            branchId: "branch-1",
            documentId: "purged-snapshot",
        })).resolves.toBe(false);

        expect(transactionClient.eformsign_doc.findFirst).toHaveBeenCalledWith({
            where: expect.objectContaining({
                branchId: "branch-1",
                documentId: "purged-snapshot",
                documentKind: "service_record_snapshot",
                serviceRecordCaseId: { not: null },
            }),
            select: { serviceRecordCaseId: true },
        });
        expect(transactionClient.$queryRaw).not.toHaveBeenCalled();
        expect(transactionClient.service_record_case.updateMany).not.toHaveBeenCalled();
    });

    it("does not mutate a service-record case when the mirror generation fence is stale", async () => {
        const transactionClient = {
            eformsign_doc: {
                findFirst: jest.fn().mockResolvedValue({ serviceRecordCaseId: "case-1" }),
            },
            $queryRaw: jest.fn()
                .mockResolvedValueOnce([{ id: "case-1" }])
                .mockResolvedValueOnce([lockedSnapshot({
                    detailSourceUpdatedDate: new Date("2026-07-30T01:02:00.000Z"),
                })]),
            service_record_case: { updateMany: jest.fn() },
        };
        const prisma = {
            $transaction: jest.fn((callback: (tx: typeof transactionClient) => Promise<unknown>) =>
                callback(transactionClient)),
        };
        const service = new ServiceRecordLifecycleService(prisma as unknown as PrismaService);

        await expect(service.completeServiceRecordSnapshotIfReady({
            branchId: "branch-1",
            documentId: "snapshot-062",
            mirrorVersion: {
                detailSourceUpdatedDate: new Date("2026-07-30T01:00:00.000Z"),
                detailSyncedAt: new Date("2026-07-30T01:01:00.000Z"),
            },
        })).resolves.toBe(false);

        expect(transactionClient.$queryRaw).toHaveBeenCalledTimes(2);
        expect(transactionClient.service_record_case.updateMany).not.toHaveBeenCalled();
    });

    it("does not complete a case while a sibling snapshot is partial", async () => {
        const transactionClient = {
            eformsign_doc: {
                findFirst: jest.fn().mockResolvedValue({ serviceRecordCaseId: "case-1" }),
            },
            $queryRaw: jest.fn()
                .mockResolvedValueOnce([{ id: "case-1" }])
                .mockResolvedValueOnce([
                    lockedSnapshot(),
                    lockedSnapshot({
                        id: 8,
                        documentId: "snapshot-partial",
                        syncStatus: "partial",
                    }),
                ]),
            service_record_case: { updateMany: jest.fn() },
        };
        const prisma = {
            $transaction: jest.fn((callback: (tx: typeof transactionClient) => Promise<unknown>) =>
                callback(transactionClient)),
        };
        const service = new ServiceRecordLifecycleService(prisma as unknown as PrismaService);

        await expect(service.completeServiceRecordSnapshotIfReady({
            branchId: "branch-1",
            documentId: "snapshot-062",
            mirrorVersion: {
                detailSourceUpdatedDate: new Date("2026-07-30T01:00:00.000Z"),
                detailSyncedAt: new Date("2026-07-30T01:01:00.000Z"),
            },
        })).resolves.toBe(false);

        expect(transactionClient.service_record_case.updateMany).not.toHaveBeenCalled();
    });

    it.each([
        ["missing document PDF", { hasCurrentDocumentPdf: false }],
        ["stale document PDF", { hasCurrentDocumentPdf: false }],
        ["missing audit-trail PDF", { hasCurrentAuditTrailPdf: false }],
        ["stale audit-trail PDF", { hasCurrentAuditTrailPdf: false }],
    ])("does not complete a case with a sibling snapshot that has a %s", async (_label, overrides) => {
        const transactionClient = {
            eformsign_doc: {
                findFirst: jest.fn().mockResolvedValue({ serviceRecordCaseId: "case-1" }),
            },
            $queryRaw: jest.fn()
                .mockResolvedValueOnce([{ id: "case-1" }])
                .mockResolvedValueOnce([
                    lockedSnapshot(),
                    lockedSnapshot({ id: 8, documentId: "snapshot-sibling", ...overrides }),
                ]),
            service_record_case: { updateMany: jest.fn() },
        };
        const prisma = {
            $transaction: jest.fn((callback: (tx: typeof transactionClient) => Promise<unknown>) =>
                callback(transactionClient)),
        };
        const service = new ServiceRecordLifecycleService(prisma as unknown as PrismaService);

        await expect(service.completeServiceRecordSnapshotIfReady({
            branchId: "branch-1",
            documentId: "snapshot-062",
            mirrorVersion: {
                detailSourceUpdatedDate: new Date("2026-07-30T01:00:00.000Z"),
                detailSyncedAt: new Date("2026-07-30T01:01:00.000Z"),
            },
        })).resolves.toBe(false);

        expect(transactionClient.service_record_case.updateMany).not.toHaveBeenCalled();
    });

    it("does not mutate a service-record case when a locked snapshot is pending purge", async () => {
        const transactionClient = {
            eformsign_doc: {
                findFirst: jest.fn().mockResolvedValue({ serviceRecordCaseId: "case-1" }),
            },
            $queryRaw: jest.fn()
                .mockResolvedValueOnce([{ id: "case-1" }])
                .mockResolvedValueOnce([lockedSnapshot({
                    permanentPurgeRequestedAt: new Date("2026-07-30T01:02:00.000Z"),
                })]),
            service_record_case: { updateMany: jest.fn() },
        };
        const prisma = {
            $transaction: jest.fn((callback: (tx: typeof transactionClient) => Promise<unknown>) =>
                callback(transactionClient)),
        };
        const service = new ServiceRecordLifecycleService(prisma as unknown as PrismaService);

        await expect(service.completeServiceRecordSnapshotIfReady({
            branchId: "branch-1",
            documentId: "snapshot-062",
            mirrorVersion: {
                detailSourceUpdatedDate: new Date("2026-07-30T01:00:00.000Z"),
                detailSyncedAt: new Date("2026-07-30T01:01:00.000Z"),
            },
        })).resolves.toBe(false);

        expect(transactionClient.service_record_case.updateMany).not.toHaveBeenCalled();
    });

    it("uses the same deterministic parent-row lock order for concurrent snapshot triggers", async () => {
        const snapshots = [
            lockedSnapshot({ id: 7, documentId: "snapshot-a" }),
            lockedSnapshot({ id: 8, documentId: "snapshot-b" }),
        ];
        const transactionClient = {
            eformsign_doc: {
                findFirst: jest.fn().mockResolvedValue({ serviceRecordCaseId: "case-1" }),
            },
            $queryRaw: jest.fn((query: { strings: string[] }) =>
                query.strings.join(" ").includes("FROM service_record_case")
                    ? Promise.resolve([{ id: "case-1" }])
                    : Promise.resolve(snapshots)),
            service_record_case: {
                updateMany: jest.fn().mockResolvedValue({ count: 0 }),
            },
        };
        const prisma = {
            $transaction: jest.fn((callback: (tx: typeof transactionClient) => Promise<unknown>) =>
                callback(transactionClient)),
        };
        const service = new ServiceRecordLifecycleService(prisma as unknown as PrismaService);

        await Promise.all([
            service.completeServiceRecordSnapshotIfReady({
                branchId: "branch-1",
                documentId: "snapshot-a",
            }),
            service.completeServiceRecordSnapshotIfReady({
                branchId: "branch-1",
                documentId: "snapshot-b",
            }),
        ]);

        expect(transactionClient.$queryRaw).toHaveBeenCalledTimes(4);
        const lockQueries = transactionClient.$queryRaw.mock.calls.map(([query]) => query.strings.join(" "));
        expect(lockQueries.filter((query) => query.includes("FROM service_record_case"))).toHaveLength(2);
        expect(lockQueries.filter((query) => query.includes("ORDER BY id ASC"))).toHaveLength(2);
        expect(lockQueries).toEqual(expect.arrayContaining([
            expect.stringContaining("FROM service_record_case"),
            expect.stringContaining("ORDER BY id ASC"),
        ]));
    });

    it("allows shortening the period while preserving saved rows outside it", async () => {
        const prisma = {
            service_record_case: {
                findUnique: jest.fn().mockResolvedValue({
                    status: SERVICE_RECORD_CASE_STATUS.IN_PROGRESS,
                    startDate: date("2026-07-01"),
                    endDate: date("2026-07-20"),
                    requiredSessionCount: 10,
                    days: [{ serviceDate: date("2026-07-12"), locked: false }],
                }),
            },
        };
        const service = new ServiceRecordLifecycleService(prisma as unknown as PrismaService);

        await expect(service.validatePeriodChange({
            clientId: 1,
            endDate: date("2026-07-11"),
        })).resolves.toBeUndefined();
    });

    it("does not allow clearing or reducing the contracted session count after recording starts", async () => {
        const prisma = {
            service_record_case: {
                findUnique: jest.fn().mockResolvedValue({
                    status: SERVICE_RECORD_CASE_STATUS.IN_PROGRESS,
                    startDate: date("2026-07-01"),
                    endDate: date("2026-07-20"),
                    requiredSessionCount: 10,
                    days: [{ serviceDate: date("2026-07-02"), locked: true }],
                }),
            },
        };
        const service = new ServiceRecordLifecycleService(prisma as unknown as PrismaService);

        await expectConflict(
            service.validatePeriodChange({ clientId: 1, duration: null }),
            "SERVICE_RECORD_DURATION_REQUIRED",
        );
        await expectConflict(
            service.validatePeriodChange({ clientId: 1, duration: 9 }),
            "SERVICE_RECORD_DURATION_CANNOT_DECREASE",
        );
    });

    it("moves a complete in-period record to READY_TO_FINALIZE while preserving outside rows", async () => {
        jest.useFakeTimers({ now: new Date("2026-08-10T00:00:00.000Z") });
        const record = {
            id: "case-1",
            status: SERVICE_RECORD_CASE_STATUS.IN_PROGRESS,
            startDate: date("2026-08-03"),
            endDate: date("2026-08-10"),
            requiredSessionCount: 15,
            finalizationDueAt: new Date("2026-08-10T11:00:00.000Z"),
            completedAt: null,
            momName: "산모",
            momBirth: "900101",
            babyName: "아기",
            babyBirth: "260701",
            deliveryType: "자연분만",
            babyWeight: "3.2",
            assignments: [{ schedule: { replaced: false } }],
            days: [
                ...["2026-08-03", "2026-08-04", "2026-08-05", "2026-08-06", "2026-08-07", "2026-08-10"]
                    .map((serviceDate, index) => ({
                        caseSessionIndex: index + 1,
                        serviceDate: date(serviceDate),
                        locked: true,
                        momApproval: "approved",
                    })),
                {
                    caseSessionIndex: 7,
                    serviceDate: date("2026-08-11"),
                    locked: true,
                    momApproval: "approved",
                },
            ],
        };
        const prisma = {
            service_record_case: {
                findUnique: jest.fn().mockResolvedValue(record),
                update: jest.fn().mockImplementation(({ data }) => Promise.resolve({ ...record, ...data })),
            },
        };
        const service = new ServiceRecordLifecycleService(prisma as unknown as PrismaService);

        await service.recompute("case-1");

        expect(prisma.service_record_case.update).toHaveBeenCalledWith(expect.objectContaining({
            data: expect.objectContaining({
                status: SERVICE_RECORD_CASE_STATUS.READY_TO_FINALIZE,
                completedAt: expect.any(Date),
                requiredSessionCount: 6,
            }),
        }));
    });
});
