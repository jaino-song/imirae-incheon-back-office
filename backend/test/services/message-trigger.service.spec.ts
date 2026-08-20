import { ConflictException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { MessageTriggerService } from "application/services/message-trigger.service";
import {
    MESSAGE_TRIGGER_TEMPLATE_CATALOG,
    MessageTriggerEventType,
    MessageTriggerOffsetType,
    MessageTriggerRecipientType,
    MessageTriggerTemplateKey,
} from "domain/constants/message-trigger-catalog";
import {
    SEND_HOUR_KST,
    TRIGGER_JOB_MAX_ATTEMPTS,
} from "domain/constants/message-automation-policy";
import { MessageTriggerJobEntity } from "domain/entities/message-trigger-job.entity";
import { MessageTriggerRuleEntity } from "domain/entities/message-trigger-rule.entity";
import { TriggerJobDeferredError } from "domain/errors/trigger-job-deferred.error";

jest.mock("infrastructure/database/schema-capabilities", () => ({
    hasColumn: jest.fn().mockResolvedValue(true),
    hasTable: jest.fn().mockResolvedValue(true),
}));

describe("MessageTriggerService", () => {
    const branchId = "branch-1";
    type EmployeeAssignmentScheduleSource = {
        id: number;
        clientId: number;
        startDate: Date;
        primaryEmployeeId: number;
        secondaryEmployeeId: number | null;
        client: { id: number; name: string };
        primaryEmployee: { id: number; name: string; phone: string } | null;
        secondaryEmployee: { id: number; name: string; phone: string } | null;
    };

    type ServiceInternals = {
        hasTriggerSchema: () => Promise<boolean>;
        rebuildJobsForRule: (
            branchId: string | null,
            rule: MessageTriggerRuleEntity,
            includePast: boolean,
        ) => Promise<void>;
        recoverApprovedBranches: () => Promise<void>;
        processStaleRuleRebuilds: () => Promise<void>;
        buildClientTemplateVariables: (
            rule: MessageTriggerRuleEntity,
            client: {
                name: string;
                phone: string | null;
                type?: string | null;
                startDate?: Date | null;
                endDate?: Date | null;
                createdAt?: Date | null;
                duration?: number | null;
                fullPrice?: string | null;
                grant?: string | null;
                actualPrice?: string | null;
                area?: { bankAccountInfo: { bankName: string | null; accNum: string | null } | null } | null;
            },
        ) => Record<string, string>;
        buildEmployeeAssignmentJob: (
            rule: MessageTriggerRuleEntity,
            schedule: EmployeeAssignmentScheduleSource,
        ) => MessageTriggerJobEntity | null;
    };

    const createRule = (overrides: Partial<{
        id: string;
        name: string;
        eventType: MessageTriggerEventType;
        offsetType: MessageTriggerOffsetType;
        offsetDays: number;
        recipientType: MessageTriggerRecipientType;
        templateKey: MessageTriggerTemplateKey;
        isActive: boolean;
        branchId: string | null;
        isDefault: boolean;
        jobsStale: boolean;
        createdAt: Date;
        updatedAt: Date;
    }> = {}) =>
        MessageTriggerRuleEntity.reconstitute(
            overrides.id ?? "rule-1",
            overrides.branchId ?? branchId,
            overrides.name ?? "기존 규칙",
            overrides.isActive ?? true,
            overrides.eventType ?? MessageTriggerEventType.CLIENT_CREATED,
            overrides.offsetType ?? MessageTriggerOffsetType.IMMEDIATE,
            overrides.offsetDays ?? 0,
            overrides.recipientType ?? MessageTriggerRecipientType.CLIENT,
            overrides.templateKey ?? MessageTriggerTemplateKey.CLIENT_WELCOME,
            overrides.createdAt ?? new Date("2026-06-01T00:00:00.000Z"),
            overrides.updatedAt ?? new Date("2026-06-01T00:00:00.000Z"),
            overrides.isDefault ?? false,
            overrides.jobsStale ?? false,
        );

    const createJob = (overrides: Partial<{
        id: string;
        ruleId: string;
        status: "pending" | "processing" | "sent" | "failed" | "canceled";
        scheduledFor: Date;
        clientId: number | null;
        employeeScheduleId: number | null;
        recipientType: MessageTriggerRecipientType;
        recipientPhone: string | null;
        templateKey: MessageTriggerTemplateKey;
        dedupeKey: string;
        payload: MessageTriggerJobEntity["payload"];
        attempts: number;
        nextAttemptAt: Date | null;
        canceledAt: Date | null;
        cancelReason: string | null;
        createdAt: Date;
    }> = {}) =>
        MessageTriggerJobEntity.reconstitute(
            overrides.id ?? "job-1",
            branchId,
            overrides.ruleId ?? "rule-1",
            overrides.status ?? "pending",
            overrides.scheduledFor ?? new Date(),
            null,
            overrides.canceledAt ?? null,
            overrides.cancelReason ?? null,
            overrides.clientId === undefined ? 1 : overrides.clientId,
            overrides.employeeScheduleId ?? null,
            overrides.recipientType ?? MessageTriggerRecipientType.CLIENT,
            overrides.recipientPhone ?? "010-1234-5678",
            overrides.templateKey ?? MessageTriggerTemplateKey.CLIENT_GREETING,
            overrides.dedupeKey ?? `dedupe-${overrides.id ?? "job-1"}`,
            overrides.payload ?? {
                memberId: "member-1",
                recipientName: "김산모",
                recipientPhone: overrides.recipientPhone ?? "010-1234-5678",
                templateVariables: {},
            },
            overrides.createdAt ?? new Date("2026-06-01T00:00:00.000Z"),
            new Date("2026-06-01T00:00:00.000Z"),
            overrides.attempts ?? 0,
            overrides.nextAttemptAt ?? null,
        );

    const createMessageLogRepository = () => ({
        findSentTriggerJobIds: jest.fn<Promise<Set<string>>, [string[]]>().mockResolvedValue(
            new Set<string>(),
        ),
        findRecentByBranch: jest.fn().mockResolvedValue([]),
    });

    const createMessageSenderApprovalService = () => ({
        ensureApproved: jest.fn().mockResolvedValue(undefined),
        isApproved: jest.fn().mockResolvedValue(true),
        getApprovedBranchIds: jest
            .fn<Promise<Set<string>>, [string[]]>()
            .mockImplementation(async (branchIds) => new Set(branchIds)),
        getApprovedBranches: jest
            .fn<Promise<Map<string, Date | null>>, [string[]]>()
            .mockImplementation(async (branchIds) =>
                new Map(branchIds.map((id) => [id, new Date("2026-06-05T00:00:00.000Z")]))
            ),
    });

    const createService = () => {
        const ruleRepository = {
            findAll: jest.fn(),
            findById: jest.fn(),
            findActiveByEventTypes: jest.fn(),
            create: jest.fn(),
            update: jest.fn(),
            updateIfTargetMatches: jest.fn(),
            updateIfTargetMatchesAndFenceJobs: jest.fn(),
            delete: jest.fn(),
            deleteIfTargetMatches: jest.fn(),
            deleteIfTargetMatchesAndFenceJobs: jest.fn(),
            markJobsStale: jest.fn().mockResolvedValue(undefined),
            findInactiveDefaultRules: jest.fn().mockResolvedValue([]),
            findStaleRules: jest.fn().mockResolvedValue([]),
            clearJobsStaleIfUnchanged: jest.fn().mockResolvedValue(true),
        };
        const jobRepository = {
            cancelOrphanedPending: jest.fn().mockResolvedValue(0),
            findRecoverableOrphanedClientJobs: jest.fn().mockResolvedValue([]),
            markOrphanedJobsReconciled: jest.fn().mockResolvedValue(0),
            cancelPendingByRuleId: jest.fn().mockResolvedValue(0),
            cancelPendingOlderThan: jest.fn().mockResolvedValue(0),
            cancelPendingForRuleGeneration: jest.fn().mockImplementation(async (
                _branchId: string,
                ruleId: string,
                _expectedUpdatedAt: Date,
                _expectedJobsStale: boolean,
                reason: string,
            ) => {
                await jobRepository.cancelPendingByRuleId(ruleId, reason);
                return 0;
            }),
            findUpcomingPendingByBranch: jest.fn().mockResolvedValue([]),
            findTerminalByBranch: jest.fn().mockResolvedValue([]),
            hasActiveJobsBefore: jest.fn().mockResolvedValue(false),
            upsertPending: jest.fn().mockResolvedValue(undefined),
            cancelPendingByUser: jest.fn().mockResolvedValue(true),
            upsertPendingForRuleGeneration: jest.fn().mockImplementation(async (job: MessageTriggerJobEntity) => {
                await jobRepository.upsertPending(job);
                return job;
            }),
        };
        const prisma = {
            client: {
                findMany: jest.fn().mockResolvedValue([]),
            },
            message_log: {
                findMany: jest.fn().mockResolvedValue([]),
            },
            message_trigger_job: {
                findMany: jest.fn().mockResolvedValue([]),
            },
        };
        const messageSenderApprovalService = createMessageSenderApprovalService();
        const messageLogRepository = createMessageLogRepository();
        const service = new MessageTriggerService(
            prisma as never,
            {} as never,
            messageSenderApprovalService as never,
            ruleRepository as never,
            jobRepository as never,
            messageLogRepository as never,
        );

        const internals = service as unknown as ServiceInternals;
        jest.spyOn(internals, "hasTriggerSchema").mockResolvedValue(true);
        jest.spyOn(internals, "rebuildJobsForRule").mockResolvedValue(undefined);

        return { service, internals, prisma, ruleRepository, jobRepository, messageSenderApprovalService };
    };

    const createDispatchService = () => {
        const deliveryService = {
            sendJob: jest.fn().mockResolvedValue(true),
        };
        const jobRepository = {
            cancelOrphanedPending: jest.fn().mockResolvedValue(0),
            findDuePending: jest.fn().mockResolvedValue([]),
            findById: jest.fn().mockResolvedValue(null),
            findStaleProcessing: jest.fn().mockResolvedValue([]),
            claimPending: jest.fn().mockResolvedValue(true),
            claimPendingWithRuleFence: jest.fn().mockResolvedValue(true),
            update: jest.fn().mockResolvedValue(undefined),
            cancelPendingByRuleId: jest.fn().mockResolvedValue(0),
            cancelPendingOlderThan: jest.fn().mockResolvedValue(0),
            cancelPendingForRuleGeneration: jest.fn().mockImplementation(async (
                _branchId: string,
                ruleId: string,
                _expectedUpdatedAt: Date,
                _expectedJobsStale: boolean,
                reason: string,
            ) => {
                await jobRepository.cancelPendingByRuleId(ruleId, reason);
                return 0;
            }),
        };
        const ruleRepository = {
            findInactiveDefaultRules: jest.fn().mockResolvedValue([]),
            update: jest.fn(),
            markJobsStale: jest.fn().mockResolvedValue(undefined),
            findStaleRules: jest.fn().mockResolvedValue([]),
            clearJobsStaleIfUnchanged: jest.fn().mockResolvedValue(true),
        };
        const messageSenderApprovalService = createMessageSenderApprovalService();
        const messageLogRepository = createMessageLogRepository();
        const prisma = {
            message_trigger_job: {
                findUnique: jest.fn().mockResolvedValue(null),
            },
        };
        const service = new MessageTriggerService(
            prisma as never,
            deliveryService as never,
            messageSenderApprovalService as never,
            ruleRepository as never,
            jobRepository as never,
            messageLogRepository as never,
        );

        jest.spyOn(service as unknown as ServiceInternals, "hasTriggerSchema").mockResolvedValue(true);

        return {
            service,
            deliveryService,
            ruleRepository,
            jobRepository,
            messageLogRepository,
            messageSenderApprovalService,
            prisma,
        };
    };

    it("cancels orphaned pending jobs before returning the upcoming list", async () => {
        const { service, jobRepository } = createService();

        await service.listUpcomingJobs(branchId);

        expect(jobRepository.cancelOrphanedPending).toHaveBeenCalledWith(
            "Related client or schedule deleted",
            branchId,
        );
        expect(jobRepository.findUpcomingPendingByBranch).toHaveBeenCalledWith(branchId, 200);
    });

    it("includes manual scheduled SMS logs in the upcoming list", async () => {
        const { service, prisma } = createService();
        prisma.message_log.findMany.mockResolvedValue([{
            id: 91,
            branchId,
            provider: "aligo_sms",
            templateKey: "안내",
            receiver: "01012345678",
            clientId: 7,
            recipientName: "김고객",
            recipientPhone: "01012345678",
            messageBody: "예약 안내",
            variables: {
                triggerType: "scheduled",
                scheduledDate: "20260720",
                scheduledTime: "1530",
                title: "예약 안내",
            },
            status: "pending",
            createdAt: new Date("2026-07-16T00:00:00.000Z"),
            updatedAt: new Date("2026-07-16T00:00:00.000Z"),
        }]);

        const result = await service.listUpcomingJobs(branchId);

        expect(result).toHaveLength(1);
        expect(result[0]).toMatchObject({
            id: "log:91",
            ruleName: "예약 안내",
            status: "pending",
            recipientPhone: "01012345678",
        });
        expect(result[0]?.scheduledFor.toISOString()).toBe("2026-07-20T06:30:00.000Z");
    });

    it("exposes canceled and failed jobs in history when no message log exists", async () => {
        const { service, jobRepository, ruleRepository } = createService();
        const canceledJob = createJob({
            id: "job-canceled",
            status: "canceled",
            cancelReason: "메시지 발송 승인 필요",
            canceledAt: new Date("2026-07-16T01:00:00.000Z"),
            templateKey: MessageTriggerTemplateKey.SERVICE_INFO,
        });
        const failedJob = createJob({
            id: "job-failed",
            status: "failed",
            cancelReason: "provider timeout",
            templateKey: MessageTriggerTemplateKey.CLIENT_GREETING,
        });
        jobRepository.findTerminalByBranch.mockResolvedValue([canceledJob, failedJob]);
        ruleRepository.findAll.mockResolvedValue([
            createRule({ id: "rule-1", name: "서비스 안내 자동 발송" }),
        ]);

        const result = await service.listHistory(branchId);

        expect(result.map((record) => record.id)).toEqual([
            "job:job-canceled",
            "job:job-failed",
        ]);
        expect(result).toEqual(expect.arrayContaining([
            expect.objectContaining({
                triggerJobId: "job-canceled",
                status: "canceled",
                errorMessage: "메시지 발송 승인 필요",
            }),
            expect.objectContaining({
                triggerJobId: "job-failed",
                status: "failed",
                errorMessage: "provider timeout",
            }),
        ]));
    });

    it("rebuilds jobs for a newer client with the same phone as a canceled orphan", async () => {
        const { service, prisma, jobRepository } = createService();
        const orphanedJob = createJob({
            id: "orphaned-job",
            status: "canceled",
            clientId: null,
            canceledAt: new Date("2026-07-12T00:00:00.000Z"),
            cancelReason: "Related client or schedule deleted",
            recipientPhone: "010-1234-5678",
            createdAt: new Date("2026-07-01T00:00:00.000Z"),
        });
        jobRepository.findRecoverableOrphanedClientJobs.mockResolvedValue([orphanedJob]);
        prisma.client.findMany.mockResolvedValue([
            {
                id: 42,
                phone: "01012345678",
                createdAt: new Date("2026-07-12T01:00:00.000Z"),
                suppressGreetingSms: false,
            },
        ]);
        jest.spyOn(service, "syncClientRulesForClient").mockResolvedValue(undefined);

        await service.listUpcomingJobs(branchId);

        expect(service.syncClientRulesForClient).toHaveBeenCalledWith(branchId, 42, true, false);
        expect(jobRepository.markOrphanedJobsReconciled).toHaveBeenCalledWith(
            ["orphaned-job"],
            42,
        );
    });

    it("reconciles a replacement client without creating greeting jobs when SMS greeting is suppressed", async () => {
        const { service, prisma, jobRepository } = createService();
        const orphanedJob = createJob({
            id: "orphaned-suppressed-greeting",
            clientId: null,
            recipientPhone: "010-1234-5678",
            createdAt: new Date("2026-07-01T00:00:00.000Z"),
        });
        jobRepository.findRecoverableOrphanedClientJobs.mockResolvedValue([orphanedJob]);
        prisma.client.findMany.mockResolvedValue([{
            id: 42,
            phone: "01012345678",
            createdAt: new Date("2026-07-12T01:00:00.000Z"),
            suppressGreetingSms: true,
        }]);
        jest.spyOn(service, "syncClientRulesForClient").mockResolvedValue(undefined);

        await service.listUpcomingJobs(branchId);

        expect(service.syncClientRulesForClient).toHaveBeenCalledWith(branchId, 42, true, true);
    });

    it("does not reuse an orphan for a client that predates the old job", async () => {
        const { service, prisma, jobRepository } = createService();
        const orphanedJob = createJob({
            id: "orphaned-job",
            status: "canceled",
            clientId: null,
            canceledAt: new Date("2026-07-12T00:00:00.000Z"),
            cancelReason: "Related client or schedule deleted",
            recipientPhone: "010-1234-5678",
            createdAt: new Date("2026-07-10T00:00:00.000Z"),
        });
        jobRepository.findRecoverableOrphanedClientJobs.mockResolvedValue([orphanedJob]);
        prisma.client.findMany.mockResolvedValue([
            {
                id: 7,
                phone: "010-1234-5678",
                createdAt: new Date("2026-07-01T00:00:00.000Z"),
            },
        ]);
        jest.spyOn(service, "syncClientRulesForClient").mockResolvedValue(undefined);

        await service.listUpcomingJobs(branchId);

        expect(service.syncClientRulesForClient).not.toHaveBeenCalled();
        expect(jobRepository.markOrphanedJobsReconciled).not.toHaveBeenCalled();
    });

    it("cancels orphaned pending jobs before dispatching due jobs", async () => {
        const { service, jobRepository } = createDispatchService();

        await service.dispatchDueJobs();

        expect(jobRepository.cancelOrphanedPending).toHaveBeenCalledWith(
            "Related client or schedule deleted",
        );
    });

    it("ensures the default service information trigger on rule listing", async () => {
        const { service, internals, ruleRepository } = createService();
        const existingGreeting = createRule({
            id: "rule-existing-greeting",
            name: "신규 고객 인사 메시지",
            eventType: MessageTriggerEventType.CLIENT_CREATED,
            offsetType: MessageTriggerOffsetType.IMMEDIATE,
            offsetDays: 0,
            templateKey: MessageTriggerTemplateKey.CLIENT_GREETING,
        });
        const createdServiceInfo = createRule({
            id: "rule-service-info",
            name: "서비스 시작 7일 전 서비스 안내",
            eventType: MessageTriggerEventType.SERVICE_START,
            offsetType: MessageTriggerOffsetType.BEFORE_DAYS,
            offsetDays: 7,
            templateKey: MessageTriggerTemplateKey.SERVICE_INFO,
        });
        // CLIENT_GREETING already exists; only SERVICE_INFO will be created
        ruleRepository.findAll.mockResolvedValue([existingGreeting]);
        ruleRepository.create.mockResolvedValue(createdServiceInfo);

        const rules = await service.listRules(branchId);

        expect(ruleRepository.create).toHaveBeenCalledWith(
            branchId,
            expect.objectContaining({
                name: "서비스 시작 7일 전 서비스 안내",
                isActive: true,
                eventType: MessageTriggerEventType.SERVICE_START,
                offsetType: MessageTriggerOffsetType.BEFORE_DAYS,
                offsetDays: 7,
                recipientType: MessageTriggerRecipientType.CLIENT,
                templateKey: MessageTriggerTemplateKey.SERVICE_INFO,
            }),
        );
        expect(internals.rebuildJobsForRule).toHaveBeenCalledWith(branchId, createdServiceInfo, false);
        expect(rules).toContainEqual(createdServiceInfo);
        expect(rules).toContainEqual(existingGreeting);
    });

    it("ensures the default CLIENT_GREETING trigger on rule listing", async () => {
        const { service, ruleRepository } = createService();
        const existingServiceInfo = createRule({
            id: "rule-existing-service-info",
            eventType: MessageTriggerEventType.SERVICE_START,
            offsetType: MessageTriggerOffsetType.BEFORE_DAYS,
            offsetDays: 7,
            templateKey: MessageTriggerTemplateKey.SERVICE_INFO,
        });
        const createdGreeting = createRule({
            id: "rule-greeting",
            name: "신규 고객 인사 메시지",
            eventType: MessageTriggerEventType.CLIENT_CREATED,
            offsetType: MessageTriggerOffsetType.IMMEDIATE,
            offsetDays: 0,
            templateKey: MessageTriggerTemplateKey.CLIENT_GREETING,
        });
        // SERVICE_INFO already exists; only CLIENT_GREETING will be created
        ruleRepository.findAll.mockResolvedValue([existingServiceInfo]);
        ruleRepository.create.mockResolvedValue(createdGreeting);

        const rules = await service.listRules(branchId);

        expect(ruleRepository.create).toHaveBeenCalledWith(
            branchId,
            expect.objectContaining({
                name: "신규 고객 인사 메시지",
                isActive: true,
                eventType: MessageTriggerEventType.CLIENT_CREATED,
                offsetType: MessageTriggerOffsetType.IMMEDIATE,
                offsetDays: 0,
                recipientType: MessageTriggerRecipientType.CLIENT,
                templateKey: MessageTriggerTemplateKey.CLIENT_GREETING,
            }),
        );
        expect(rules).toContainEqual(createdGreeting);
        expect(rules).toContainEqual(existingServiceInfo);
    });

    it("does not duplicate existing default triggers when both already exist", async () => {
        const { service, internals, ruleRepository } = createService();
        const existingServiceInfo = createRule({
            id: "rule-existing-service-info",
            eventType: MessageTriggerEventType.SERVICE_START,
            offsetType: MessageTriggerOffsetType.BEFORE_DAYS,
            offsetDays: 7,
            templateKey: MessageTriggerTemplateKey.SERVICE_INFO,
        });
        const existingGreeting = createRule({
            id: "rule-existing-greeting",
            eventType: MessageTriggerEventType.CLIENT_CREATED,
            offsetType: MessageTriggerOffsetType.IMMEDIATE,
            offsetDays: 0,
            templateKey: MessageTriggerTemplateKey.CLIENT_GREETING,
        });
        ruleRepository.findAll.mockResolvedValue([existingServiceInfo, existingGreeting]);

        const rules = await service.listRules(branchId);

        expect(ruleRepository.create).not.toHaveBeenCalled();
        expect(internals.rebuildJobsForRule).not.toHaveBeenCalled();
        expect(rules).toEqual([existingServiceInfo, existingGreeting]);
    });

    it("does not provision default rules for an unapproved branch", async () => {
        const { service, internals, ruleRepository, messageSenderApprovalService } = createService();
        const existingRule = createRule({
            id: "rule-existing",
            eventType: MessageTriggerEventType.SERVICE_START,
            offsetType: MessageTriggerOffsetType.BEFORE_DAYS,
            offsetDays: 3,
            templateKey: MessageTriggerTemplateKey.SERVICE_INFO,
        });
        ruleRepository.findAll.mockResolvedValue([existingRule]);
        messageSenderApprovalService.isApproved.mockResolvedValue(false);

        const rules = await service.listRules(branchId);

        expect(messageSenderApprovalService.isApproved).toHaveBeenCalledWith(branchId);
        expect(ruleRepository.create).not.toHaveBeenCalled();
        expect(internals.rebuildJobsForRule).not.toHaveBeenCalled();
        expect(rules).toEqual([existingRule]);
    });

    it("createRule returns without rebuilding jobs and marks the rule stale", async () => {
        const { service, internals, ruleRepository, jobRepository } = createService();
        const createdRule = createRule({
            id: "rule-created",
            name: "신규 고객 인사",
            eventType: MessageTriggerEventType.CLIENT_CREATED,
            offsetType: MessageTriggerOffsetType.IMMEDIATE,
            offsetDays: 0,
            templateKey: MessageTriggerTemplateKey.CLIENT_GREETING,
        });
        ruleRepository.create.mockResolvedValue(createdRule);

        const result = await service.createRule(branchId, {
            name: "신규 고객 인사",
            eventType: MessageTriggerEventType.CLIENT_CREATED,
            offsetType: MessageTriggerOffsetType.IMMEDIATE,
            recipientType: MessageTriggerRecipientType.CLIENT,
            templateKey: MessageTriggerTemplateKey.CLIENT_GREETING,
        });

        expect(result).toBe(createdRule);
        expect(ruleRepository.markJobsStale).toHaveBeenCalledWith(createdRule.id, undefined);
        expect(internals.rebuildJobsForRule).not.toHaveBeenCalled();
        expect(jobRepository.cancelPendingByRuleId).not.toHaveBeenCalled();
    });

    it("rejects a fake template without an SMS provider when creating a rule", async () => {
        const { service, ruleRepository } = createService();
        const fakeTemplateKey = "FAKE_SMS_DISABLED" as MessageTriggerTemplateKey;
        const catalog = MESSAGE_TRIGGER_TEMPLATE_CATALOG as Record<string, unknown>;
        catalog[fakeTemplateKey] = {
            key: fakeTemplateKey,
            name: "가짜 템플릿",
            description: "SMS provider 가드 테스트",
            allowedEventTypes: [MessageTriggerEventType.CLIENT_CREATED],
            allowedRecipientTypes: [MessageTriggerRecipientType.CLIENT],
            requiredVariables: [],
            providers: {},
        };

        try {
            await expect(service.createRule(branchId, {
                name: "가짜 규칙",
                eventType: MessageTriggerEventType.CLIENT_CREATED,
                offsetType: MessageTriggerOffsetType.IMMEDIATE,
                recipientType: MessageTriggerRecipientType.CLIENT,
                templateKey: fakeTemplateKey,
            })).rejects.toThrow("SMS 발송 채널이 없는 템플릿입니다.");
            expect(ruleRepository.create).not.toHaveBeenCalled();
        } finally {
            delete catalog[fakeTemplateKey];
        }
    });

    it("updateRule batch-cancels pending jobs and marks stale without rebuilding in-request", async () => {
        const { service, internals, ruleRepository, jobRepository } = createService();
        const existingRule = createRule({
            id: "rule-updated",
            name: "기존 규칙",
            eventType: MessageTriggerEventType.CLIENT_CREATED,
            offsetType: MessageTriggerOffsetType.IMMEDIATE,
            offsetDays: 0,
            templateKey: MessageTriggerTemplateKey.CLIENT_GREETING,
        });
        const updatedRule = createRule({
            id: existingRule.id,
            name: "수정된 규칙",
            eventType: MessageTriggerEventType.CLIENT_CREATED,
            offsetType: MessageTriggerOffsetType.IMMEDIATE,
            offsetDays: 0,
            templateKey: MessageTriggerTemplateKey.CLIENT_GREETING,
        });
        ruleRepository.findById.mockResolvedValue(existingRule);
        ruleRepository.update.mockResolvedValue(updatedRule);

        const result = await service.updateRule(branchId, existingRule.id, {
            name: "수정된 규칙",
        });

        expect(result).toBe(updatedRule);
        expect(jobRepository.cancelPendingByRuleId).toHaveBeenCalledWith(
            existingRule.id,
            "Rule updated",
        );
        expect(ruleRepository.markJobsStale).toHaveBeenCalledWith(existingRule.id);
        expect(internals.rebuildJobsForRule).not.toHaveBeenCalled();
    });

    it("uses branch-scoped CAS hooks for approved automation updates and deletes", async () => {
        const { service, ruleRepository, jobRepository } = createService();
        const existingRule = createRule({ id: "rule-approved-target" });
        const updatedRule = createRule({ id: existingRule.id, name: "승인된 변경" });
        const snapshot = {
            id: existingRule.id,
            branchId,
            name: existingRule.name,
            isActive: existingRule.isActive,
            eventType: existingRule.eventType,
            offsetType: existingRule.offsetType,
            offsetDays: existingRule.offsetDays,
            recipientType: existingRule.recipientType,
            templateKey: existingRule.templateKey,
            isDefault: existingRule.isDefault,
            jobsStale: existingRule.jobsStale,
            createdAt: existingRule.createdAt.toISOString(),
            updatedAt: existingRule.updatedAt.toISOString(),
        };
        const targetVersion = (service as unknown as { ruleTargetVersion(rule: MessageTriggerRuleEntity): string }).ruleTargetVersion(existingRule);
        ruleRepository.updateIfTargetMatchesAndFenceJobs.mockResolvedValue(updatedRule);
        ruleRepository.deleteIfTargetMatchesAndFenceJobs.mockResolvedValue(true);

        await expect(service.updateRuleApprovedTarget(branchId, existingRule.id, { name: "승인된 변경" }, targetVersion, snapshot))
            .resolves.toBe(updatedRule);
        expect(ruleRepository.updateIfTargetMatchesAndFenceJobs).toHaveBeenCalledWith(
            branchId,
            expect.objectContaining({ id: existingRule.id }),
            expect.objectContaining({ name: "승인된 변경" }),
            "Rule updated",
            expect.any(Date),
        );
        expect(jobRepository.cancelPendingByRuleId).not.toHaveBeenCalledWith(existingRule.id, "Rule updated");

        await expect(service.deleteRuleApprovedTarget(branchId, existingRule.id, targetVersion, snapshot)).resolves.toBeUndefined();
        expect(ruleRepository.deleteIfTargetMatchesAndFenceJobs).toHaveBeenCalledWith(
            branchId,
            expect.objectContaining({ id: existingRule.id }),
            "Rule deleted",
            expect.any(Date),
        );
        expect(jobRepository.cancelPendingByRuleId).not.toHaveBeenCalledWith(existingRule.id, "Rule deleted");
    });

    it("does not call the provider when an approved rule update linearizes before a dispatcher claim", async () => {
        const mutation = createService();
        const dispatcher = createDispatchService();
        const existingRule = createRule({ id: "rule-interleaving" });
        const updatedRule = createRule({ id: existingRule.id, name: "원자 변경", jobsStale: true });
        const snapshot = {
            id: existingRule.id,
            branchId,
            name: existingRule.name,
            isActive: existingRule.isActive,
            eventType: existingRule.eventType,
            offsetType: existingRule.offsetType,
            offsetDays: existingRule.offsetDays,
            recipientType: existingRule.recipientType,
            templateKey: existingRule.templateKey,
            isDefault: existingRule.isDefault,
            jobsStale: existingRule.jobsStale,
            createdAt: existingRule.createdAt.toISOString(),
            updatedAt: existingRule.updatedAt.toISOString(),
        };
        const targetVersion = (mutation.service as unknown as { ruleTargetVersion(rule: MessageTriggerRuleEntity): string }).ruleTargetVersion(existingRule);
        const job = createJob({ id: "job-interleaving", ruleId: existingRule.id });
        dispatcher.jobRepository.findById.mockResolvedValue(job);
        let mutationWon = false;
        const mutationEntered = new Promise<void>((resolve) => {
            mutation.ruleRepository.updateIfTargetMatchesAndFenceJobs.mockImplementation(async () => {
                mutationWon = true;
                resolve();
                return updatedRule;
            });
        });
        dispatcher.jobRepository.claimPendingWithRuleFence.mockImplementation(async () => !mutationWon);

        const updatePromise = mutation.service.updateRuleApprovedTarget(
            branchId,
            existingRule.id,
            { name: "원자 변경" },
            targetVersion,
            snapshot,
        );
        await mutationEntered;
        await dispatcher.service.dispatchPendingJobNow(job.id);
        await expect(updatePromise).resolves.toBe(updatedRule);

        expect(dispatcher.jobRepository.claimPendingWithRuleFence).toHaveBeenCalledWith(job.id, job.branchId);
        expect(dispatcher.deliveryService.sendJob).not.toHaveBeenCalled();
    });

    it("reactivates cleanup-deactivated default rules once their branch is approved and marks them stale", async () => {
        const { internals, ruleRepository, messageSenderApprovalService } = createService();
        const approvedAt = new Date("2026-06-05T00:00:00.000Z");
        const inactiveDefault = createRule({
            id: "rule-default-approved",
            isActive: false,
            isDefault: true,
            branchId,
            updatedAt: new Date("2026-06-04T00:00:00.000Z"),
        });
        ruleRepository.findInactiveDefaultRules.mockResolvedValue([inactiveDefault]);
        messageSenderApprovalService.getApprovedBranches.mockResolvedValue(new Map([[branchId, approvedAt]]));
        ruleRepository.update.mockResolvedValue(inactiveDefault);

        await internals.recoverApprovedBranches();

        expect(ruleRepository.findInactiveDefaultRules).toHaveBeenCalledWith(50);
        expect(messageSenderApprovalService.getApprovedBranches).toHaveBeenCalledWith([branchId]);
        expect(inactiveDefault.isActive).toBe(true);
        expect(ruleRepository.update).toHaveBeenCalledWith(branchId, inactiveDefault);
        expect(ruleRepository.markJobsStale).toHaveBeenCalledWith(inactiveDefault.id);
    });

    it("does not reactivate a default rule disabled after branch approval", async () => {
        const { internals, ruleRepository, messageSenderApprovalService } = createService();
        const approvedAt = new Date("2026-06-05T00:00:00.000Z");
        const adminDisabledDefault = createRule({
            id: "rule-default-admin-disabled",
            isActive: false,
            isDefault: true,
            branchId,
            updatedAt: new Date("2026-06-06T00:00:00.000Z"),
        });
        ruleRepository.findInactiveDefaultRules.mockResolvedValue([adminDisabledDefault]);
        messageSenderApprovalService.getApprovedBranches.mockResolvedValue(new Map([[branchId, approvedAt]]));

        await internals.recoverApprovedBranches();

        expect(messageSenderApprovalService.getApprovedBranches).toHaveBeenCalledWith([branchId]);
        expect(ruleRepository.update).not.toHaveBeenCalled();
        expect(ruleRepository.markJobsStale).not.toHaveBeenCalled();
        expect(adminDisabledDefault.isActive).toBe(false);
    });

    it("leaves inactive default rules of unapproved branches untouched", async () => {
        const { internals, ruleRepository, messageSenderApprovalService } = createService();
        const inactiveDefault = createRule({
            id: "rule-default-unapproved",
            isActive: false,
            isDefault: true,
            branchId,
        });
        ruleRepository.findInactiveDefaultRules.mockResolvedValue([inactiveDefault]);
        messageSenderApprovalService.getApprovedBranches.mockResolvedValue(new Map());

        await internals.recoverApprovedBranches();

        expect(messageSenderApprovalService.getApprovedBranches).toHaveBeenCalledWith([branchId]);
        expect(ruleRepository.update).not.toHaveBeenCalled();
        expect(ruleRepository.markJobsStale).not.toHaveBeenCalled();
        expect(inactiveDefault.isActive).toBe(false);
    });

    it("does not enqueue jobs for existing clients when an IMMEDIATE CLIENT_GREETING rule is created", async () => {
        // Do NOT spy on rebuildJobsForRule — let the real guard run.
        const jobRepository = {
            upsertPending: jest.fn(),
            upsertPendingForRuleGeneration: jest.fn(),
        };
        const messageSenderApprovalService = createMessageSenderApprovalService();
        const messageLogRepository = createMessageLogRepository();
        const service = new MessageTriggerService(
            {} as never,  // prisma — should not be reached past the IMMEDIATE guard
            {} as never,
            messageSenderApprovalService as never,
            {} as never,
            jobRepository as never,
            messageLogRepository as never,
        );

        const greetingRule = createRule({
            id: "rule-greeting-new",
            eventType: MessageTriggerEventType.CLIENT_CREATED,
            offsetType: MessageTriggerOffsetType.IMMEDIATE,
            offsetDays: 0,
            templateKey: MessageTriggerTemplateKey.CLIENT_GREETING,
        });

        // Call the private method directly — IMMEDIATE guard must return before touching DB
        await (service as unknown as ServiceInternals).rebuildJobsForRule(branchId, greetingRule, false);

        expect(jobRepository.upsertPending).not.toHaveBeenCalled();
    });

    it("cancelJobByUser cancels a pending job scoped to the caller's branch and returns the canceled status", async () => {
        const { service, jobRepository } = createService();

        await expect(service.cancelJobByUser(branchId, "job-1")).resolves.toEqual({
            id: "job-1",
            status: "canceled",
        });
        expect(jobRepository.cancelPendingByUser).toHaveBeenCalledWith(
            "job-1",
            branchId,
            "사용자가 발송을 취소함",
        );
    });

    it("cancelJobByUser rejects with a conflict when the repository finds no cancelable pending job (already sent, processing, already canceled, or missing)", async () => {
        const { service, jobRepository } = createService();
        jobRepository.cancelPendingByUser.mockResolvedValue(false);

        const failure: ConflictException = await service
            .cancelJobByUser(branchId, "job-1")
            .catch((error) => error);

        expect(failure).toBeInstanceOf(ConflictException);
        expect(failure.message).toBe("이미 발송되었거나 취소할 수 없는 상태입니다");
        expect(failure.getStatus()).toBe(409);
    });

    it("cancelJobByUser scopes the cancel to the caller's branch, so a job from another branch is refused", async () => {
        const { service, jobRepository } = createService();
        jobRepository.cancelPendingByUser.mockResolvedValueOnce(false);

        await expect(service.cancelJobByUser("other-branch", "job-1")).rejects.toBeInstanceOf(ConflictException);
        expect(jobRepository.cancelPendingByUser).toHaveBeenCalledWith(
            "job-1",
            "other-branch",
            "사용자가 발송을 취소함",
        );
    });

    it("skips a job whose claim was lost to another instance", async () => {
        const { service, deliveryService, jobRepository } = createDispatchService();
        const job = createJob();
        jobRepository.findDuePending.mockResolvedValue([job]);
        jobRepository.claimPendingWithRuleFence.mockResolvedValue(false);

        await service.dispatchDueJobs();

        expect(jobRepository.claimPendingWithRuleFence).toHaveBeenCalledWith(job.id, job.branchId);
        expect(deliveryService.sendJob).not.toHaveBeenCalled();
        expect(jobRepository.update).not.toHaveBeenCalled();
    });

    it("marks a job sent without calling the provider when a sent message_log exists", async () => {
        const { service, deliveryService, jobRepository, messageLogRepository } =
            createDispatchService();
        const job = createJob();
        jobRepository.findDuePending.mockResolvedValue([job]);
        messageLogRepository.findSentTriggerJobIds.mockResolvedValue(new Set([job.id]));

        await service.dispatchDueJobs();

        expect(deliveryService.sendJob).not.toHaveBeenCalled();
        expect(job.status).toBe("sent");
        expect(jobRepository.update).toHaveBeenCalledWith(job);
    });

    it("dispatch cancels a claimed job whose branch is unapproved without calling the provider", async () => {
        const { service, deliveryService, jobRepository, messageSenderApprovalService } =
            createDispatchService();
        const job = createJob();
        jobRepository.findDuePending.mockResolvedValue([job]);
        messageSenderApprovalService.getApprovedBranchIds.mockResolvedValue(new Set());

        await service.dispatchDueJobs();

        expect(messageSenderApprovalService.getApprovedBranchIds).toHaveBeenCalledWith([branchId]);
        expect(jobRepository.claimPendingWithRuleFence).toHaveBeenCalledWith(job.id, job.branchId);
        expect(deliveryService.sendJob).not.toHaveBeenCalled();
        expect(job.status).toBe("canceled");
        expect(job.cancelReason).toBe("메시지 발송 승인 필요");
        expect(jobRepository.update).toHaveBeenCalledWith(job);
    });

    it("dispatch sends normally for approved branches", async () => {
        const { service, deliveryService, jobRepository, messageSenderApprovalService } =
            createDispatchService();
        const job = createJob();
        jobRepository.findDuePending.mockResolvedValue([job]);
        messageSenderApprovalService.getApprovedBranchIds.mockResolvedValue(new Set([branchId]));

        await service.dispatchDueJobs();

        expect(messageSenderApprovalService.getApprovedBranchIds).toHaveBeenCalledWith([branchId]);
        expect(deliveryService.sendJob).toHaveBeenCalledWith(job);
        expect(job.status).toBe("sent");
        expect(jobRepository.update).toHaveBeenCalledWith(job);
    });

    it("dispatchPendingJobNow claims and sends only the requested job", async () => {
        const { service, deliveryService, jobRepository, messageSenderApprovalService } =
            createDispatchService();
        const job = createJob({ id: "manual-job" });
        jobRepository.findById.mockResolvedValue(job);
        messageSenderApprovalService.getApprovedBranchIds.mockResolvedValue(new Set([branchId]));

        const result = await service.dispatchPendingJobNow(job.id);

        expect(jobRepository.findDuePending).not.toHaveBeenCalled();
        expect(jobRepository.claimPendingWithRuleFence).toHaveBeenCalledWith(job.id, job.branchId);
        expect(deliveryService.sendJob).toHaveBeenCalledWith(job);
        expect(job.status).toBe("sent");
        expect(result.status).toBe("sent");
    });

    it("cancels an existing pending job once its scheduled time is at least 24 hours old", async () => {
        jest.useFakeTimers().setSystemTime(new Date("2026-07-09T12:00:00.000Z"));
        try {
            const { service, deliveryService, jobRepository } = createDispatchService();
            const job = createJob({
                scheduledFor: new Date("2026-07-08T12:00:00.000Z"),
            });
            jobRepository.findDuePending.mockResolvedValue([job]);

            await service.dispatchDueJobs();

            expect(jobRepository.claimPendingWithRuleFence).toHaveBeenCalledWith(job.id, job.branchId);
            expect(deliveryService.sendJob).not.toHaveBeenCalled();
            expect(job.status).toBe("canceled");
            expect(job.cancelReason).toBe("기존 발송 예정 24시간 경과");
            expect(jobRepository.update).toHaveBeenCalledWith(job);
        } finally {
            jest.useRealTimers();
        }
    });

    it("keeps a catch-up job behind its predecessor by the configured interval after downtime", async () => {
        jest.useFakeTimers().setSystemTime(new Date("2026-07-09T12:10:00.000Z"));
        try {
            const { service, deliveryService, jobRepository, prisma } = createDispatchService();
            const job = createJob({
                scheduledFor: new Date("2026-07-09T12:03:00.000Z"),
                payload: {
                    memberId: "1",
                    recipientName: "김산모",
                    recipientPhone: "010-1234-5678",
                    templateVariables: {},
                    catchUp: {
                        batchId: "client:1:2026-07-09T12:00:00.000Z",
                        sequence: 2,
                        intervalMinutes: 3,
                        originalScheduledFor: "2026-07-07T00:00:00.000Z",
                        predecessorDedupeKey: "dedupe-predecessor",
                    },
                },
            });
            jobRepository.findDuePending.mockResolvedValue([job]);
            prisma.message_trigger_job.findUnique.mockResolvedValue({
                status: "sent",
                sentAt: new Date("2026-07-09T12:10:00.000Z"),
                canceledAt: null,
                nextAttemptAt: null,
                updatedAt: new Date("2026-07-09T12:10:00.000Z"),
            });

            await service.dispatchDueJobs();

            expect(prisma.message_trigger_job.findUnique).toHaveBeenCalledWith({
                where: { dedupeKey: "dedupe-predecessor" },
                select: {
                    status: true,
                    scheduledFor: true,
                    sentAt: true,
                    canceledAt: true,
                    nextAttemptAt: true,
                    updatedAt: true,
                },
            });
            expect(deliveryService.sendJob).not.toHaveBeenCalled();
            expect(job.status).toBe("pending");
            expect(job.scheduledFor).toEqual(new Date("2026-07-09T12:13:00.000Z"));
            expect(jobRepository.update).toHaveBeenCalledWith(job);
        } finally {
            jest.useRealTimers();
        }
    });

    it("defers with kind config without incrementing attempts", async () => {
        const { service, deliveryService, jobRepository } = createDispatchService();
        const job = createJob({ attempts: 2 });
        jobRepository.findDuePending.mockResolvedValue([job]);
        deliveryService.sendJob.mockRejectedValue(
            new TriggerJobDeferredError("config", "Missing sender approval"),
        );

        await service.dispatchDueJobs();

        expect(job.status).toBe("pending");
        expect(job.attempts).toBe(2);
        expect(job.nextAttemptAt).toBeInstanceOf(Date);
    });

    it("terminal-fails after TRIGGER_JOB_MAX_ATTEMPTS transient defers", async () => {
        const { service, deliveryService, jobRepository } = createDispatchService();
        const job = createJob({ attempts: TRIGGER_JOB_MAX_ATTEMPTS - 1 });
        jobRepository.findDuePending.mockResolvedValue([job]);
        deliveryService.sendJob.mockRejectedValue(
            new TriggerJobDeferredError("transient", "Provider timeout"),
        );

        await service.dispatchDueJobs();

        expect(job.status).toBe("failed");
        expect(job.attempts).toBe(TRIGGER_JOB_MAX_ATTEMPTS);
        expect(job.cancelReason).toBe("Provider timeout");
    });

    it("marks a raw transient Prisma delivery error failed instead of deferring", async () => {
        const { service, deliveryService, jobRepository } = createDispatchService();
        const job = createJob({ attempts: 0 });
        const prismaError = new Prisma.PrismaClientKnownRequestError("Can't reach database server", {
            code: "P1001",
            clientVersion: "test",
        });
        jobRepository.findDuePending.mockResolvedValue([job]);
        deliveryService.sendJob.mockRejectedValue(prismaError);

        await service.dispatchDueJobs();

        expect(job.status).toBe("failed");
        expect(job.attempts).toBe(0);
        expect(job.nextAttemptAt).toBeNull();
        expect(job.cancelReason).toContain("Can't reach database server");
        expect(jobRepository.update).toHaveBeenCalledWith(job);
    });

    it("reclaim marks stale processing job sent when a sent log exists; re-queues pending otherwise", async () => {
        const { service, jobRepository, messageLogRepository } = createDispatchService();
        const deliveredJob = createJob({ id: "job-delivered", status: "processing" });
        const unsentJob = createJob({ id: "job-unsent", status: "processing" });
        jobRepository.findStaleProcessing.mockResolvedValue([deliveredJob, unsentJob]);
        messageLogRepository.findSentTriggerJobIds.mockResolvedValue(new Set([deliveredJob.id]));

        await service.dispatchDueJobs();

        expect(deliveredJob.status).toBe("sent");
        expect(unsentJob.status).toBe("pending");
        expect(unsentJob.attempts).toBe(1);
        expect(unsentJob.nextAttemptAt).toBeInstanceOf(Date);
        expect(jobRepository.update).toHaveBeenCalledTimes(2);
    });

    it("an externally approved branch recovers via the scheduler tick without any page load", async () => {
        const { service, ruleRepository, jobRepository, messageSenderApprovalService } =
            createDispatchService();
        const inactiveDefault = createRule({
            id: "rule-default-approved-by-admin",
            isActive: false,
            isDefault: true,
            jobsStale: true,
            eventType: MessageTriggerEventType.SERVICE_START,
            offsetType: MessageTriggerOffsetType.BEFORE_DAYS,
            offsetDays: 7,
            templateKey: MessageTriggerTemplateKey.SERVICE_INFO,
            updatedAt: new Date("2026-07-08T00:00:00.000Z"),
        });
        const order: string[] = [];
        jobRepository.findStaleProcessing.mockImplementation(async () => {
            order.push("reclaim");
            return [];
        });
        jobRepository.findDuePending.mockImplementation(async () => {
            order.push("due");
            return [];
        });
        ruleRepository.findInactiveDefaultRules.mockImplementation(async () => {
            order.push("recover");
            return [inactiveDefault];
        });
        ruleRepository.findStaleRules.mockImplementation(async () => {
            order.push("stale");
            return [inactiveDefault];
        });
        messageSenderApprovalService.getApprovedBranches.mockResolvedValue(
            new Map([[branchId, new Date("2026-07-09T00:00:00.000Z")]]),
        );
        ruleRepository.update.mockResolvedValue(inactiveDefault);
        const internals = service as unknown as ServiceInternals;
        const rebuildSpy = jest.spyOn(internals, "rebuildJobsForRule").mockResolvedValue(undefined);

        await service.dispatchDueJobs();

        expect(order).toEqual(["reclaim", "due", "recover", "stale"]);
        expect(ruleRepository.update).toHaveBeenCalledWith(branchId, inactiveDefault);
        expect(ruleRepository.markJobsStale).toHaveBeenCalledWith(inactiveDefault.id);
        expect(rebuildSpy).toHaveBeenCalledWith(inactiveDefault.branchId, inactiveDefault, false);
    });

    it("a failing per-job status write does not abort the rest of the batch", async () => {
        const { service, deliveryService, jobRepository } = createDispatchService();
        const firstJob = createJob({ id: "job-first" });
        const secondJob = createJob({ id: "job-second" });
        const logger = (service as unknown as {
            logger: { error: (message: string, stack?: string) => void };
        }).logger;
        jest.spyOn(logger, "error").mockImplementation(() => undefined);
        jobRepository.findDuePending.mockResolvedValue([firstJob, secondJob]);
        jobRepository.update.mockRejectedValueOnce(new Error("write failed"));

        await service.dispatchDueJobs();

        expect(deliveryService.sendJob).toHaveBeenCalledTimes(2);
        expect(firstJob.status).toBe("sent");
        expect(secondJob.status).toBe("sent");
        expect(jobRepository.update).toHaveBeenCalledTimes(2);
    });

    it("processStaleRuleRebuilds rebuilds an active stale rule and clears the flag when unchanged", async () => {
        const { service, ruleRepository, jobRepository } = createDispatchService();
        const staleRule = createRule({
            id: "rule-stale-active",
            jobsStale: true,
            eventType: MessageTriggerEventType.SERVICE_START,
            offsetType: MessageTriggerOffsetType.BEFORE_DAYS,
            offsetDays: 7,
            templateKey: MessageTriggerTemplateKey.SERVICE_INFO,
            updatedAt: new Date("2026-06-02T00:00:00.000Z"),
        });
        ruleRepository.findStaleRules.mockResolvedValue([staleRule]);
        const internals = service as unknown as ServiceInternals;
        const rebuildSpy = jest.spyOn(internals, "rebuildJobsForRule").mockResolvedValue(undefined);

        await internals.processStaleRuleRebuilds();

        expect(ruleRepository.findStaleRules).toHaveBeenCalledWith(10);
        expect(jobRepository.cancelPendingByRuleId).toHaveBeenCalledWith(staleRule.id, "규칙 재생성");
        expect(rebuildSpy).toHaveBeenCalledWith(staleRule.branchId, staleRule, false);
        expect(ruleRepository.clearJobsStaleIfUnchanged).toHaveBeenCalledWith(
            staleRule.id,
            staleRule.updatedAt,
        );
        expect(jobRepository.cancelPendingOlderThan).not.toHaveBeenCalled();
    });

    it("reconciles a rebuilt same-dedupe pending job using the rule update fence", async () => {
        const { service, ruleRepository, jobRepository } = createService();
        const ruleUpdatedAt = new Date("2026-07-09T00:00:00.000Z");
        const rebuiltRule = createRule({
            id: "rule-rebuilt-dedupe",
            jobsStale: false,
            updatedAt: ruleUpdatedAt,
        });
        ruleRepository.findById.mockResolvedValue(rebuiltRule);
        jobRepository.hasActiveJobsBefore.mockResolvedValue(false);

        await expect(service.isRuleMutationComplete(
            branchId,
            rebuiltRule.id,
            { name: rebuiltRule.name },
        )).resolves.toBe(true);

        expect(jobRepository.hasActiveJobsBefore).toHaveBeenCalledWith(
            branchId,
            rebuiltRule.id,
            ruleUpdatedAt,
        );
    });

    it("stale rebuild batch-cancels pending jobs before rebuilding and does not recreate jobs older than the grace window", async () => {
        const now = new Date("2026-07-09T12:00:00.000Z");
        jest.useFakeTimers().setSystemTime(now);
        try {
            const ruleRepository = {
                findStaleRules: jest.fn(),
                clearJobsStaleIfUnchanged: jest.fn().mockResolvedValue(true),
            };
            const jobRepository = {
                cancelPendingByRuleId: jest.fn().mockResolvedValue(2),
                cancelPendingOlderThan: jest.fn().mockResolvedValue(0),
                cancelPendingForRuleGeneration: jest.fn().mockImplementation(async (
                    _branchId: string,
                    ruleId: string,
                    _expectedUpdatedAt: Date,
                    _expectedJobsStale: boolean,
                    reason: string,
                ) => {
                    await jobRepository.cancelPendingByRuleId(ruleId, reason);
                    return 2;
                }),
                upsertPending: jest.fn().mockResolvedValue(undefined),
                upsertPendingForRuleGeneration: jest.fn().mockImplementation(async (job: MessageTriggerJobEntity) => {
                    await jobRepository.upsertPending(job);
                    return job;
                }),
            };
            const messageSenderApprovalService = createMessageSenderApprovalService();
            const prisma = {
                client: {
                    findMany: jest.fn().mockResolvedValue([
                        {
                            id: 1,
                            name: "김산모",
                            phone: "010-1234-5678",
                            type: null,
                            startDate: new Date("2026-07-07T00:00:00.000Z"),
                            endDate: null,
                            duration: null,
                            fullPrice: null,
                            grant: null,
                            actualPrice: null,
                            createdAt: new Date("2026-07-01T00:00:00.000Z"),
                            area: null,
                        },
                    ]),
                },
            };
            const service = new MessageTriggerService(
                prisma as never,
                {} as never,
                messageSenderApprovalService as never,
                ruleRepository as never,
                jobRepository as never,
                createMessageLogRepository() as never,
            );
            const staleRule = createRule({
                id: "rule-stale-past-cleanup",
                jobsStale: true,
                eventType: MessageTriggerEventType.SERVICE_START,
                offsetType: MessageTriggerOffsetType.SAME_DAY,
                offsetDays: 0,
                templateKey: MessageTriggerTemplateKey.SERVICE_INFO,
                updatedAt: new Date("2026-07-08T00:00:00.000Z"),
            });
            ruleRepository.findStaleRules.mockResolvedValue([staleRule]);
            const internals = service as unknown as ServiceInternals;

            await internals.processStaleRuleRebuilds();

            expect(jobRepository.cancelPendingByRuleId).toHaveBeenCalledWith(staleRule.id, "규칙 재생성");
            expect(prisma.client.findMany).toHaveBeenCalledTimes(1);
            expect(jobRepository.upsertPending).not.toHaveBeenCalled();
            expect(jobRepository.cancelPendingOlderThan).not.toHaveBeenCalled();
            expect(ruleRepository.clearJobsStaleIfUnchanged).toHaveBeenCalledWith(
                staleRule.id,
                staleRule.updatedAt,
            );
        } finally {
            jest.useRealTimers();
        }
    });

    it("processStaleRuleRebuilds leaves the flag set when the rule changed mid-rebuild and the next pass converges", async () => {
        const { service, ruleRepository } = createDispatchService();
        const staleRule = createRule({
            id: "rule-stale-changed",
            jobsStale: true,
            eventType: MessageTriggerEventType.SERVICE_START,
            offsetType: MessageTriggerOffsetType.BEFORE_DAYS,
            offsetDays: 7,
            templateKey: MessageTriggerTemplateKey.SERVICE_INFO,
            updatedAt: new Date("2026-06-03T00:00:00.000Z"),
        });
        const editedRule = createRule({
            id: "rule-stale-changed",
            jobsStale: true,
            eventType: MessageTriggerEventType.SERVICE_START,
            offsetType: MessageTriggerOffsetType.AFTER_DAYS,
            offsetDays: 1,
            templateKey: MessageTriggerTemplateKey.SERVICE_INFO,
            updatedAt: new Date("2026-06-03T00:01:00.000Z"),
        });
        ruleRepository.findStaleRules
            .mockResolvedValueOnce([staleRule])
            .mockResolvedValueOnce([editedRule]);
        ruleRepository.clearJobsStaleIfUnchanged
            .mockResolvedValueOnce(false)
            .mockResolvedValueOnce(true);
        const internals = service as unknown as ServiceInternals;
        jest.spyOn(internals, "rebuildJobsForRule").mockResolvedValue(undefined);

        await internals.processStaleRuleRebuilds();
        await internals.processStaleRuleRebuilds();

        expect(ruleRepository.clearJobsStaleIfUnchanged).toHaveBeenCalledWith(
            staleRule.id,
            staleRule.updatedAt,
        );
        expect(ruleRepository.clearJobsStaleIfUnchanged).toHaveBeenCalledWith(
            editedRule.id,
            editedRule.updatedAt,
        );
        expect(internals.rebuildJobsForRule).toHaveBeenNthCalledWith(
            2,
            editedRule.branchId,
            editedRule,
            false,
        );
    });

    it("processStaleRuleRebuilds re-cancels pending jobs for a deactivated stale rule", async () => {
        const { service, ruleRepository, jobRepository } = createDispatchService();
        const inactiveRule = createRule({
            id: "rule-stale-inactive",
            isActive: false,
            jobsStale: true,
            updatedAt: new Date("2026-06-04T00:00:00.000Z"),
        });
        ruleRepository.findStaleRules.mockResolvedValue([inactiveRule]);
        const internals = service as unknown as ServiceInternals;
        const rebuildSpy = jest.spyOn(internals, "rebuildJobsForRule").mockResolvedValue(undefined);

        await internals.processStaleRuleRebuilds();

        expect(jobRepository.cancelPendingByRuleId).toHaveBeenCalledWith(
            inactiveRule.id,
            "Rule deactivated",
        );
        expect(rebuildSpy).not.toHaveBeenCalled();
        expect(ruleRepository.clearJobsStaleIfUnchanged).toHaveBeenCalledWith(
            inactiveRule.id,
            inactiveRule.updatedAt,
        );
    });

    it("does not rebuild or clear when a second stale worker loses the generation fence", async () => {
        const { service, ruleRepository, jobRepository } = createDispatchService();
        const staleRule = createRule({
            id: "rule-stale-worker-b",
            jobsStale: true,
            eventType: MessageTriggerEventType.SERVICE_START,
            offsetType: MessageTriggerOffsetType.BEFORE_DAYS,
            offsetDays: 7,
            templateKey: MessageTriggerTemplateKey.SERVICE_INFO,
            updatedAt: new Date("2026-06-07T00:00:00.000Z"),
        });
        ruleRepository.findStaleRules.mockResolvedValue([staleRule]);
        jobRepository.cancelPendingForRuleGeneration.mockResolvedValue(null);
        const internals = service as unknown as ServiceInternals;
        const rebuildSpy = jest.spyOn(internals, "rebuildJobsForRule").mockResolvedValue(undefined);

        await internals.processStaleRuleRebuilds();

        expect(jobRepository.cancelPendingForRuleGeneration).toHaveBeenCalledWith(
            staleRule.branchId,
            staleRule.id,
            staleRule.updatedAt,
            true,
            "규칙 재생성",
        );
        expect(rebuildSpy).not.toHaveBeenCalled();
        expect(ruleRepository.clearJobsStaleIfUnchanged).not.toHaveBeenCalled();
    });

    it("a throwing rebuild for one stale rule does not block the others", async () => {
        const { service, ruleRepository } = createDispatchService();
        const firstRule = createRule({
            id: "rule-stale-first",
            jobsStale: true,
            eventType: MessageTriggerEventType.SERVICE_START,
            offsetType: MessageTriggerOffsetType.BEFORE_DAYS,
            offsetDays: 7,
            templateKey: MessageTriggerTemplateKey.SERVICE_INFO,
            updatedAt: new Date("2026-06-05T00:00:00.000Z"),
        });
        const secondRule = createRule({
            id: "rule-stale-second",
            jobsStale: true,
            eventType: MessageTriggerEventType.SERVICE_START,
            offsetType: MessageTriggerOffsetType.BEFORE_DAYS,
            offsetDays: 7,
            templateKey: MessageTriggerTemplateKey.SERVICE_INFO,
            updatedAt: new Date("2026-06-06T00:00:00.000Z"),
        });
        ruleRepository.findStaleRules.mockResolvedValue([firstRule, secondRule]);
        const internals = service as unknown as ServiceInternals;
        jest.spyOn(internals, "rebuildJobsForRule")
            .mockRejectedValueOnce(new Error("rebuild failed"))
            .mockResolvedValueOnce(undefined);
        const logger = (service as unknown as {
            logger: { error: (message: string, stack?: string) => void };
        }).logger;
        jest.spyOn(logger, "error").mockImplementation(() => undefined);

        await internals.processStaleRuleRebuilds();

        expect(internals.rebuildJobsForRule).toHaveBeenCalledTimes(2);
        expect(ruleRepository.clearJobsStaleIfUnchanged).not.toHaveBeenCalledWith(
            firstRule.id,
            firstRule.updatedAt,
        );
        expect(ruleRepository.clearJobsStaleIfUnchanged).toHaveBeenCalledWith(
            secondRule.id,
            secondRule.updatedAt,
        );
        expect(logger.error).toHaveBeenCalledWith(
            expect.stringContaining(firstRule.id),
            expect.any(String),
        );
    });

    it("maps the service information name variable from the client name", () => {
        const { internals } = createService();
        const rule = createRule({
            eventType: MessageTriggerEventType.SERVICE_START,
            offsetType: MessageTriggerOffsetType.BEFORE_DAYS,
            offsetDays: 7,
            templateKey: MessageTriggerTemplateKey.SERVICE_INFO,
        });

        const variables = internals.buildClientTemplateVariables(rule, {
            name: "김지니",
            phone: "010-1234-5678",
            type: "A가1형",
            startDate: new Date("2026-06-12T00:00:00.000Z"),
            endDate: null,
            createdAt: new Date("2026-06-01T00:00:00.000Z"),
        });

        expect(variables).toEqual({
            name: "김지니",
            clientName: "김지니",
            phone: "010-1234-5678",
        });
    });

    it("maps CLIENT_GREETING template variables from the client", () => {
        const { internals } = createService();
        const rule = createRule({
            eventType: MessageTriggerEventType.CLIENT_CREATED,
            offsetType: MessageTriggerOffsetType.IMMEDIATE,
            offsetDays: 0,
            templateKey: MessageTriggerTemplateKey.CLIENT_GREETING,
        });

        const variables = internals.buildClientTemplateVariables(rule, {
            name: "김산모",
            phone: "010-9999-0000",
            type: null,
            startDate: null,
            endDate: null,
            createdAt: new Date("2026-06-27T00:00:00.000Z"),
        });

        expect(variables).toEqual({
            name: "김산모",
            clientName: "김산모",
            phone: "010-9999-0000",
        });
    });

    it("maps PRICE_INFO template variables including price/bank fields (data-minimization scoping)", () => {
        const { internals } = createService();
        const rule = createRule({
            eventType: MessageTriggerEventType.SERVICE_START,
            offsetType: MessageTriggerOffsetType.BEFORE_DAYS,
            offsetDays: 7,
            templateKey: MessageTriggerTemplateKey.PRICE_INFO,
        });

        const variables = internals.buildClientTemplateVariables(rule, {
            name: "이고객",
            phone: "010-5555-6666",
            type: "B형",
            startDate: new Date("2026-07-01T00:00:00.000Z"),
            endDate: null,
            createdAt: null,
            fullPrice: "3000000",
            grant: "2000000",
            actualPrice: "1000000",
            area: { bankAccountInfo: { bankName: "신한은행", accNum: "110-123-456789" } },
        });

        expect(variables).toEqual({
            name: "이고객",
            clientName: "이고객",
            phone: "010-5555-6666",
            weeks: "0",
            duration: "",
            type: "B형",
            fullPrice: "3000000",
            grant: "2000000",
            actualPrice: "1000000",
            bankName: "신한은행",
            accNum: "110-123-456789",
        });
    });

    const createSyncService = (clientOverrides: Partial<{
        id: number;
        name: string;
        phone: string | null;
        type: string | null;
        startDate: Date | null;
        endDate: Date | null;
        createdAt: Date | null;
    }> = {}) => {
        const ruleRepository = {
            findAll: jest.fn(),
            findActiveByEventTypes: jest.fn(),
            create: jest.fn(),
        };
        const jobRepository = {
            upsertPending: jest.fn().mockResolvedValue(undefined),
            upsertPendingForRuleGeneration: jest.fn().mockImplementation(async (job: MessageTriggerJobEntity) => {
                await jobRepository.upsertPending(job);
                return job;
            }),
            findPendingByRuleIdsAndClientId: jest.fn().mockResolvedValue([]),
            cancelPendingByClientContext: jest.fn().mockResolvedValue(0),
            cancelPendingForRuleGeneration: jest.fn().mockImplementation(async (
                _branchId: string,
                ruleId: string,
                _expectedUpdatedAt: Date,
                _expectedJobsStale: boolean,
                reason: string,
                scope?: { clientId?: number },
            ) => {
                if (scope?.clientId === undefined) return 0;
                const jobs = await jobRepository.findPendingByRuleIdsAndClientId([ruleId], scope.clientId);
                for (const job of jobs) {
                    job.cancel(reason);
                    await jobRepository.update(job);
                }
                return jobs.length;
            }),
            update: jest.fn().mockResolvedValue(undefined),
        };
        const prisma = {
            client: {
                findFirst: jest.fn().mockResolvedValue({
                    id: 1,
                    name: "김산모",
                    phone: "010-1234-5678",
                    type: null,
                    startDate: null,
                    endDate: null,
                    createdAt: new Date("2026-06-27T00:00:00.000Z"),
                    ...clientOverrides,
                }),
            },
        };
        const messageLogRepository = createMessageLogRepository();
        const messageSenderApprovalService = createMessageSenderApprovalService();
        const systemSettingService = {
            getMessageAutomationPastTriggerConfig: jest.fn().mockResolvedValue({
                sendIntervalMinutes: 1,
                ruleOrder: [],
            }),
        };
        const service = new MessageTriggerService(
            prisma as never,
            {} as never,
            messageSenderApprovalService as never,
            ruleRepository as never,
            jobRepository as never,
            messageLogRepository as never,
            systemSettingService as never,
        );
        return {
            service,
            ruleRepository,
            jobRepository,
            prisma,
            messageSenderApprovalService,
            systemSettingService,
        };
    };

    const createEmployeeSchedule = (
        overrides: Partial<EmployeeAssignmentScheduleSource> = {},
    ): EmployeeAssignmentScheduleSource => ({
        id: 77,
        clientId: 1,
        startDate: new Date("2026-07-15T00:00:00.000Z"),
        primaryEmployeeId: 30,
        secondaryEmployeeId: null,
        client: { id: 1, name: "김산모" },
        primaryEmployee: { id: 30, name: "홍제공", phone: "010-1111-2222" },
        secondaryEmployee: null,
        ...overrides,
    });

    const createEmployeeSyncService = (
        scheduleOverrides: Partial<EmployeeAssignmentScheduleSource> = {},
    ) => {
        const ruleRepository = {
            findAll: jest.fn(),
            findActiveByEventTypes: jest.fn(),
            create: jest.fn(),
        };
        const jobRepository = {
            upsertPending: jest.fn().mockResolvedValue(undefined),
            upsertPendingForRuleGeneration: jest.fn().mockImplementation(async (job: MessageTriggerJobEntity) => {
                await jobRepository.upsertPending(job);
                return job;
            }),
            findPendingByRuleIdsAndEmployeeScheduleId: jest.fn().mockResolvedValue([]),
            findSentByRuleIdAndEmployeeScheduleId: jest.fn().mockResolvedValue([]),
            cancelPendingForRuleGeneration: jest.fn().mockImplementation(async (
                _branchId: string,
                ruleId: string,
                _expectedUpdatedAt: Date,
                _expectedJobsStale: boolean,
                reason: string,
                scope?: { employeeScheduleId?: number },
            ) => {
                if (scope?.employeeScheduleId === undefined) return 0;
                const jobs = await jobRepository.findPendingByRuleIdsAndEmployeeScheduleId(
                    [ruleId],
                    scope.employeeScheduleId,
                );
                for (const job of jobs) {
                    job.cancel(reason);
                    await jobRepository.update(job);
                }
                return jobs.length;
            }),
            update: jest.fn().mockResolvedValue(undefined),
        };
        const prisma = {
            employee_schedule: {
                findFirst: jest.fn().mockResolvedValue(createEmployeeSchedule(scheduleOverrides)),
            },
        };
        const messageLogRepository = createMessageLogRepository();
        const messageSenderApprovalService = createMessageSenderApprovalService();
        const service = new MessageTriggerService(
            prisma as never,
            {} as never,
            messageSenderApprovalService as never,
            ruleRepository as never,
            jobRepository as never,
            messageLogRepository as never,
        );
        return {
            service,
            ruleRepository,
            jobRepository,
            prisma,
            messageSenderApprovalService,
        };
    };

    it("syncClientRulesForClient is a no-op for an unapproved branch", async () => {
        const sync = createSyncService();
        sync.messageSenderApprovalService.isApproved.mockResolvedValue(false);

        await sync.service.syncClientRulesForClient(branchId, 1, true);

        expect(sync.messageSenderApprovalService.isApproved).toHaveBeenCalledWith(branchId);
        expect(sync.prisma.client.findFirst).not.toHaveBeenCalled();
        expect(sync.ruleRepository.findActiveByEventTypes).not.toHaveBeenCalled();
        expect(sync.jobRepository.upsertPending).not.toHaveBeenCalled();
    });

    it("cancels every pending job tied to a client before client deletion", async () => {
        const sync = createSyncService();

        await sync.service.cancelPendingJobsForClientDeletion(branchId, 42);

        expect(sync.jobRepository.cancelPendingByClientContext).toHaveBeenCalledWith(
            branchId,
            42,
            "Client deleted",
        );
    });

    it("uses the new client id when the same phone is registered after deletion", async () => {
        const serviceEndRule = createRule({
            id: "rule-service-end",
            eventType: MessageTriggerEventType.SERVICE_END,
            offsetType: MessageTriggerOffsetType.BEFORE_DAYS,
            offsetDays: 1,
            templateKey: MessageTriggerTemplateKey.SERVICE_END_REMINDER,
        });
        const recreated = createSyncService({
            id: 42,
            phone: "010-1234-5678",
            endDate: new Date("2026-08-01T00:00:00.000Z"),
        });
        recreated.ruleRepository.findActiveByEventTypes.mockResolvedValue([serviceEndRule]);

        await recreated.service.syncClientRulesForClient(branchId, 42, true);

        const persistedJob = recreated.jobRepository.upsertPending.mock.calls[0]?.[0];
        expect(persistedJob?.clientId).toBe(42);
        expect(persistedJob?.dedupeKey).toContain(":client:42:");
    });

    it("rebuildJobsForRule is a no-op for an unapproved branch", async () => {
        const prisma = {
            client: {
                findMany: jest.fn(),
            },
        };
        const jobRepository = {
            upsertPending: jest.fn(),
            upsertPendingForRuleGeneration: jest.fn(),
        };
        const messageSenderApprovalService = createMessageSenderApprovalService();
        messageSenderApprovalService.isApproved.mockResolvedValue(false);
        const service = new MessageTriggerService(
            prisma as never,
            {} as never,
            messageSenderApprovalService as never,
            {} as never,
            jobRepository as never,
            createMessageLogRepository() as never,
        );
        const serviceInfoRule = createRule({
            id: "rule-service-info",
            eventType: MessageTriggerEventType.SERVICE_START,
            offsetType: MessageTriggerOffsetType.BEFORE_DAYS,
            offsetDays: 7,
            templateKey: MessageTriggerTemplateKey.SERVICE_INFO,
        });

        await (service as unknown as ServiceInternals).rebuildJobsForRule(
            branchId,
            serviceInfoRule,
            false,
        );

        expect(messageSenderApprovalService.isApproved).toHaveBeenCalledWith(branchId);
        expect(prisma.client.findMany).not.toHaveBeenCalled();
        expect(jobRepository.upsertPending).not.toHaveBeenCalled();
    });

    it("does not enqueue a new IMMEDIATE greeting on re-sync (includePast=false) but fires it on create (includePast=true)", async () => {
        const greetingRule = createRule({
            id: "rule-greeting-active",
            eventType: MessageTriggerEventType.CLIENT_CREATED,
            offsetType: MessageTriggerOffsetType.IMMEDIATE,
            offsetDays: 0,
            templateKey: MessageTriggerTemplateKey.CLIENT_GREETING,
        });

        // Re-sync path (client update / due-date scheduler): no new greeting job is created.
        const reSync = createSyncService();
        reSync.ruleRepository.findActiveByEventTypes.mockResolvedValue([greetingRule]);
        await reSync.service.syncClientRulesForClient(branchId, 1, false);
        expect(reSync.jobRepository.upsertPending).not.toHaveBeenCalled();

        // Create path: greeting must fire exactly once.
        const create = createSyncService();
        create.ruleRepository.findActiveByEventTypes.mockResolvedValue([greetingRule]);
        await create.service.syncClientRulesForClient(branchId, 1, true);
        expect(create.jobRepository.upsertPending).toHaveBeenCalledTimes(1);
    });

    it("keeps the still-pending IMMEDIATE greeting alive on an includePast=false resync", async () => {
        const greetingRule = createRule({
            id: "rule-greeting-active",
            eventType: MessageTriggerEventType.CLIENT_CREATED,
            offsetType: MessageTriggerOffsetType.IMMEDIATE,
            offsetDays: 0,
            templateKey: MessageTriggerTemplateKey.CLIENT_GREETING,
        });
        const pendingGreeting = createJob({
            id: "job-greeting-pending",
            ruleId: greetingRule.id,
        });
        const reSync = createSyncService();
        reSync.ruleRepository.findActiveByEventTypes.mockResolvedValue([greetingRule]);
        reSync.jobRepository.findPendingByRuleIdsAndClientId.mockResolvedValue([pendingGreeting]);

        await reSync.service.syncClientRulesForClient(branchId, 1, false);

        expect(reSync.jobRepository.findPendingByRuleIdsAndClientId).toHaveBeenCalledWith(
            [greetingRule.id],
            1,
        );
        expect(pendingGreeting.status).toBe("pending");
        expect(pendingGreeting.canceledAt).toBeNull();
        expect(pendingGreeting.cancelReason).toBeNull();
        expect(reSync.jobRepository.upsertPendingForRuleGeneration).toHaveBeenCalledTimes(1);
    });

    it("refreshes the pending IMMEDIATE job's recipient phone and payload from the edited client", async () => {
        const greetingRule = createRule({
            id: "rule-greeting-active",
            eventType: MessageTriggerEventType.CLIENT_CREATED,
            offsetType: MessageTriggerOffsetType.IMMEDIATE,
            offsetDays: 0,
            templateKey: MessageTriggerTemplateKey.CLIENT_GREETING,
        });
        const scheduledFor = new Date("2026-06-27T00:00:00.000Z");
        const pendingGreeting = createJob({
            id: "job-greeting-pending",
            ruleId: greetingRule.id,
            scheduledFor,
            recipientPhone: "010-0000-0000",
            payload: {
                memberId: "1",
                recipientName: "김산모",
                recipientPhone: "010-0000-0000",
                templateVariables: {
                    name: "김산모",
                    clientName: "김산모",
                    phone: "010-0000-0000",
                },
                catchUp: {
                    batchId: "client:1:batch",
                    sequence: 2,
                    intervalMinutes: 3,
                    originalScheduledFor: "2026-06-27T00:00:00.000Z",
                    predecessorDedupeKey: "dedupe-predecessor",
                },
            },
        });
        const reSync = createSyncService({
            name: "김수정",
            phone: "010-9999-0000",
        });
        reSync.ruleRepository.findActiveByEventTypes.mockResolvedValue([greetingRule]);
        reSync.jobRepository.findPendingByRuleIdsAndClientId.mockResolvedValue([pendingGreeting]);

        await reSync.service.syncClientRulesForClient(branchId, 1, false);

        expect(reSync.jobRepository.upsertPendingForRuleGeneration).toHaveBeenCalledWith(
            pendingGreeting,
            greetingRule.updatedAt,
            false,
        );
        expect(pendingGreeting.recipientPhone).toBe("010-9999-0000");
        expect(pendingGreeting.payload).toMatchObject({
            clientId: 1,
            clientName: "김수정",
            memberId: "1",
            recipientName: "김수정",
            recipientPhone: "010-9999-0000",
            templateVariables: {
                name: "김수정",
                clientName: "김수정",
                phone: "010-9999-0000",
            },
            catchUp: {
                batchId: "client:1:batch",
                sequence: 2,
                intervalMinutes: 3,
                originalScheduledFor: "2026-06-27T00:00:00.000Z",
                predecessorDedupeKey: "dedupe-predecessor",
            },
        });
        expect(pendingGreeting.status).toBe("pending");
        expect(pendingGreeting.scheduledFor).toBe(scheduledFor);
        expect(pendingGreeting.dedupeKey).toBe("dedupe-job-greeting-pending");
        expect(pendingGreeting.attempts).toBe(0);
    });

    it("still cancels and rebuilds non-IMMEDIATE jobs on the same resync", async () => {
        // Pin the clock like sibling tests: resync/rebuild logic is relative to "now",
        // so without this the test is date-brittle (passed on the service-start day, failed after).
        jest.useFakeTimers().setSystemTime(new Date("2026-07-15T00:00:00.000Z"));
        try {
        const greetingRule = createRule({
            id: "rule-greeting-active",
            eventType: MessageTriggerEventType.CLIENT_CREATED,
            offsetType: MessageTriggerOffsetType.IMMEDIATE,
            offsetDays: 0,
            templateKey: MessageTriggerTemplateKey.CLIENT_GREETING,
        });
        const serviceInfoRule = createRule({
            id: "rule-service-info-active",
            eventType: MessageTriggerEventType.SERVICE_START,
            offsetType: MessageTriggerOffsetType.SAME_DAY,
            offsetDays: 0,
            templateKey: MessageTriggerTemplateKey.SERVICE_INFO,
        });
        const pendingGreeting = createJob({
            id: "job-greeting-pending",
            ruleId: greetingRule.id,
        });
        const pendingServiceInfo = createJob({
            id: "job-service-info-pending",
            ruleId: serviceInfoRule.id,
            templateKey: MessageTriggerTemplateKey.SERVICE_INFO,
        });
        const reSync = createSyncService({
            startDate: new Date("2026-07-15T00:00:00.000Z"),
        });
        reSync.ruleRepository.findActiveByEventTypes.mockResolvedValue([
            greetingRule,
            serviceInfoRule,
        ]);
        reSync.jobRepository.findPendingByRuleIdsAndClientId.mockImplementation(
            async (ruleIds: string[]) => {
                if (ruleIds.includes(serviceInfoRule.id)) return [pendingServiceInfo];
                if (ruleIds.includes(greetingRule.id)) return [pendingGreeting];
                return [];
            },
        );

            await reSync.service.syncClientRulesForClient(branchId, 1, false);

        expect(reSync.jobRepository.findPendingByRuleIdsAndClientId).toHaveBeenNthCalledWith(
            1,
            [serviceInfoRule.id],
            1,
        );
        expect(reSync.jobRepository.findPendingByRuleIdsAndClientId).toHaveBeenNthCalledWith(
            2,
            [greetingRule.id],
            1,
        );
        expect(pendingServiceInfo.status).toBe("canceled");
        expect(pendingServiceInfo.cancelReason).toBe("Client data changed");
        expect(pendingGreeting.status).toBe("pending");
        expect(reSync.jobRepository.upsertPendingForRuleGeneration).toHaveBeenCalledTimes(2);
        expect(reSync.jobRepository.upsertPendingForRuleGeneration.mock.calls[1][0]).toMatchObject({
            ruleId: serviceInfoRule.id,
            status: "pending",
            clientId: 1,
            templateKey: MessageTriggerTemplateKey.SERVICE_INFO,
        });
        } finally {
            jest.useRealTimers();
        }
    });

    it("schedules offset jobs at 09:00 KST regardless of process timezone", async () => {
        const originalTimeZone = process.env["TZ"];
        process.env["TZ"] = "UTC";
        jest.useFakeTimers().setSystemTime(new Date("2026-07-09T00:00:00.000Z"));
        try {
            const serviceInfoRule = createRule({
                id: "rule-service-info-active",
                eventType: MessageTriggerEventType.SERVICE_START,
                offsetType: MessageTriggerOffsetType.BEFORE_DAYS,
                offsetDays: 1,
                templateKey: MessageTriggerTemplateKey.SERVICE_INFO,
            });
            const reSync = createSyncService({
                startDate: new Date("2026-07-14T16:30:00.000Z"),
            });
            reSync.ruleRepository.findActiveByEventTypes.mockResolvedValue([serviceInfoRule]);

            await reSync.service.syncClientRulesForClient(branchId, 1, false);

            expect(reSync.jobRepository.upsertPending).toHaveBeenCalledTimes(1);
            const expectedDate = "2026-07-14";
            const expectedHour = String(SEND_HOUR_KST).padStart(2, "0");
            const expectedScheduledFor = new Date(`${expectedDate}T${expectedHour}:00:00+09:00`);
            const persistedJob = reSync.jobRepository.upsertPending.mock.calls[0][0];
            expect(persistedJob.scheduledFor).toEqual(expectedScheduledFor);
            expect(persistedJob.dedupeKey).toContain(expectedScheduledFor.toISOString());
        } finally {
            if (originalTimeZone === undefined) {
                delete process.env["TZ"];
            } else {
                process.env["TZ"] = originalTimeZone;
            }
            jest.useRealTimers();
        }
    });

    it("includePast=false resync does not materialize occurrences older than the grace window", async () => {
        jest.useFakeTimers().setSystemTime(new Date("2026-07-09T12:00:00.000Z"));
        try {
            const serviceInfoRule = createRule({
                id: "rule-service-info-active",
                eventType: MessageTriggerEventType.SERVICE_START,
                offsetType: MessageTriggerOffsetType.SAME_DAY,
                offsetDays: 0,
                templateKey: MessageTriggerTemplateKey.SERVICE_INFO,
            });
            const reSync = createSyncService({
                startDate: new Date("2026-07-07T00:00:00.000Z"),
            });
            reSync.ruleRepository.findActiveByEventTypes.mockResolvedValue([serviceInfoRule]);

            await reSync.service.syncClientRulesForClient(branchId, 1, false);

            expect(reSync.jobRepository.upsertPending).not.toHaveBeenCalled();
        } finally {
            jest.useRealTimers();
        }
    });

    it("includePast=false resync still materializes an occurrence due within the grace window", async () => {
        jest.useFakeTimers().setSystemTime(new Date("2026-07-09T01:00:00.000Z"));
        try {
            const serviceInfoRule = createRule({
                id: "rule-service-info-active",
                eventType: MessageTriggerEventType.SERVICE_START,
                offsetType: MessageTriggerOffsetType.SAME_DAY,
                offsetDays: 0,
                templateKey: MessageTriggerTemplateKey.SERVICE_INFO,
            });
            const reSync = createSyncService({
                startDate: new Date("2026-07-09T00:00:00.000Z"),
            });
            reSync.ruleRepository.findActiveByEventTypes.mockResolvedValue([serviceInfoRule]);

            await reSync.service.syncClientRulesForClient(branchId, 1, false);

            expect(reSync.jobRepository.upsertPending).toHaveBeenCalledTimes(1);
            const persistedJob = reSync.jobRepository.upsertPending.mock.calls[0][0];
            expect(persistedJob.scheduledFor).toEqual(new Date("2026-07-09T09:00:00+09:00"));
        } finally {
            jest.useRealTimers();
        }
    });

    it("includePast=true catches up a pre-start notice when registration is late but service has not started", async () => {
        jest.useFakeTimers().setSystemTime(new Date("2026-07-09T12:00:00.000Z"));
        try {
            const serviceInfoRule = createRule({
                id: "rule-service-info-active",
                eventType: MessageTriggerEventType.SERVICE_START,
                offsetType: MessageTriggerOffsetType.BEFORE_DAYS,
                offsetDays: 7,
                templateKey: MessageTriggerTemplateKey.SERVICE_INFO,
            });
            const create = createSyncService({
                startDate: new Date("2026-07-14T00:00:00.000Z"),
                createdAt: new Date("2026-07-09T00:00:00.000Z"),
            });
            create.ruleRepository.findActiveByEventTypes.mockResolvedValue([serviceInfoRule]);

            await create.service.syncClientRulesForClient(branchId, 1, true);

            expect(create.jobRepository.upsertPending).toHaveBeenCalledTimes(1);
            const persistedJob = create.jobRepository.upsertPending.mock.calls[0][0];
            expect(persistedJob.scheduledFor).toEqual(new Date("2026-07-09T12:00:00.000Z"));
            expect(persistedJob.dedupeKey).toContain("2026-07-09T12:00:00.000Z");
        } finally {
            jest.useRealTimers();
        }
    });

    it("includePast=true skips pre-start notices once the service start date has arrived", async () => {
        jest.useFakeTimers().setSystemTime(new Date("2026-07-09T12:00:00.000Z"));
        try {
            const serviceInfoRule = createRule({
                id: "rule-service-info-active",
                eventType: MessageTriggerEventType.SERVICE_START,
                offsetType: MessageTriggerOffsetType.BEFORE_DAYS,
                offsetDays: 7,
                templateKey: MessageTriggerTemplateKey.SERVICE_INFO,
            });
            const create = createSyncService({
                startDate: new Date("2026-07-09T00:00:00.000Z"),
                createdAt: new Date("2026-07-09T01:00:00.000Z"),
            });
            create.ruleRepository.findActiveByEventTypes.mockResolvedValue([serviceInfoRule]);

            await create.service.syncClientRulesForClient(branchId, 1, true);

            expect(create.jobRepository.upsertPending).not.toHaveBeenCalled();
        } finally {
            jest.useRealTimers();
        }
    });

    it("includePast=true applies saved retroactive order and interval to due client jobs", async () => {
        jest.useFakeTimers().setSystemTime(new Date("2026-07-09T12:00:00.000Z"));
        try {
            const firstRule = createRule({
                id: "rule-first",
                eventType: MessageTriggerEventType.SERVICE_START,
                offsetType: MessageTriggerOffsetType.BEFORE_DAYS,
                offsetDays: 7,
                templateKey: MessageTriggerTemplateKey.SERVICE_INFO,
                createdAt: new Date("2026-06-02T00:00:00.000Z"),
            });
            const secondRule = createRule({
                id: "rule-second",
                eventType: MessageTriggerEventType.CLIENT_CREATED,
                offsetType: MessageTriggerOffsetType.IMMEDIATE,
                offsetDays: 0,
                templateKey: MessageTriggerTemplateKey.CLIENT_GREETING,
                createdAt: new Date("2026-06-01T00:00:00.000Z"),
            });
            const create = createSyncService({
                startDate: new Date("2026-07-14T00:00:00.000Z"),
                createdAt: new Date("2026-07-09T00:00:00.000Z"),
            });
            create.systemSettingService.getMessageAutomationPastTriggerConfig.mockResolvedValue({
                sendIntervalMinutes: 3,
                ruleOrder: [secondRule.id, firstRule.id],
            });
            create.ruleRepository.findActiveByEventTypes.mockResolvedValue([firstRule, secondRule]);

            await create.service.syncClientRulesForClient(branchId, 1, true);

            expect(create.jobRepository.upsertPending).toHaveBeenCalledTimes(2);
            const firstPersistedJob = create.jobRepository.upsertPending.mock.calls[0][0];
            const secondPersistedJob = create.jobRepository.upsertPending.mock.calls[1][0];
            expect(firstPersistedJob.ruleId).toBe(secondRule.id);
            expect(firstPersistedJob.scheduledFor).toEqual(new Date("2026-07-09T12:00:00.000Z"));
            expect(secondPersistedJob.ruleId).toBe(firstRule.id);
            expect(secondPersistedJob.scheduledFor).toEqual(new Date("2026-07-09T12:03:00.000Z"));
            expect(firstPersistedJob.payload.catchUp).toMatchObject({
                sequence: 1,
                intervalMinutes: 3,
                predecessorDedupeKey: null,
            });
            expect(secondPersistedJob.payload.catchUp).toMatchObject({
                batchId: firstPersistedJob.payload.catchUp.batchId,
                sequence: 2,
                intervalMinutes: 3,
                predecessorDedupeKey: firstPersistedJob.dedupeKey,
            });
        } finally {
            jest.useRealTimers();
        }
    });

    it("replays a client intent with stable keys without canceling an existing pending job", async () => {
        jest.useFakeTimers().setSystemTime(new Date("2026-07-09T12:00:00.000Z"));
        try {
            const stableBatchAt = new Date("2026-07-09T11:58:00.000Z");
            const greetingRule = createRule({
                id: "rule-greeting-intent",
                eventType: MessageTriggerEventType.CLIENT_CREATED,
                offsetType: MessageTriggerOffsetType.IMMEDIATE,
                offsetDays: 0,
                templateKey: MessageTriggerTemplateKey.CLIENT_GREETING,
            });
            const serviceInfoRule = createRule({
                id: "rule-service-info-intent",
                eventType: MessageTriggerEventType.SERVICE_START,
                offsetType: MessageTriggerOffsetType.BEFORE_DAYS,
                offsetDays: 7,
                templateKey: MessageTriggerTemplateKey.SERVICE_INFO,
            });
            const existingServiceInfo = createJob({
                id: "job-service-info-existing",
                ruleId: serviceInfoRule.id,
                clientId: 1,
                templateKey: MessageTriggerTemplateKey.SERVICE_INFO,
            });
            const sync = createSyncService({
                startDate: new Date("2026-07-14T00:00:00.000Z"),
                createdAt: new Date("2026-07-09T00:00:00.000Z"),
            });
            sync.ruleRepository.findActiveByEventTypes.mockResolvedValue([
                greetingRule,
                serviceInfoRule,
            ]);
            sync.jobRepository.findPendingByRuleIdsAndClientId.mockResolvedValue([
                existingServiceInfo,
            ]);

            await sync.service.syncClientRulesForClient(
                branchId,
                1,
                true,
                false,
                { stableBatchAt, preserveExisting: true },
            );
            await sync.service.syncClientRulesForClient(
                branchId,
                1,
                true,
                false,
                { stableBatchAt, preserveExisting: true },
            );

            expect(sync.jobRepository.cancelPendingForRuleGeneration).not.toHaveBeenCalled();
            expect(sync.jobRepository.findPendingByRuleIdsAndClientId).not.toHaveBeenCalled();
            expect(existingServiceInfo.status).toBe("pending");
            expect(sync.jobRepository.upsertPendingForRuleGeneration).toHaveBeenCalledTimes(4);

            const firstAttempt = sync.jobRepository.upsertPendingForRuleGeneration.mock.calls
                .slice(0, 2)
                .map(([job, , , preserveExisting]) => ({
                    dedupeKey: job.dedupeKey,
                    scheduledFor: job.scheduledFor,
                    preserveExisting,
                }));
            const secondAttempt = sync.jobRepository.upsertPendingForRuleGeneration.mock.calls
                .slice(2, 4)
                .map(([job, , , preserveExisting]) => ({
                    dedupeKey: job.dedupeKey,
                    scheduledFor: job.scheduledFor,
                    preserveExisting,
                }));
            expect(secondAttempt).toEqual(firstAttempt);
            expect(firstAttempt.every(({ preserveExisting }) => preserveExisting === true)).toBe(true);
        } finally {
            jest.useRealTimers();
        }
    });

    it("replays an employee-assignment intent without canceling its stable job", async () => {
        const employeeRule = createRule({
            id: "rule-employee-intent",
            eventType: MessageTriggerEventType.EMPLOYEE_ASSIGNED,
            offsetType: MessageTriggerOffsetType.IMMEDIATE,
            recipientType: MessageTriggerRecipientType.PRIMARY_EMPLOYEE,
            templateKey: MessageTriggerTemplateKey.EMPLOYEE_ASSIGNED,
        });
        const existingAssignment = createJob({
            id: "job-employee-existing",
            ruleId: employeeRule.id,
            employeeScheduleId: 77,
            recipientType: MessageTriggerRecipientType.PRIMARY_EMPLOYEE,
            templateKey: MessageTriggerTemplateKey.EMPLOYEE_ASSIGNED,
        });
        const sync = createEmployeeSyncService();
        sync.ruleRepository.findActiveByEventTypes.mockResolvedValue([employeeRule]);
        sync.jobRepository.findPendingByRuleIdsAndEmployeeScheduleId.mockResolvedValue([
            existingAssignment,
        ]);

        await sync.service.syncEmployeeAssignmentRulesForSchedule(
            branchId,
            77,
            true,
            { preserveExisting: true },
        );

        expect(sync.jobRepository.cancelPendingForRuleGeneration).not.toHaveBeenCalled();
        expect(sync.jobRepository.findPendingByRuleIdsAndEmployeeScheduleId).not.toHaveBeenCalled();
        expect(existingAssignment.status).toBe("pending");
        expect(sync.jobRepository.upsertPendingForRuleGeneration).toHaveBeenCalledWith(
            expect.objectContaining({
                dedupeKey: "rule-employee-intent:schedule:77:employee:30:PRIMARY_EMPLOYEE",
            }),
            employeeRule.updatedAt,
            false,
            true,
        );
    });

    it("re-approving a schedule change for the same employee does not create a second assignment job", async () => {
        const employeeRule = createRule({
            id: "rule-employee-assigned",
            eventType: MessageTriggerEventType.EMPLOYEE_ASSIGNED,
            offsetType: MessageTriggerOffsetType.IMMEDIATE,
            recipientType: MessageTriggerRecipientType.PRIMARY_EMPLOYEE,
            templateKey: MessageTriggerTemplateKey.EMPLOYEE_ASSIGNED,
        });
        const sentOldFormatJob = createJob({
            id: "job-sent-old-format",
            ruleId: employeeRule.id,
            status: "sent",
            employeeScheduleId: 77,
            recipientType: MessageTriggerRecipientType.PRIMARY_EMPLOYEE,
            recipientPhone: "010-1111-2222",
            templateKey: MessageTriggerTemplateKey.EMPLOYEE_ASSIGNED,
            dedupeKey: "rule-employee-assigned:schedule:77:PRIMARY_EMPLOYEE:2026-07-09T00:00:00.000Z",
            payload: {
                memberId: "employee:30",
                recipientName: "홍제공",
                recipientPhone: "010-1111-2222",
                templateVariables: {},
            },
        });
        const sync = createEmployeeSyncService();
        sync.ruleRepository.findActiveByEventTypes.mockResolvedValue([employeeRule]);
        sync.jobRepository.findSentByRuleIdAndEmployeeScheduleId.mockResolvedValue([sentOldFormatJob]);

        await sync.service.syncEmployeeAssignmentRulesForSchedule(branchId, 77, true);

        expect(sync.jobRepository.findSentByRuleIdAndEmployeeScheduleId).toHaveBeenCalledWith(
            employeeRule.id,
            77,
        );
        expect(sync.jobRepository.upsertPending).not.toHaveBeenCalled();
    });

    it("re-assignment to a new employee creates a new assignment job", async () => {
        const employeeRule = createRule({
            id: "rule-employee-assigned",
            eventType: MessageTriggerEventType.EMPLOYEE_ASSIGNED,
            offsetType: MessageTriggerOffsetType.IMMEDIATE,
            recipientType: MessageTriggerRecipientType.PRIMARY_EMPLOYEE,
            templateKey: MessageTriggerTemplateKey.EMPLOYEE_ASSIGNED,
        });
        const sentOldEmployeeJob = createJob({
            id: "job-sent-old-employee",
            ruleId: employeeRule.id,
            status: "sent",
            employeeScheduleId: 77,
            recipientType: MessageTriggerRecipientType.PRIMARY_EMPLOYEE,
            recipientPhone: "010-1111-2222",
            templateKey: MessageTriggerTemplateKey.EMPLOYEE_ASSIGNED,
            dedupeKey: "rule-employee-assigned:schedule:77:PRIMARY_EMPLOYEE:2026-07-09T00:00:00.000Z",
            payload: {
                memberId: "employee:30",
                recipientName: "홍제공",
                recipientPhone: "010-1111-2222",
                templateVariables: {},
            },
        });
        const sync = createEmployeeSyncService({
            primaryEmployeeId: 31,
            primaryEmployee: { id: 31, name: "박신규", phone: "010-2222-3333" },
        });
        sync.ruleRepository.findActiveByEventTypes.mockResolvedValue([employeeRule]);
        sync.jobRepository.findSentByRuleIdAndEmployeeScheduleId.mockResolvedValue([sentOldEmployeeJob]);

        await sync.service.syncEmployeeAssignmentRulesForSchedule(branchId, 77, true);

        expect(sync.jobRepository.upsertPending).toHaveBeenCalledTimes(1);
        const persistedJob = sync.jobRepository.upsertPending.mock.calls[0][0];
        expect(persistedJob.dedupeKey).toBe(
            "rule-employee-assigned:schedule:77:employee:31:PRIMARY_EMPLOYEE",
        );
        expect(persistedJob.payload.employeeId).toBe(31);
        expect(persistedJob.recipientPhone).toBe("010-2222-3333");
    });

    it("assignment dedupe key is deterministic for the same rule/schedule/employee/recipient", () => {
        jest.useFakeTimers().setSystemTime(new Date("2026-07-09T00:00:00.000Z"));
        try {
            const { internals } = createService();
            const employeeRule = createRule({
                id: "rule-employee-assigned",
                eventType: MessageTriggerEventType.EMPLOYEE_ASSIGNED,
                offsetType: MessageTriggerOffsetType.IMMEDIATE,
                recipientType: MessageTriggerRecipientType.PRIMARY_EMPLOYEE,
                templateKey: MessageTriggerTemplateKey.EMPLOYEE_ASSIGNED,
            });
            const schedule = createEmployeeSchedule();

            const firstJob = internals.buildEmployeeAssignmentJob(employeeRule, schedule);
            jest.setSystemTime(new Date("2026-07-09T00:05:00.000Z"));
            const secondJob = internals.buildEmployeeAssignmentJob(employeeRule, schedule);

            expect(firstJob?.dedupeKey).toBe(secondJob?.dedupeKey);
            expect(firstJob?.dedupeKey).toBe(
                "rule-employee-assigned:schedule:77:employee:30:PRIMARY_EMPLOYEE",
            );
        } finally {
            jest.useRealTimers();
        }
    });

    it("does not re-create the CLIENT_GREETING default when a non-default (AFTER_DAYS) greeting rule already exists", async () => {
        const { service, ruleRepository, internals } = createService();

        const existingServiceInfo = createRule({
            id: "rule-existing-service-info",
            eventType: MessageTriggerEventType.SERVICE_START,
            offsetType: MessageTriggerOffsetType.BEFORE_DAYS,
            offsetDays: 7,
            templateKey: MessageTriggerTemplateKey.SERVICE_INFO,
        });
        // Admin-created greeting rule with a NON-default offset (AFTER_DAYS, not IMMEDIATE).
        const existingGreetingAfterDays = createRule({
            id: "rule-greeting-after-days",
            eventType: MessageTriggerEventType.CLIENT_CREATED,
            offsetType: MessageTriggerOffsetType.AFTER_DAYS,
            offsetDays: 3,
            templateKey: MessageTriggerTemplateKey.CLIENT_GREETING,
        });
        ruleRepository.findAll.mockResolvedValue([existingServiceInfo, existingGreetingAfterDays]);

        await service.listRules(branchId);

        // The IMMEDIATE greeting default must NOT be auto-created — that would yield two
        // active greeting rules and double-greet every new client.
        expect(ruleRepository.create).not.toHaveBeenCalled();
        expect(internals.rebuildJobsForRule).not.toHaveBeenCalled();
    });

    it("does not re-create the SERVICE_INFO default after the default rule was edited", async () => {
        const { service, ruleRepository, internals } = createService();

        const editedServiceInfo = createRule({
            id: "rule-service-info-edited",
            eventType: MessageTriggerEventType.SERVICE_START,
            offsetType: MessageTriggerOffsetType.BEFORE_DAYS,
            offsetDays: 3,
            templateKey: MessageTriggerTemplateKey.SERVICE_INFO,
        });
        const existingGreeting = createRule({
            id: "rule-existing-greeting",
            eventType: MessageTriggerEventType.CLIENT_CREATED,
            offsetType: MessageTriggerOffsetType.IMMEDIATE,
            offsetDays: 0,
            templateKey: MessageTriggerTemplateKey.CLIENT_GREETING,
        });
        ruleRepository.findAll.mockResolvedValue([editedServiceInfo, existingGreeting]);

        const rules = await service.listRules(branchId);

        expect(ruleRepository.create).not.toHaveBeenCalled();
        expect(internals.rebuildJobsForRule).not.toHaveBeenCalled();
        expect(rules).toEqual([editedServiceInfo, existingGreeting]);
    });

    it("provisioning race: P2002 on create resolves to the existing default instead of throwing", async () => {
        const { service, ruleRepository, internals } = createService();
        const existingServiceInfo = createRule({
            id: "rule-service-info-winner",
            eventType: MessageTriggerEventType.SERVICE_START,
            offsetType: MessageTriggerOffsetType.BEFORE_DAYS,
            offsetDays: 7,
            templateKey: MessageTriggerTemplateKey.SERVICE_INFO,
        });
        const existingGreeting = createRule({
            id: "rule-existing-greeting",
            eventType: MessageTriggerEventType.CLIENT_CREATED,
            offsetType: MessageTriggerOffsetType.IMMEDIATE,
            offsetDays: 0,
            templateKey: MessageTriggerTemplateKey.CLIENT_GREETING,
        });
        const p2002 = new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
            code: "P2002",
            clientVersion: "test",
        });
        ruleRepository.findAll
            .mockResolvedValueOnce([])
            .mockResolvedValueOnce([existingServiceInfo, existingGreeting]);
        ruleRepository.create.mockRejectedValueOnce(p2002);

        await expect(service.listRules(branchId)).resolves.toEqual([
            existingServiceInfo,
            existingGreeting,
        ]);
        expect(ruleRepository.create).toHaveBeenCalledTimes(1);
        expect(ruleRepository.findAll).toHaveBeenCalledTimes(2);
        expect(internals.rebuildJobsForRule).not.toHaveBeenCalled();
    });

    it("provisioned defaults are created with isDefault true", async () => {
        const { service, ruleRepository } = createService();
        const createdServiceInfo = createRule({
            id: "rule-service-info-new",
            eventType: MessageTriggerEventType.SERVICE_START,
            offsetType: MessageTriggerOffsetType.BEFORE_DAYS,
            offsetDays: 7,
            templateKey: MessageTriggerTemplateKey.SERVICE_INFO,
        });
        const createdGreeting = createRule({
            id: "rule-greeting-new",
            eventType: MessageTriggerEventType.CLIENT_CREATED,
            offsetType: MessageTriggerOffsetType.IMMEDIATE,
            offsetDays: 0,
            templateKey: MessageTriggerTemplateKey.CLIENT_GREETING,
        });
        ruleRepository.findAll.mockResolvedValue([]);
        ruleRepository.create
            .mockResolvedValueOnce(createdServiceInfo)
            .mockResolvedValueOnce(createdGreeting);

        await service.listRules(branchId);

        expect(ruleRepository.create).toHaveBeenNthCalledWith(
            1,
            branchId,
            expect.objectContaining({
                templateKey: MessageTriggerTemplateKey.SERVICE_INFO,
                isDefault: true,
            }),
        );
        expect(ruleRepository.create).toHaveBeenNthCalledWith(
            2,
            branchId,
            expect.objectContaining({
                templateKey: MessageTriggerTemplateKey.CLIENT_GREETING,
                isDefault: true,
            }),
        );
    });

    it("ensureDefaultRulesForBranch creates missing default rules (same logic as listRules)", async () => {
        const { service, internals, ruleRepository } = createService();
        const createdGreeting = createRule({
            id: "rule-greeting-new",
            name: "신규 고객 인사 메시지",
            eventType: MessageTriggerEventType.CLIENT_CREATED,
            offsetType: MessageTriggerOffsetType.IMMEDIATE,
            offsetDays: 0,
            templateKey: MessageTriggerTemplateKey.CLIENT_GREETING,
        });
        const createdServiceInfo = createRule({
            id: "rule-service-info-new",
            name: "서비스 시작 7일 전 서비스 안내",
            eventType: MessageTriggerEventType.SERVICE_START,
            offsetType: MessageTriggerOffsetType.BEFORE_DAYS,
            offsetDays: 7,
            templateKey: MessageTriggerTemplateKey.SERVICE_INFO,
        });
        // No rules exist yet — both defaults must be created
        ruleRepository.findAll.mockResolvedValue([]);
        ruleRepository.create
            .mockResolvedValueOnce(createdServiceInfo)
            .mockResolvedValueOnce(createdGreeting);

        await service.ensureDefaultRulesForBranch(branchId);

        expect(ruleRepository.findAll).toHaveBeenCalledWith(branchId);
        expect(ruleRepository.create).toHaveBeenCalledTimes(2);
        expect(internals.rebuildJobsForRule).toHaveBeenCalledTimes(2);
    });
});
