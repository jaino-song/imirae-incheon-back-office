import {
    MessageTriggerRecipientType,
    MessageTriggerTemplateKey,
} from "domain/constants/message-trigger-catalog";
import {
    TRIGGER_JOB_CONFIG_RETRY_DELAY_MS,
    TRIGGER_JOB_MAX_ATTEMPTS,
    TRIGGER_JOB_RETRY_DELAY_MS,
} from "domain/constants/message-automation-policy";
import {
    MessageTriggerJobEntity,
    MessageTriggerJobPayload,
} from "domain/entities/message-trigger-job.entity";
import { createHash } from "node:crypto";
import { PrismaService } from "infrastructure/database/prisma.service";
import { SbMessageTriggerJobRepository } from "infrastructure/database/repositories/sb.message-trigger-job.repository";

describe("MessageTriggerJobEntity", () => {
    const now = new Date("2026-07-09T00:00:00.000Z");

    const createJob = (attempts = 0, nextAttemptAt: Date | null = null) =>
        MessageTriggerJobEntity.reconstitute(
            "job-1",
            "branch-1",
            "rule-1",
            "pending",
            new Date("2026-07-09T01:00:00.000Z"),
            null,
            null,
            null,
            1,
            null,
            MessageTriggerRecipientType.CLIENT,
            "01012345678",
            MessageTriggerTemplateKey.SERVICE_INFO,
            "rule-1:client:1",
            {
                memberId: "1",
                recipientName: "홍길동",
                recipientPhone: "01012345678",
                templateVariables: {},
            },
            new Date("2026-07-08T00:00:00.000Z"),
            new Date("2026-07-08T00:00:00.000Z"),
            attempts,
            nextAttemptAt,
        );

    beforeEach(() => {
        jest.useFakeTimers().setSystemTime(now);
    });

    afterEach(() => {
        jest.useRealTimers();
    });

    it("defer config bumps nextAttemptAt without attempts", () => {
        const job = createJob(2);

        job.defer("config", "provider unconfigured");

        expect(job.status).toBe("pending");
        expect(job.attempts).toBe(2);
        expect(job.nextAttemptAt).toEqual(new Date(now.getTime() + TRIGGER_JOB_CONFIG_RETRY_DELAY_MS));
    });

    it("defer transient increments attempts and terminal-fails at TRIGGER_JOB_MAX_ATTEMPTS", () => {
        const retryJob = createJob(0);
        retryJob.defer("transient", "timeout");

        expect(retryJob.status).toBe("pending");
        expect(retryJob.attempts).toBe(1);
        expect(retryJob.nextAttemptAt).toEqual(new Date(now.getTime() + TRIGGER_JOB_RETRY_DELAY_MS));

        const terminalJob = createJob(TRIGGER_JOB_MAX_ATTEMPTS - 1);
        terminalJob.defer("transient", "timeout");

        expect(terminalJob.status).toBe("failed");
        expect(terminalJob.attempts).toBe(TRIGGER_JOB_MAX_ATTEMPTS);
        expect(terminalJob.cancelReason).toBe("timeout");
    });

    it("markSent clears nextAttemptAt", () => {
        const job = createJob(1, new Date("2026-07-09T00:05:00.000Z"));

        job.markSent();

        expect(job.status).toBe("sent");
        expect(job.nextAttemptAt).toBeNull();
    });
});

describe("SbMessageTriggerJobRepository", () => {
    const now = new Date("2026-07-09T00:00:00.000Z");

    type MockMessageTriggerJobRow = {
        id: string;
        branchId: string | null;
        ruleId: string;
        status: string;
        scheduledFor: Date;
        attempts: number;
        nextAttemptAt: Date | null;
        sentAt: Date | null;
        canceledAt: Date | null;
        cancelReason: string | null;
        clientId: number | null;
        employeeScheduleId: number | null;
        recipientType: string;
        recipientPhone: string | null;
        templateKey: string;
        dedupeKey: string;
        payload: MessageTriggerJobPayload;
        createdAt: Date;
        updatedAt: Date;
    };

    const createMockPrismaMessageTriggerJob = () => ({
        create: jest.fn(),
        update: jest.fn(),
        findUnique: jest.fn(),
        findMany: jest.fn(),
        findFirst: jest.fn(),
        updateMany: jest.fn(),
    });

    const baseRow = (): MockMessageTriggerJobRow => ({
        id: "job-1",
        branchId: "branch-1",
        ruleId: "rule-1",
        status: "pending",
        scheduledFor: new Date("2026-07-09T01:00:00.000Z"),
        attempts: 0,
        nextAttemptAt: null,
        sentAt: null,
        canceledAt: null,
        cancelReason: null,
        clientId: 1,
        employeeScheduleId: null,
        recipientType: MessageTriggerRecipientType.CLIENT,
        recipientPhone: "01012345678",
        templateKey: MessageTriggerTemplateKey.SERVICE_INFO,
        dedupeKey: "rule-1:client:1",
        payload: {
            memberId: "1",
            recipientName: "홍길동",
            recipientPhone: "01012345678",
            templateVariables: {},
        },
        createdAt: new Date("2026-07-08T00:00:00.000Z"),
        updatedAt: new Date("2026-07-08T00:00:00.000Z"),
    });

    const createRow = (overrides: Partial<MockMessageTriggerJobRow> = {}): MockMessageTriggerJobRow => ({
        ...baseRow(),
        ...overrides,
    });

    const createJob = () =>
        MessageTriggerJobEntity.create({
            branchId: "branch-1",
            ruleId: "rule-1",
            scheduledFor: new Date("2026-07-09T01:00:00.000Z"),
            clientId: 1,
            recipientType: MessageTriggerRecipientType.CLIENT,
            recipientPhone: "01012345678",
            templateKey: MessageTriggerTemplateKey.SERVICE_INFO,
            dedupeKey: "rule-1:client:1",
            payload: {
                memberId: "1",
                recipientName: "홍길동",
                recipientPhone: "01012345678",
                templateVariables: {},
            },
        });

    const targetVersion = (job: MessageTriggerJobEntity, snapshotHash: string): string => createHash("sha256").update(JSON.stringify({
        id: job.id,
        branchId: job.branchId,
        ruleId: job.ruleId,
        status: job.status,
        scheduledFor: job.scheduledFor.toISOString(),
        sentAt: job.sentAt?.toISOString() ?? null,
        canceledAt: job.canceledAt?.toISOString() ?? null,
        cancelReason: job.cancelReason,
        clientId: job.clientId,
        employeeScheduleId: job.employeeScheduleId,
        recipientType: job.recipientType,
        recipientPhone: job.recipientPhone,
        templateKey: job.templateKey,
        payload: job.payload,
        attempts: job.attempts,
        nextAttemptAt: job.nextAttemptAt?.toISOString() ?? null,
        createdAt: job.createdAt.toISOString(),
        updatedAt: job.updatedAt.toISOString(),
        deliverySnapshotHash: snapshotHash,
    })).digest("hex");

    const getSqlText = (value: unknown): string => {
        if (typeof value === "object" && value !== null && "strings" in value) {
            const strings = (value as { strings?: unknown }).strings;
            if (Array.isArray(strings)) {
                return strings.join("");
            }
        }

        return String(value);
    };

    let messageTriggerJobModel: ReturnType<typeof createMockPrismaMessageTriggerJob>;
    let queryRaw: jest.Mock;
    let prisma: PrismaService;
    let repository: SbMessageTriggerJobRepository;

    beforeEach(() => {
        jest.useFakeTimers().setSystemTime(now);
        messageTriggerJobModel = createMockPrismaMessageTriggerJob();
        queryRaw = jest.fn();
        prisma = {
            message_trigger_job: messageTriggerJobModel,
            $queryRaw: queryRaw,
            $transaction: jest.fn(),
        } as unknown as PrismaService;
        (prisma.$transaction as jest.Mock).mockImplementation(async (operation: (tx: unknown) => Promise<unknown>) => operation(prisma));
        repository = new SbMessageTriggerJobRepository(prisma);
    });

    afterEach(() => {
        jest.clearAllMocks();
        jest.useRealTimers();
    });

    it("claimPending returns true only when a pending row was claimed", async () => {
        messageTriggerJobModel.updateMany
            .mockResolvedValueOnce({ count: 1 })
            .mockResolvedValueOnce({ count: 0 });

        await expect(repository.claimPending("job-1")).resolves.toBe(true);
        await expect(repository.claimPending("job-1")).resolves.toBe(false);

        expect(messageTriggerJobModel.updateMany).toHaveBeenCalledWith({
            where: { id: "job-1", status: "pending" },
            data: { status: "processing" },
        });
    });

    it("claimPendingWithRuleFence locks the rule before claiming and refuses a stale rule", async () => {
        queryRaw
            .mockResolvedValueOnce([{ rule_id: "rule-1", branch_id: "branch-1" }])
            .mockResolvedValueOnce([{ id: "rule-1", jobs_stale: false }])
            .mockResolvedValueOnce([{ id: "job-1" }]);

        await expect(repository.claimPendingWithRuleFence("job-1", "branch-1")).resolves.toBe(true);
        expect(queryRaw).toHaveBeenCalledTimes(3);
        expect(getSqlText(queryRaw.mock.calls[1][0])).toContain('FROM "message_trigger_rule"');
        expect(getSqlText(queryRaw.mock.calls[1][0])).toContain("FOR UPDATE");
        expect(getSqlText(queryRaw.mock.calls[2][0])).toContain('UPDATE "message_trigger_job"');

        queryRaw.mockReset();
        queryRaw.mockResolvedValueOnce([{ rule_id: "rule-1", branch_id: "branch-1" }])
            .mockResolvedValueOnce([{ id: "rule-1", jobs_stale: true }]);
        await expect(repository.claimPendingWithRuleFence("job-1", "branch-1")).resolves.toBe(false);
        expect(queryRaw).toHaveBeenCalledTimes(2);
    });

    it("hasActiveJobsBefore uses updatedAt as the generation fence when a dedupe row is reactivated", async () => {
        messageTriggerJobModel.findFirst.mockResolvedValueOnce({ id: "job-1" }).mockResolvedValueOnce(null);

        await expect(repository.hasActiveJobsBefore("branch-1", "rule-1", now)).resolves.toBe(true);
        await expect(repository.hasActiveJobsBefore("branch-1", "rule-1", now)).resolves.toBe(false);
        expect(messageTriggerJobModel.findFirst).toHaveBeenCalledWith({
            where: {
                branchId: "branch-1",
                ruleId: "rule-1",
                status: { in: ["pending", "processing"] },
                updatedAt: { lt: now },
            },
            select: { id: true },
        });
    });

    it("findDuePending filters out jobs with future nextAttemptAt and includes null/past", async () => {
        messageTriggerJobModel.findMany.mockResolvedValue([]);

        await repository.findDuePending(25);

        expect(messageTriggerJobModel.findMany).toHaveBeenCalledWith({
            where: {
                status: "pending",
                scheduledFor: { lte: now },
                OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }],
            },
            orderBy: [
                { scheduledFor: "asc" },
                { createdAt: "asc" },
            ],
            take: 25,
        });
    });

    it("findUpcomingPendingByBranch keeps future, overdue, and processing jobs visible", async () => {
        messageTriggerJobModel.findMany.mockResolvedValue([]);

        await repository.findUpcomingPendingByBranch("branch-1", 25);

        expect(messageTriggerJobModel.findMany).toHaveBeenCalledWith({
            where: {
                branchId: "branch-1",
                status: { in: ["pending", "processing"] },
            },
            orderBy: { scheduledFor: "asc" },
            take: 25,
        });
    });

    it("findTerminalByBranch returns failed and canceled jobs newest first", async () => {
        messageTriggerJobModel.findMany.mockResolvedValue([]);

        await repository.findTerminalByBranch("branch-1", 25);

        expect(messageTriggerJobModel.findMany).toHaveBeenCalledWith({
            where: {
                branchId: "branch-1",
                status: { in: ["failed", "canceled"] },
            },
            orderBy: { updatedAt: "desc" },
            take: 25,
        });
    });

    it("upsertPending falls back to findUnique when the guarded update matches no row (sent row stays immutable)", async () => {
        queryRaw.mockResolvedValue([]);
        messageTriggerJobModel.findUnique.mockResolvedValue(createRow({
            status: "sent",
            sentAt: new Date("2026-07-09T00:01:00.000Z"),
            attempts: 2,
        }));

        const result = await repository.upsertPending(createJob());

        expect(queryRaw).toHaveBeenCalledTimes(1);
        const sqlText = getSqlText(queryRaw.mock.calls[0][0]);
        expect(sqlText).toMatch(
            /INSERT INTO "message_trigger_job" \([\s\S]*next_attempt_at,\s*updated_at[\s\S]*\)\s*VALUES/,
        );
        // branch_id is the ONLY uuid-cast parameter: rule_id is a text column and system rules
        // use non-uuid ids ("system:service_record_link") — casting it to uuid breaks the insert.
        expect(sqlText.match(/::uuid/g)).toHaveLength(1);
        expect(sqlText).toMatch(/0,\s*NULL,\s*date_trunc\('milliseconds', clock_timestamp\(\)\)/);
        const normalizedSqlText = sqlText.replace(/\s+/g, " ");
        expect(normalizedSqlText).toContain('ON CONFLICT ("dedupe_key") DO UPDATE SET');
        expect(normalizedSqlText).toContain(
            'WHERE "message_trigger_job"."status" NOT IN (\'sent\', \'processing\')',
        );
        expect(messageTriggerJobModel.findUnique).toHaveBeenCalledWith({
            where: { dedupeKey: "rule-1:client:1" },
        });
        expect(result.status).toBe("sent");
        expect(result.attempts).toBe(2);
    });

    it("upsertPending reactivates a canceled same-dedupe row with a DB generation timestamp", async () => {
        const job = createJob();
        const rebuiltAt = new Date("2026-07-09T00:00:00.123Z");
        queryRaw.mockResolvedValueOnce([{
            id: "job-1",
            branch_id: "branch-1",
            rule_id: "rule-1",
            status: "pending",
            scheduled_for: job.scheduledFor,
            attempts: 0,
            next_attempt_at: null,
            sent_at: null,
            canceled_at: null,
            cancel_reason: null,
            client_id: 1,
            employee_schedule_id: null,
            recipient_type: MessageTriggerRecipientType.CLIENT,
            recipient_phone: "01012345678",
            template_key: MessageTriggerTemplateKey.SERVICE_INFO,
            dedupe_key: job.dedupeKey,
            payload: job.payload,
            created_at: new Date("2026-07-01T00:00:00.000Z"),
            updated_at: rebuiltAt,
        }]);

        const result = await repository.upsertPending(job);

        expect(result.status).toBe("pending");
        expect(result.createdAt).toEqual(new Date("2026-07-01T00:00:00.000Z"));
        expect(result.updatedAt).toEqual(rebuiltAt);
        const sqlText = getSqlText(queryRaw.mock.calls[0][0]).replace(/\s+/g, " ");
        expect(sqlText).toContain("date_trunc('milliseconds', clock_timestamp())");
        expect(sqlText).toContain('WHERE "message_trigger_job"."status" NOT IN (\'sent\', \'processing\')');
    });

    it("upsertPendingForRuleGeneration locks and verifies the rule before writing the pending job", async () => {
        const job = createJob();
        const expectedUpdatedAt = new Date("2026-07-09T00:00:00.123Z");
        queryRaw
            .mockResolvedValueOnce([{
                id: "rule-1",
                branch_id: "branch-1",
                jobs_stale: false,
                updated_at: expectedUpdatedAt,
            }])
            .mockResolvedValueOnce([{
                id: "job-1",
                branch_id: "branch-1",
                rule_id: "rule-1",
                status: "pending",
                scheduled_for: job.scheduledFor,
                attempts: 0,
                next_attempt_at: null,
                sent_at: null,
                canceled_at: null,
                cancel_reason: null,
                client_id: 1,
                employee_schedule_id: null,
                recipient_type: MessageTriggerRecipientType.CLIENT,
                recipient_phone: job.recipientPhone,
                template_key: MessageTriggerTemplateKey.SERVICE_INFO,
                dedupe_key: job.dedupeKey,
                payload: job.payload,
                created_at: new Date("2026-07-01T00:00:00.000Z"),
                updated_at: expectedUpdatedAt,
            }]);

        const result = await repository.upsertPendingForRuleGeneration(
            job,
            expectedUpdatedAt,
            false,
        );

        expect(result?.status).toBe("pending");
        expect(queryRaw).toHaveBeenCalledTimes(2);
        expect(getSqlText(queryRaw.mock.calls[0][0])).toContain('FROM "message_trigger_rule"');
        expect(getSqlText(queryRaw.mock.calls[0][0])).toContain("FOR UPDATE");
        expect(getSqlText(queryRaw.mock.calls[1][0])).toContain('INSERT INTO "message_trigger_job"');
    });

    it.each([
        {
            name: "a newer rule generation",
            ruleUpdatedAt: new Date("2026-07-09T00:00:00.124Z"),
            jobsStale: false,
            expectedUpdatedAt: new Date("2026-07-09T00:00:00.123Z"),
            expectedJobsStale: false,
        },
        {
            name: "an unexpected stale state",
            ruleUpdatedAt: new Date("2026-07-09T00:00:00.123Z"),
            jobsStale: true,
            expectedUpdatedAt: new Date("2026-07-09T00:00:00.123Z"),
            expectedJobsStale: false,
        },
    ])("does not write when upsertPendingForRuleGeneration loses $name", async ({
        ruleUpdatedAt,
        jobsStale,
        expectedUpdatedAt,
        expectedJobsStale,
    }) => {
        const job = createJob();
        queryRaw.mockResolvedValueOnce([{
            id: "rule-1",
            branch_id: "branch-1",
            jobs_stale: jobsStale,
            updated_at: ruleUpdatedAt,
        }]);

        await expect(repository.upsertPendingForRuleGeneration(
            job,
            expectedUpdatedAt,
            expectedJobsStale,
        )).resolves.toBeNull();

        expect(queryRaw).toHaveBeenCalledTimes(1);
        expect(messageTriggerJobModel.findUnique).not.toHaveBeenCalled();
    });

    it("cancelPendingForRuleGeneration locks the rule and applies only the requested pending context", async () => {
        const expectedUpdatedAt = new Date("2026-07-09T00:00:00.123Z");
        queryRaw
            .mockResolvedValueOnce([{
                id: "rule-1",
                branch_id: "branch-1",
                jobs_stale: false,
                updated_at: expectedUpdatedAt,
            }])
            .mockResolvedValueOnce([{ id: "job-1" }]);

        await expect(repository.cancelPendingForRuleGeneration(
            "branch-1",
            "rule-1",
            expectedUpdatedAt,
            false,
            "Client data changed",
            { clientId: 1 },
        )).resolves.toBe(1);

        expect(queryRaw).toHaveBeenCalledTimes(2);
        expect(getSqlText(queryRaw.mock.calls[0][0])).toContain('FROM "message_trigger_rule"');
        expect(getSqlText(queryRaw.mock.calls[0][0])).toContain("FOR UPDATE");
        const updateSql = getSqlText(queryRaw.mock.calls[1][0]);
        expect(updateSql).toContain('UPDATE "message_trigger_job"');
        expect(updateSql).toContain("status = 'pending'");
        expect(updateSql).toContain("client_id =");
        expect(updateSql).toContain("branch_id =");
        expect(updateSql).toContain("date_trunc('milliseconds', clock_timestamp())");
    });

    it.each([
        {
            name: "a delayed R1 generation",
            ruleUpdatedAt: new Date("2026-07-09T00:00:00.124Z"),
            jobsStale: false,
            expectedUpdatedAt: new Date("2026-07-09T00:00:00.123Z"),
            expectedJobsStale: false,
        },
        {
            name: "a rebuilt R2 rule after worker A cleared it",
            ruleUpdatedAt: new Date("2026-07-09T00:00:00.123Z"),
            jobsStale: false,
            expectedUpdatedAt: new Date("2026-07-09T00:00:00.123Z"),
            expectedJobsStale: true,
        },
    ])("cancelPendingForRuleGeneration does not touch jobs for $name", async ({
        ruleUpdatedAt,
        jobsStale,
        expectedUpdatedAt,
        expectedJobsStale,
    }) => {
        queryRaw.mockResolvedValueOnce([{
            id: "rule-1",
            branch_id: "branch-1",
            jobs_stale: jobsStale,
            updated_at: ruleUpdatedAt,
        }]);

        await expect(repository.cancelPendingForRuleGeneration(
            "branch-1",
            "rule-1",
            expectedUpdatedAt,
            expectedJobsStale,
            "stale worker",
        )).resolves.toBeNull();

        expect(queryRaw).toHaveBeenCalledTimes(1);
    });

    it("locks a provider-rejected source and creates one action-bound retry atomically", async () => {
        const source = MessageTriggerJobEntity.reconstitute(
            "job-1",
            "branch-1",
            "rule-1",
            "failed",
            new Date("2026-07-09T01:00:00.000Z"),
            null,
            null,
            "provider rejected",
            1,
            null,
            MessageTriggerRecipientType.CLIENT,
            "01012345678",
            MessageTriggerTemplateKey.SERVICE_INFO,
            "rule-1:client:1",
            {
                memberId: "1",
                recipientName: "홍길동",
                recipientPhone: "01012345678",
                templateVariables: { retrySafety: "provider-rejected" },
            },
            new Date("2026-07-08T00:00:00.000Z"),
            new Date("2026-07-08T01:00:00.000Z"),
            1,
            null,
        );
        const retry = MessageTriggerJobEntity.create({
            branchId: "branch-1",
            ruleId: "rule-1",
            scheduledFor: now,
            clientId: 1,
            recipientType: MessageTriggerRecipientType.CLIENT,
            recipientPhone: "01012345678",
            templateKey: MessageTriggerTemplateKey.SERVICE_INFO,
            dedupeKey: "agent-sms-retry:action-1",
            payload: source.payload,
        });
        const rawSource = {
            id: source.id,
            branch_id: source.branchId,
            rule_id: source.ruleId,
            status: source.status,
            scheduled_for: source.scheduledFor,
            attempts: source.attempts,
            next_attempt_at: source.nextAttemptAt,
            sent_at: source.sentAt,
            canceled_at: source.canceledAt,
            cancel_reason: source.cancelReason,
            client_id: source.clientId,
            employee_schedule_id: source.employeeScheduleId,
            recipient_type: source.recipientType,
            recipient_phone: source.recipientPhone,
            template_key: source.templateKey,
            dedupe_key: source.dedupeKey,
            payload: source.payload,
            created_at: source.createdAt,
            updated_at: source.updatedAt,
        };
        const txJob = createMockPrismaMessageTriggerJob();
        txJob.findUnique.mockResolvedValue(null);
        txJob.create.mockResolvedValue({
            ...createRow({ id: "retry-1", status: "pending", dedupeKey: retry.dedupeKey, payload: retry.payload }),
        });
        const transaction = { $queryRaw: jest.fn().mockResolvedValue([rawSource]), message_trigger_job: txJob };
        (prisma.$transaction as jest.Mock).mockImplementationOnce(async (operation: (tx: unknown) => Promise<unknown>) => operation(transaction));

        const snapshotHash = "snapshot-hash";
        await expect(repository.claimProviderRejectedForRetry(
            "branch-1",
            source.id,
            targetVersion(source, snapshotHash),
            snapshotHash,
            source,
            retry,
        )).resolves.toEqual(expect.objectContaining({ id: "retry-1" }));
        expect(transaction.$queryRaw).toHaveBeenCalledTimes(1);
        expect(txJob.create).toHaveBeenCalledTimes(1);
    });

    it("findSentByRuleIdAndEmployeeScheduleId queries sent rows for the schedule", async () => {
        messageTriggerJobModel.findMany.mockResolvedValue([
            createRow({
                ruleId: "rule-employee",
                status: "sent",
                employeeScheduleId: 77,
            }),
        ]);

        const result = await repository.findSentByRuleIdAndEmployeeScheduleId("rule-employee", 77);

        expect(messageTriggerJobModel.findMany).toHaveBeenCalledWith({
            where: {
                ruleId: "rule-employee",
                employeeScheduleId: 77,
                status: "sent",
            },
        });
        expect(result[0]?.status).toBe("sent");
    });

    it("cancelPendingByRuleId issues one batch updateMany with reason", async () => {
        messageTriggerJobModel.updateMany.mockResolvedValue({ count: 3 });

        await expect(repository.cancelPendingByRuleId("rule-1", "rule disabled")).resolves.toBe(3);

        expect(messageTriggerJobModel.updateMany).toHaveBeenCalledWith({
            where: { ruleId: "rule-1", status: "pending" },
            data: {
                status: "canceled",
                canceledAt: now,
                cancelReason: "rule disabled",
            },
        });
    });

    it("cancelPendingByClientContext cancels client and assignment jobs in one batch", async () => {
        messageTriggerJobModel.updateMany.mockResolvedValue({ count: 2 });

        await expect(
            repository.cancelPendingByClientContext("branch-1", 42, "Client deleted"),
        ).resolves.toBe(2);

        expect(messageTriggerJobModel.updateMany).toHaveBeenCalledWith({
            where: {
                branchId: "branch-1",
                status: "pending",
                OR: [
                    { clientId: 42 },
                    { employeeSchedule: { is: { clientId: 42 } } },
                ],
            },
            data: {
                status: "canceled",
                canceledAt: now,
                cancelReason: "Client deleted",
            },
        });
    });

    it("cancelOrphanedPending cancels legacy pending jobs whose relations were deleted", async () => {
        messageTriggerJobModel.updateMany.mockResolvedValue({ count: 2 });

        await expect(
            repository.cancelOrphanedPending("Related client or schedule deleted", "branch-1"),
        ).resolves.toBe(2);

        expect(messageTriggerJobModel.updateMany).toHaveBeenCalledWith({
            where: {
                branchId: "branch-1",
                status: "pending",
                clientId: null,
                employeeScheduleId: null,
                NOT: { ruleId: { startsWith: "agent-sms:" } },
            },
            data: {
                status: "canceled",
                canceledAt: now,
                cancelReason: "Related client or schedule deleted",
            },
        });
    });

    it("findRecoverableOrphanedClientJobs returns pending and cleanup-canceled client jobs", async () => {
        messageTriggerJobModel.findMany.mockResolvedValue([]);

        await repository.findRecoverableOrphanedClientJobs("branch-1", 25);

        expect(messageTriggerJobModel.findMany).toHaveBeenCalledWith({
            where: {
                branchId: "branch-1",
                clientId: null,
                employeeScheduleId: null,
                recipientType: MessageTriggerRecipientType.CLIENT,
                NOT: { ruleId: { startsWith: "agent-sms:" } },
                OR: [
                    { status: "pending" },
                    {
                        status: "canceled",
                        cancelReason: {
                            in: ["Client deleted", "Related client or schedule deleted"],
                        },
                    },
                ],
            },
            orderBy: { createdAt: "asc" },
            take: 25,
        });
    });

    it("markOrphanedJobsReconciled records the replacement client", async () => {
        messageTriggerJobModel.updateMany.mockResolvedValue({ count: 2 });

        await expect(
            repository.markOrphanedJobsReconciled(["job-1", "job-2"], 42),
        ).resolves.toBe(2);

        expect(messageTriggerJobModel.updateMany).toHaveBeenCalledWith({
            where: {
                id: { in: ["job-1", "job-2"] },
                status: "canceled",
                clientId: null,
                employeeScheduleId: null,
            },
            data: {
                cancelReason: "Reconciled to replacement client:42",
            },
        });
    });

    it("cancelPendingOlderThan issues one batch updateMany scoped to old pending jobs", async () => {
        const cutoff = new Date("2026-07-08T00:00:00.000Z");
        messageTriggerJobModel.updateMany.mockResolvedValue({ count: 2 });

        await expect(
            repository.cancelPendingOlderThan("rule-1", cutoff, "승인 전 예정 시각 경과"),
        ).resolves.toBe(2);

        expect(messageTriggerJobModel.updateMany).toHaveBeenCalledWith({
            where: {
                ruleId: "rule-1",
                status: "pending",
                scheduledFor: { lt: cutoff },
            },
            data: {
                status: "canceled",
                canceledAt: now,
                cancelReason: "승인 전 예정 시각 경과",
            },
        });
    });

    it("findStaleProcessing queries processing rows older than cutoff", async () => {
        const cutoff = new Date("2026-07-09T00:10:00.000Z");
        messageTriggerJobModel.findMany.mockResolvedValue([createRow({
            status: "processing",
            updatedAt: new Date("2026-07-08T23:59:00.000Z"),
        })]);

        const result = await repository.findStaleProcessing(cutoff, 10);

        expect(messageTriggerJobModel.findMany).toHaveBeenCalledWith({
            where: {
                status: "processing",
                updatedAt: { lt: cutoff },
            },
            orderBy: { updatedAt: "asc" },
            take: 10,
        });
        expect(result[0]?.status).toBe("processing");
    });
});
