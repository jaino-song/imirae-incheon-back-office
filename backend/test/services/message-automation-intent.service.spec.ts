import { MessageAutomationIntentService } from "application/services/message-automation-intent.service";
import {
    getEmployeeAutomationIntentDedupeKey,
    MESSAGE_AUTOMATION_INTENT_INVALID_REASON,
    MESSAGE_AUTOMATION_INTENT_RETRY_REASON,
    MESSAGE_AUTOMATION_INTENT_RULE_ID,
} from "domain/constants/message-automation-intent";
import { MessageTriggerTemplateKey } from "domain/constants/message-trigger-catalog";
import { createSchedulerLeaseMock } from "../utils/mocks/scheduler-lease.mock";

describe("MessageAutomationIntentService", () => {
    const setup = (schedulerLease: ReturnType<typeof createSchedulerLeaseMock> = createSchedulerLeaseMock()) => {
        const prisma = {
            $queryRaw: jest.fn().mockResolvedValue([{
                id: "intent-1",
                scheduled_for: new Date("2026-08-20T01:02:03.000Z"),
                updated_at: new Date("2026-08-20T01:02:04.000Z"),
            }]),
            branch: {
                findUnique: jest.fn().mockResolvedValue({
                    smsSenderApprovalStatus: "approved",
                }),
            },
            employee: {
                findFirst: jest.fn().mockResolvedValue({ id: 31, deletedAt: null }),
            },
            message_trigger_job: {
                findMany: jest.fn().mockResolvedValue([]),
                updateMany: jest.fn().mockResolvedValue({ count: 1 }),
                deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
            },
            $transaction: jest.fn(),
        };
        const triggerService = {
            ensureDefaultRulesForBranch: jest.fn().mockResolvedValue(undefined),
            syncClientRulesForClient: jest.fn().mockResolvedValue(undefined),
            syncEmployeeAssignmentRulesForSchedule: jest.fn().mockResolvedValue(undefined),
            syncEmployeeAssignmentRulesForEmployee: jest.fn().mockResolvedValue(true),
        };
        const serviceRecordLinkService = {
            scheduleForServiceStart: jest.fn().mockResolvedValue(true),
        };
        const transaction = {
            message_trigger_rule: {
                upsert: jest.fn().mockResolvedValue(undefined),
            },
            message_trigger_job: {
                updateMany: jest.fn().mockResolvedValue({ count: 1 }),
                upsert: jest.fn().mockResolvedValue(undefined),
            },
        };
        prisma.$transaction.mockImplementation(
            async (operation: (tx: typeof transaction) => Promise<unknown>) => operation(transaction),
        );
        return {
            prisma,
            triggerService,
            serviceRecordLinkService,
            transaction,
            schedulerLease,
            service: new MessageAutomationIntentService(
                prisma as never,
                triggerService as never,
                serviceRecordLinkService as never,
                schedulerLease,
            ),
        };
    };

    it("stores a client intent as a failed internal job in the supplied transaction", async () => {
        const { service, transaction } = setup();
        const intentAt = new Date("2026-08-20T01:02:03.000Z");

        await service.persistClientIntent(transaction as never, {
            branchId: "branch-1",
            clientId: 31,
            includePast: true,
            suppressGreeting: true,
            intentAt,
        });

        expect(transaction.message_trigger_rule.upsert).toHaveBeenCalledWith(
            expect.objectContaining({ where: { id: MESSAGE_AUTOMATION_INTENT_RULE_ID } }),
        );
        expect(transaction.message_trigger_job.upsert).toHaveBeenCalledWith(
            expect.objectContaining({
                create: expect.objectContaining({
                    branchId: "branch-1",
                    clientId: 31,
                    status: "failed",
                    cancelReason: MESSAGE_AUTOMATION_INTENT_RETRY_REASON,
                    scheduledFor: intentAt,
                    nextAttemptAt: intentAt,
                }),
            }),
        );
    });

    it("stores an employee profile refresh intent with a branch-scoped dedupe key and JSON employee id", async () => {
        const { service, transaction } = setup();
        const intentAt = new Date("2026-08-20T01:02:03.000Z");

        await service.persistEmployeeProfileRefreshIntent(transaction as never, {
            branchId: "branch-1",
            employeeId: 31,
            intentAt,
        });

        expect(transaction.message_trigger_job.upsert).toHaveBeenCalledWith(
            expect.objectContaining({
                where: { dedupeKey: getEmployeeAutomationIntentDedupeKey("branch-1", 31) },
                create: expect.objectContaining({
                    branchId: "branch-1",
                    clientId: null,
                    employeeScheduleId: null,
                    dedupeKey: getEmployeeAutomationIntentDedupeKey("branch-1", 31),
                    status: "failed",
                    cancelReason: MESSAGE_AUTOMATION_INTENT_RETRY_REASON,
                    scheduledFor: intentAt,
                    nextAttemptAt: intentAt,
                    payload: expect.objectContaining({
                        employeeId: 31,
                        templateVariables: expect.objectContaining({ intentKind: "employee" }),
                    }),
                }),
            }),
        );
    });

    it("coalesces repeated employee refresh failures through the same durable upsert key", async () => {
        const { service, transaction } = setup();
        const firstIntentAt = new Date("2026-08-20T01:02:03.000Z");
        const secondIntentAt = new Date("2026-08-20T01:04:03.000Z");

        await service.persistEmployeeProfileRefreshIntent(transaction as never, {
            branchId: "branch-1",
            employeeId: 31,
            intentAt: firstIntentAt,
        });
        await service.persistEmployeeProfileRefreshIntent(transaction as never, {
            branchId: "branch-1",
            employeeId: 31,
            intentAt: secondIntentAt,
        });

        expect(transaction.message_trigger_job.upsert).toHaveBeenCalledTimes(2);
        expect(transaction.message_trigger_job.upsert.mock.calls[0]?.[0].where).toEqual({
            dedupeKey: getEmployeeAutomationIntentDedupeKey("branch-1", 31),
        });
        expect(transaction.message_trigger_job.upsert.mock.calls[1]?.[0].where).toEqual({
            dedupeKey: getEmployeeAutomationIntentDedupeKey("branch-1", 31),
        });
        expect(transaction.message_trigger_job.upsert.mock.calls[1]?.[0].update).toEqual(
            expect.objectContaining({
                scheduledFor: secondIntentAt,
                nextAttemptAt: secondIntentAt,
                attempts: 0,
                status: "failed",
            }),
        );
    });

    it("runs an employee refresh intent through reconciliation and deletes it only after success", async () => {
        const { service, prisma, triggerService } = setup();
        const scheduledFor = new Date("2026-08-20T01:02:03.000Z");
        const updatedAt = new Date("2026-08-20T01:02:04.000Z");
        prisma.message_trigger_job.findMany.mockResolvedValue([{
            id: "employee-intent",
            branchId: "branch-1",
            clientId: null,
            employeeScheduleId: null,
            scheduledFor,
            updatedAt,
            payload: {
                employeeId: 31,
                templateVariables: { intentKind: "employee" },
            },
        }]);
        prisma.$queryRaw.mockResolvedValue([{
            id: "employee-intent",
            scheduled_for: scheduledFor,
            updated_at: updatedAt,
        }]);

        await expect(service.reconcilePendingIntents(new Date("2026-08-20T01:05:00.000Z"))).resolves.toBe(1);

        expect(prisma.employee.findFirst).toHaveBeenCalledWith({
            where: { id: 31, branchId: "branch-1" },
            select: { id: true, deletedAt: true },
        });
        expect(triggerService.syncEmployeeAssignmentRulesForEmployee)
            .toHaveBeenCalledWith("branch-1", 31);
        expect(prisma.message_trigger_job.deleteMany).toHaveBeenCalledWith(
            expect.objectContaining({ where: expect.objectContaining({ id: "employee-intent" }) }),
        );
    });

    it("keeps an employee refresh intent retryable when generation fails", async () => {
        const { service, prisma, triggerService } = setup();
        triggerService.syncEmployeeAssignmentRulesForEmployee.mockRejectedValue(
            new Error("employee assignment refresh unavailable"),
        );

        await expect(service.fulfillEmployeeProfileRefreshIntent({
            branchId: "branch-1",
            employeeId: 31,
        })).rejects.toThrow("employee assignment refresh unavailable");

        expect(prisma.message_trigger_job.updateMany).toHaveBeenCalledWith(
            expect.objectContaining({
                where: expect.objectContaining({ id: "intent-1" }),
                data: { nextAttemptAt: expect.any(Date) },
            }),
        );
        expect(prisma.message_trigger_job.deleteMany).not.toHaveBeenCalled();
    });

    it("keeps an employee refresh intent retryable when generation reports a stale result", async () => {
        const { service, prisma, triggerService } = setup();
        triggerService.syncEmployeeAssignmentRulesForEmployee.mockResolvedValue(false);

        await expect(service.fulfillEmployeeProfileRefreshIntent({
            branchId: "branch-1",
            employeeId: 31,
        })).resolves.toBe(false);

        expect(prisma.message_trigger_job.updateMany).toHaveBeenCalledWith(
            expect.objectContaining({
                where: expect.objectContaining({ id: "intent-1" }),
                data: { nextAttemptAt: expect.any(Date) },
            }),
        );
        expect(prisma.message_trigger_job.deleteMany).not.toHaveBeenCalled();
    });

    it.each([
        ["missing", null],
        ["deleted", { id: 31, deletedAt: new Date("2026-08-20T01:03:00.000Z") }],
    ])("discards a %s employee refresh intent as terminal", async (_label, employee) => {
        const { service, prisma, triggerService } = setup();
        prisma.employee.findFirst.mockResolvedValue(employee);

        await expect(service.fulfillEmployeeProfileRefreshIntent({
            branchId: "branch-1",
            employeeId: 31,
        })).resolves.toBe(true);

        expect(triggerService.syncEmployeeAssignmentRulesForEmployee).not.toHaveBeenCalled();
        expect(prisma.message_trigger_job.deleteMany).toHaveBeenCalledWith(
            expect.objectContaining({ where: expect.objectContaining({ id: "intent-1" }) }),
        );
        expect(prisma.message_trigger_job.updateMany).not.toHaveBeenCalled();
    });

    it("keeps employee intent lookup and refresh branch-scoped", async () => {
        const { service, prisma, triggerService } = setup();

        await expect(service.fulfillEmployeeProfileRefreshIntent({
            branchId: "branch-2",
            employeeId: 31,
        })).resolves.toBe(true);

        expect(prisma.employee.findFirst).toHaveBeenCalledWith(expect.objectContaining({
            where: { id: 31, branchId: "branch-2" },
        }));
        expect(triggerService.syncEmployeeAssignmentRulesForEmployee)
            .toHaveBeenCalledWith("branch-2", 31);
    });

    it("cancels pending schedule jobs in the update transaction before replacing their generation", async () => {
        const { service, transaction } = setup();
        const intentAt = new Date("2026-08-20T01:02:03.000Z");

        await service.persistScheduleIntent(transaction as never, {
            branchId: "branch-1",
            clientId: 31,
            scheduleId: 72,
            includePast: true,
            intentAt,
            replaceExisting: true,
        });

        expect(transaction.message_trigger_job.updateMany).toHaveBeenCalledWith({
            where: {
                branchId: "branch-1",
                employeeScheduleId: 72,
                templateKey: MessageTriggerTemplateKey.EMPLOYEE_ASSIGNED,
                status: "pending",
                canceledByUser: false,
            },
            data: {
                status: "canceled",
                canceledAt: intentAt,
                cancelReason: "Employee assignment changed",
                nextAttemptAt: null,
            },
        });
        expect(transaction.message_trigger_job.upsert).toHaveBeenCalledWith(
            expect.objectContaining({
                create: expect.objectContaining({
                    payload: expect.objectContaining({
                        templateVariables: expect.objectContaining({ replaceExisting: "true" }),
                    }),
                }),
            }),
        );
    });

    it("releases a claim when sender approval is revoked after the atomic claim", async () => {
        const { service, prisma, triggerService } = setup();
        prisma.branch.findUnique.mockResolvedValue({ smsSenderApprovalStatus: "pending" });

        await expect(service.fulfillClientIntent({
            branchId: "branch-1",
            clientId: 31,
            includePast: true,
            suppressGreeting: false,
        })).resolves.toBe(false);

        expect(triggerService.ensureDefaultRulesForBranch).not.toHaveBeenCalled();
        expect(triggerService.syncClientRulesForClient).not.toHaveBeenCalled();
        expect(prisma.message_trigger_job.updateMany).toHaveBeenCalledWith(
            expect.objectContaining({
                where: expect.objectContaining({ id: "intent-1" }),
                data: {
                    attempts: 0,
                    nextAttemptAt: expect.any(Date),
                },
            }),
        );
        expect(prisma.message_trigger_job.deleteMany).not.toHaveBeenCalled();
    });

    it("atomically defers an unapproved due intent so it cannot starve the reconciliation batch", async () => {
        const { service, prisma, triggerService } = setup();
        prisma.$queryRaw.mockResolvedValue([]);

        await expect(service.fulfillClientIntent({
            branchId: "branch-1",
            clientId: 31,
            includePast: true,
            suppressGreeting: false,
        })).resolves.toBe(false);

        expect(triggerService.ensureDefaultRulesForBranch).not.toHaveBeenCalled();
        expect(triggerService.syncClientRulesForClient).not.toHaveBeenCalled();
        expect(prisma.branch.findUnique).not.toHaveBeenCalled();
        expect(prisma.message_trigger_job.updateMany).not.toHaveBeenCalled();

        const claimQuery = prisma.$queryRaw.mock.calls[0]?.[0] as {
            strings?: readonly string[];
            values?: readonly unknown[];
        };
        const claimSql = claimQuery.strings?.join("?") ?? "";
        expect(claimSql).toContain("LEFT JOIN \"branch\"");
        expect(claimSql).toContain("FOR UPDATE OF job SKIP LOCKED");
        expect(claimSql).toContain("next_attempt_at = CASE");
        expect(claimSql).toContain("ELSE 0");
        expect(claimSql).toContain("WHERE is_approved");
        expect(claimQuery.values).toContain(5 * 60 * 1000);
    });

    it("rebases again when approval is restored after a claimed intent was released", async () => {
        const { service, prisma, triggerService } = setup();
        const revokedClaimAt = new Date("2026-08-20T01:02:03.000Z");
        const restoredClaimAt = new Date("2026-08-22T01:02:03.000Z");
        prisma.$queryRaw
            .mockResolvedValueOnce([{
                id: "intent-1",
                scheduled_for: revokedClaimAt,
            }])
            .mockResolvedValueOnce([{
                id: "intent-1",
                scheduled_for: restoredClaimAt,
            }]);
        prisma.branch.findUnique
            .mockResolvedValueOnce({ smsSenderApprovalStatus: "pending" })
            .mockResolvedValue({ smsSenderApprovalStatus: "approved" });
        const params = {
            branchId: "branch-1",
            clientId: 31,
            includePast: true,
            suppressGreeting: false,
        };

        await expect(service.fulfillClientIntent(params)).resolves.toBe(false);
        await expect(service.fulfillClientIntent(params)).resolves.toBe(true);

        expect(prisma.message_trigger_job.updateMany).toHaveBeenCalledWith(
            expect.objectContaining({
                data: {
                    attempts: 0,
                    nextAttemptAt: expect.any(Date),
                },
            }),
        );
        expect(triggerService.syncClientRulesForClient).toHaveBeenCalledTimes(1);
        expect(triggerService.syncClientRulesForClient).toHaveBeenCalledWith(
            "branch-1",
            31,
            true,
            false,
            {
                stableBatchAt: restoredClaimAt,
                preserveExisting: true,
            },
        );
    });

    it("releases a client intent when zero-job rule generation fails", async () => {
        const { service, prisma, triggerService } = setup();
        triggerService.syncClientRulesForClient.mockRejectedValue(new Error("sync unavailable"));

        await expect(service.fulfillClientIntent({
            branchId: "branch-1",
            clientId: 31,
            includePast: true,
            suppressGreeting: false,
        })).rejects.toThrow("sync unavailable");

        expect(prisma.message_trigger_job.updateMany).toHaveBeenCalledWith(
            expect.objectContaining({ where: expect.objectContaining({ id: "intent-1" }) }),
        );
        expect(prisma.message_trigger_job.deleteMany).not.toHaveBeenCalled();
    });

    it("rebases a client intent delayed beyond 24 hours to its first approved claim", async () => {
        jest.useFakeTimers().setSystemTime(new Date("2026-08-22T01:02:03.000Z"));
        try {
            const { service, prisma, triggerService, transaction } = setup();
            const persistedWhileApprovalPendingAt = new Date("2026-08-20T01:02:03.000Z");
            const firstApprovedClaimAt = new Date("2026-08-22T01:02:03.000Z");
            prisma.$queryRaw.mockResolvedValue([{
                id: "intent-1",
                scheduled_for: firstApprovedClaimAt,
            }]);

            await service.persistClientIntent(transaction as never, {
                branchId: "branch-1",
                clientId: 31,
                includePast: true,
                suppressGreeting: false,
                intentAt: persistedWhileApprovalPendingAt,
            });

            await expect(service.fulfillClientIntent({
                branchId: "branch-1",
                clientId: 31,
                includePast: true,
                suppressGreeting: false,
            })).resolves.toBe(true);

            expect(triggerService.syncClientRulesForClient).toHaveBeenCalledWith(
                "branch-1",
                31,
                true,
                false,
                {
                    stableBatchAt: firstApprovedClaimAt,
                    preserveExisting: true,
                },
            );
            const claimQuery = prisma.$queryRaw.mock.calls[0]?.[0] as {
                strings?: readonly string[];
            };
            const claimSql = claimQuery.strings?.join("?") ?? "";
            expect(claimSql).toContain("sms_sender_approval_status");
            expect(claimSql).toContain("scheduled_for = CASE");
            expect(claimSql).toContain("job.attempts = 0");
            expect(firstApprovedClaimAt.getTime() - persistedWhileApprovalPendingAt.getTime())
                .toBeGreaterThan(24 * 60 * 60 * 1000);
        } finally {
            jest.useRealTimers();
        }
    });

    it("reuses the same stable generation after intent deletion fails", async () => {
        const { service, prisma, triggerService } = setup();
        prisma.message_trigger_job.deleteMany
            .mockRejectedValueOnce(new Error("delete unavailable"))
            .mockResolvedValueOnce({ count: 1 });

        const params = {
            branchId: "branch-1",
            clientId: 31,
            includePast: true,
            suppressGreeting: false,
        };
        await expect(service.fulfillClientIntent(params)).rejects.toThrow("delete unavailable");
        await expect(service.fulfillClientIntent(params)).resolves.toBe(true);

        expect(triggerService.syncClientRulesForClient).toHaveBeenCalledTimes(2);
        expect(triggerService.syncClientRulesForClient.mock.calls[1]).toEqual(
            triggerService.syncClientRulesForClient.mock.calls[0],
        );
        expect(triggerService.syncClientRulesForClient).toHaveBeenLastCalledWith(
            "branch-1",
            31,
            true,
            false,
            {
                stableBatchAt: new Date("2026-08-20T01:02:03.000Z"),
                preserveExisting: true,
            },
        );
        expect(prisma.message_trigger_job.updateMany).toHaveBeenCalledTimes(1);
        expect(prisma.message_trigger_job.updateMany.mock.calls[0]?.[0].data).toEqual({
            nextAttemptAt: expect.any(Date),
        });
    });

    it("allows only one concurrent worker to fulfill a client intent", async () => {
        const { service, prisma, triggerService } = setup();
        prisma.$queryRaw
            .mockResolvedValueOnce([{
                id: "intent-1",
                scheduled_for: new Date("2026-08-20T01:02:03.000Z"),
            }])
            .mockResolvedValueOnce([]);
        const params = {
            branchId: "branch-1",
            clientId: 31,
            includePast: true,
            suppressGreeting: false,
        };

        await expect(Promise.all([
            service.fulfillClientIntent(params),
            service.fulfillClientIntent(params),
        ])).resolves.toEqual([true, false]);

        expect(triggerService.syncClientRulesForClient).toHaveBeenCalledTimes(1);
        expect(prisma.message_trigger_job.deleteMany).toHaveBeenCalledTimes(1);
    });

    it("releases a schedule intent when service-record scheduling fails before its own marker", async () => {
        const { service, prisma, triggerService, serviceRecordLinkService } = setup();
        serviceRecordLinkService.scheduleForServiceStart.mockRejectedValue(
            new Error("preflight unavailable"),
        );

        await expect(service.fulfillScheduleIntent({
            branchId: "branch-1",
            scheduleId: 72,
            includePast: true,
        })).rejects.toThrow("preflight unavailable");

        expect(triggerService.syncEmployeeAssignmentRulesForSchedule).toHaveBeenCalledWith(
            "branch-1",
            72,
            true,
            { preserveExisting: true },
        );
        expect(prisma.message_trigger_job.updateMany).toHaveBeenCalledWith(
            expect.objectContaining({ where: expect.objectContaining({ id: "intent-1" }) }),
        );
        expect(prisma.message_trigger_job.deleteMany).not.toHaveBeenCalled();
    });

    it("rebuilds schedule jobs after an update instead of preserving the previous generation", async () => {
        const { service, triggerService, prisma, serviceRecordLinkService } = setup();

        await expect(service.fulfillScheduleIntent({
            branchId: "branch-1",
            scheduleId: 72,
            includePast: true,
            replaceExisting: true,
        })).resolves.toBe(true);

        expect(triggerService.syncEmployeeAssignmentRulesForSchedule).toHaveBeenCalledWith(
            "branch-1",
            72,
            true,
            { preserveExisting: false },
        );
        expect(serviceRecordLinkService.scheduleForServiceStart).toHaveBeenCalledWith(72);
        expect(prisma.message_trigger_job.deleteMany).toHaveBeenCalledWith(
            expect.objectContaining({ where: expect.objectContaining({ id: "intent-1" }) }),
        );
    });

    it("retains a schedule intent when job generation reports a retryable result", async () => {
        const { service, prisma, triggerService, serviceRecordLinkService } = setup();
        triggerService.syncEmployeeAssignmentRulesForSchedule.mockResolvedValue(false);

        await expect(service.fulfillScheduleIntent({
            branchId: "branch-1",
            scheduleId: 72,
            includePast: true,
            replaceExisting: true,
        })).resolves.toBe(false);

        expect(prisma.message_trigger_job.updateMany).toHaveBeenCalledWith(
            expect.objectContaining({
                where: expect.objectContaining({ id: "intent-1" }),
                data: { nextAttemptAt: expect.any(Date) },
            }),
        );
        expect(prisma.message_trigger_job.deleteMany).not.toHaveBeenCalled();
        expect(serviceRecordLinkService.scheduleForServiceStart).not.toHaveBeenCalled();
    });

    it("does not generate schedule jobs while sender approval is absent", async () => {
        const { service, prisma, triggerService, serviceRecordLinkService } = setup();
        prisma.branch.findUnique.mockResolvedValue({ smsSenderApprovalStatus: "pending" });

        await expect(service.fulfillScheduleIntent({
            branchId: "branch-1",
            scheduleId: 72,
            includePast: true,
            replaceExisting: true,
        })).resolves.toBe(false);

        expect(triggerService.syncEmployeeAssignmentRulesForSchedule).not.toHaveBeenCalled();
        expect(serviceRecordLinkService.scheduleForServiceStart).not.toHaveBeenCalled();
    });

    it("retains the schedule intent when job generation fails so reconciliation can retry it", async () => {
        const { service, prisma, triggerService } = setup();
        triggerService.syncEmployeeAssignmentRulesForSchedule.mockRejectedValue(
            new Error("schedule sync unavailable"),
        );

        await expect(service.fulfillScheduleIntent({
            branchId: "branch-1",
            scheduleId: 72,
            includePast: true,
            replaceExisting: true,
        })).rejects.toThrow("schedule sync unavailable");

        expect(prisma.message_trigger_job.updateMany).toHaveBeenCalledWith(
            expect.objectContaining({ where: expect.objectContaining({ id: "intent-1" }) }),
        );
        expect(prisma.message_trigger_job.deleteMany).not.toHaveBeenCalled();
    });

    it("does not let an older post-commit caller claim a newer replacement marker", async () => {
        const { service, prisma, triggerService, serviceRecordLinkService } = setup();
        const olderIntentAt = new Date("2026-08-20T01:02:03.000Z");
        const newerIntentAt = new Date("2026-08-20T01:02:05.000Z");
        const newerClaimedAt = new Date("2026-08-20T01:02:06.000Z");
        prisma.$queryRaw
            .mockResolvedValueOnce([])
            .mockResolvedValueOnce([{
                id: "intent-1",
                scheduled_for: newerIntentAt,
                updated_at: newerClaimedAt,
            }]);

        await expect(service.fulfillScheduleIntent({
            branchId: "branch-1",
            scheduleId: 72,
            includePast: true,
            intentAt: olderIntentAt,
        })).resolves.toBe(false);
        await expect(service.fulfillScheduleIntent({
            branchId: "branch-1",
            scheduleId: 72,
            includePast: true,
            replaceExisting: true,
            intentAt: newerIntentAt,
        })).resolves.toBe(true);

        expect(triggerService.syncEmployeeAssignmentRulesForSchedule).toHaveBeenCalledTimes(1);
        expect(serviceRecordLinkService.scheduleForServiceStart).toHaveBeenCalledTimes(1);
        const staleClaimQuery = prisma.$queryRaw.mock.calls[0]?.[0] as {
            strings?: readonly string[];
            values?: readonly unknown[];
        };
        expect(staleClaimQuery.strings?.join("?")).toContain("scheduled_for =");
        expect(staleClaimQuery.values).toContain(olderIntentAt);
    });

    it("does not delete a replacement marker when it is persisted during an older claim", async () => {
        const { service, prisma, triggerService, transaction } = setup();
        const olderIntentAt = new Date("2026-08-20T01:02:03.000Z");
        const olderClaimVersion = new Date("2026-08-20T01:02:04.000Z");
        const newerIntentAt = new Date("2026-08-20T01:02:05.000Z");
        const newerClaimVersion = new Date("2026-08-20T01:02:06.000Z");
        let replacementPersisted = false;
        let finishOlderSync: (() => void) | undefined;
        let olderSyncStarted: (() => void) | undefined;
        const olderSyncReady = new Promise<void>((resolve) => {
            olderSyncStarted = resolve;
        });
        triggerService.syncEmployeeAssignmentRulesForSchedule.mockImplementationOnce(
            () => {
                olderSyncStarted?.();
                return new Promise<void>((resolve) => {
                    finishOlderSync = resolve;
                });
            },
        );
        prisma.$queryRaw
            .mockResolvedValueOnce([{
                id: "intent-1",
                scheduled_for: olderIntentAt,
                updated_at: olderClaimVersion,
            }])
            .mockResolvedValueOnce([{
                id: "intent-1",
                scheduled_for: newerIntentAt,
                updated_at: newerClaimVersion,
            }]);
        transaction.message_trigger_job.upsert.mockImplementation(async () => {
            replacementPersisted = true;
        });
        prisma.message_trigger_job.deleteMany.mockImplementation(async (query) => {
            const where = query.where as { scheduledFor?: Date };
            return {
                count: replacementPersisted && where.scheduledFor?.getTime() === olderIntentAt.getTime()
                    ? 0
                    : 1,
            };
        });

        const olderFulfillment = service.fulfillScheduleIntent({
            branchId: "branch-1",
            scheduleId: 72,
            includePast: true,
            replaceExisting: true,
            intentAt: olderIntentAt,
        });
        await olderSyncReady;
        await service.persistScheduleIntent(transaction as never, {
            branchId: "branch-1",
            clientId: 31,
            scheduleId: 72,
            includePast: true,
            intentAt: newerIntentAt,
            replaceExisting: true,
        });
        finishOlderSync?.();

        await expect(olderFulfillment).resolves.toBe(false);
        expect(prisma.message_trigger_job.deleteMany).toHaveBeenCalledWith(
            expect.objectContaining({
                where: expect.objectContaining({
                    id: "intent-1",
                    scheduledFor: olderIntentAt,
                    updatedAt: olderClaimVersion,
                }),
            }),
        );
        await expect(service.fulfillScheduleIntent({
            branchId: "branch-1",
            scheduleId: 72,
            includePast: true,
            replaceExisting: true,
            intentAt: newerIntentAt,
        })).resolves.toBe(true);
    });

    it("reconciles both durable intent kinds and removes them only after successful generation", async () => {
        const {
            service,
            prisma,
            triggerService,
            serviceRecordLinkService,
        } = setup();
        prisma.message_trigger_job.findMany.mockResolvedValue([
            {
                id: "client-intent",
                branchId: "branch-1",
                clientId: 31,
                employeeScheduleId: null,
                scheduledFor: new Date("2026-08-20T01:02:03.000Z"),
                updatedAt: new Date("2026-08-20T01:02:04.000Z"),
                payload: {
                    templateVariables: {
                        intentKind: "client",
                        includePast: "true",
                        suppressGreeting: "true",
                    },
                },
            },
            {
                id: "schedule-intent",
                branchId: "branch-1",
                clientId: 31,
                employeeScheduleId: 72,
                scheduledFor: new Date("2026-08-20T01:02:03.000Z"),
                updatedAt: new Date("2026-08-20T01:02:04.000Z"),
                payload: {
                    templateVariables: {
                        intentKind: "schedule",
                        includePast: "true",
                        suppressGreeting: "false",
                        replaceExisting: "true",
                    },
                },
            },
        ]);
        prisma.$queryRaw
            .mockResolvedValueOnce([{
                id: "client-intent",
                scheduled_for: new Date("2026-08-20T01:02:03.000Z"),
                updated_at: new Date("2026-08-20T01:02:04.000Z"),
            }])
            .mockResolvedValueOnce([{
                id: "schedule-intent",
                scheduled_for: new Date("2026-08-20T01:02:03.000Z"),
                updated_at: new Date("2026-08-20T01:02:04.000Z"),
            }]);

        await expect(service.reconcilePendingIntents(
            new Date("2026-08-20T01:05:00.000Z"),
        )).resolves.toBe(2);

        expect(triggerService.syncClientRulesForClient)
            .toHaveBeenCalledWith(
                "branch-1",
                31,
                true,
                true,
                {
                    stableBatchAt: new Date("2026-08-20T01:02:03.000Z"),
                    preserveExisting: true,
                },
            );
        expect(triggerService.syncEmployeeAssignmentRulesForSchedule)
            .toHaveBeenCalledWith(
                "branch-1",
                72,
                true,
                { preserveExisting: false },
            );
        expect(serviceRecordLinkService.scheduleForServiceStart).toHaveBeenCalledWith(72);
        expect(prisma.message_trigger_job.deleteMany).toHaveBeenCalledTimes(2);
    });

    it("removes orphaned markers and quarantines malformed markers so they cannot starve the queue", async () => {
        const { service, prisma } = setup();
        prisma.message_trigger_job.findMany.mockResolvedValue([
            {
                id: "orphan-intent",
                branchId: "branch-1",
                clientId: 31,
                employeeScheduleId: null,
                scheduledFor: new Date("2026-08-20T01:02:03.000Z"),
                updatedAt: new Date("2026-08-20T01:02:04.000Z"),
                payload: {
                    templateVariables: {
                        intentKind: "schedule",
                        includePast: "true",
                    },
                },
            },
            {
                id: "malformed-intent",
                branchId: "branch-1",
                clientId: 31,
                employeeScheduleId: null,
                scheduledFor: new Date("2026-08-20T01:02:03.000Z"),
                updatedAt: new Date("2026-08-20T01:02:04.000Z"),
                payload: {
                    templateVariables: {
                        intentKind: "unexpected",
                    },
                },
            },
        ]);

        await expect(service.reconcilePendingIntents()).resolves.toBe(0);

        expect(prisma.message_trigger_job.deleteMany).toHaveBeenCalledWith({
            where: expect.objectContaining({ id: "orphan-intent" }),
        });
        expect(prisma.message_trigger_job.updateMany).toHaveBeenCalledWith({
            where: expect.objectContaining({ id: "malformed-intent" }),
            data: {
                cancelReason: MESSAGE_AUTOMATION_INTENT_INVALID_REASON,
                nextAttemptAt: null,
            },
        });
        expect(prisma.$queryRaw).not.toHaveBeenCalled();
    });

    it("skips the run when the scheduler lease is not held", async () => {
        const { service, prisma } = setup(createSchedulerLeaseMock(false));

        await expect(service.reconcilePendingIntents()).resolves.toBe(0);

        expect(prisma.message_trigger_job.findMany).not.toHaveBeenCalled();
    });
});
