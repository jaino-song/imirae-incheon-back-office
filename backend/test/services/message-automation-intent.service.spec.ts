import { MessageAutomationIntentService } from "application/services/message-automation-intent.service";
import {
    MESSAGE_AUTOMATION_INTENT_INVALID_REASON,
    MESSAGE_AUTOMATION_INTENT_RETRY_REASON,
    MESSAGE_AUTOMATION_INTENT_RULE_ID,
} from "domain/constants/message-automation-intent";

describe("MessageAutomationIntentService", () => {
    const setup = () => {
        const prisma = {
            $queryRaw: jest.fn().mockResolvedValue([{
                id: "intent-1",
                scheduled_for: new Date("2026-08-20T01:02:03.000Z"),
            }]),
            branch: {
                findUnique: jest.fn().mockResolvedValue({
                    smsSenderApprovalStatus: "approved",
                }),
            },
            message_trigger_job: {
                findMany: jest.fn().mockResolvedValue([]),
                updateMany: jest.fn().mockResolvedValue({ count: 1 }),
                deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
            },
        };
        const triggerService = {
            ensureDefaultRulesForBranch: jest.fn().mockResolvedValue(undefined),
            syncClientRulesForClient: jest.fn().mockResolvedValue(undefined),
            syncEmployeeAssignmentRulesForSchedule: jest.fn().mockResolvedValue(undefined),
        };
        const serviceRecordLinkService = {
            scheduleForServiceStart: jest.fn().mockResolvedValue(true),
        };
        const transaction = {
            message_trigger_rule: {
                upsert: jest.fn().mockResolvedValue(undefined),
            },
            message_trigger_job: {
                upsert: jest.fn().mockResolvedValue(undefined),
            },
        };
        return {
            prisma,
            triggerService,
            serviceRecordLinkService,
            transaction,
            service: new MessageAutomationIntentService(
                prisma as never,
                triggerService as never,
                serviceRecordLinkService as never,
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

    it("keeps an unapproved branch intent without generating outbound jobs", async () => {
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
                data: { nextAttemptAt: expect.any(Date) },
            }),
        );
        expect(prisma.message_trigger_job.deleteMany).not.toHaveBeenCalled();
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
                payload: {
                    templateVariables: {
                        intentKind: "schedule",
                        includePast: "true",
                        suppressGreeting: "false",
                    },
                },
            },
        ]);
        prisma.$queryRaw
            .mockResolvedValueOnce([{
                id: "client-intent",
                scheduled_for: new Date("2026-08-20T01:02:03.000Z"),
            }])
            .mockResolvedValueOnce([{ id: "schedule-intent" }]);

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
                { preserveExisting: true },
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
});
