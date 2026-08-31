import {
    MessageTriggerRecipientType,
    MessageTriggerTemplateKey,
} from "domain/constants/message-trigger-catalog";
import {
    MESSAGE_SENDER_APPROVAL_REQUIRED_CANCEL_REASON,
    TRIGGER_JOB_CONFIG_RETRY_DELAY_MS,
    TRIGGER_JOB_MAX_ATTEMPTS,
    TRIGGER_JOB_RETRY_DELAY_MS,
} from "domain/constants/message-automation-policy";
import { MESSAGE_AUTOMATION_INTENT_RULE_ID } from "domain/constants/message-automation-intent";
import {
    SERVICE_RECORD_LINK_RULE_ID,
} from "domain/constants/service-record-link-message";
import {
    MessageTriggerJobEntity,
    MessageTriggerJobPayload,
} from "domain/entities/message-trigger-job.entity";
import { Logger } from "@nestjs/common";
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

    it("binds processing state to the immutable claim token", () => {
        const job = createJob();

        job.markProcessing("claim-a");

        expect(job.status).toBe("processing");
        expect(job.claimToken).toBe("claim-a");
    });

    it("marks a claimed job dispatching at the provider authorization boundary", () => {
        const job = createJob();
        job.markProcessing("claim-a");

        job.markDispatchAuthorized();

        expect(job.status).toBe("dispatching");
        expect(job.claimToken).toBe("claim-a");
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
        canceledByUser: boolean;
        claimToken: string | null;
    };

    const createMockPrismaMessageTriggerJob = () => ({
        create: jest.fn(),
        update: jest.fn(),
        findUnique: jest.fn(),
        findMany: jest.fn(),
        count: jest.fn(),
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
        canceledByUser: false,
        claimToken: null,
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

    it("claimPendingSystemScope returns true only when a pending row was claimed", async () => {
        messageTriggerJobModel.updateMany
            .mockResolvedValueOnce({ count: 1 })
            .mockResolvedValueOnce({ count: 0 });

        await expect(repository.claimPendingSystemScope("job-1")).resolves.toBe(true);
        await expect(repository.claimPendingSystemScope("job-1")).resolves.toBe(false);

        expect(messageTriggerJobModel.updateMany).toHaveBeenCalledWith({
            where: { id: "job-1", status: "pending" },
            data: { status: "processing", claimToken: expect.any(String) },
        });
    });

    it("claimPendingWithRuleFence locks the rule before claiming and refuses a stale rule", async () => {
        queryRaw
            .mockResolvedValueOnce([{ rule_id: "rule-1", branch_id: "branch-1" }])
            .mockResolvedValueOnce([{ id: "rule-1", jobs_stale: false }])
            .mockResolvedValueOnce([{ id: "job-1", claim_token: "claim-a" }]);

        await expect(repository.claimPendingWithRuleFence("job-1", "branch-1")).resolves.toBe("claim-a");
        expect(queryRaw).toHaveBeenCalledTimes(3);
        expect(getSqlText(queryRaw.mock.calls[1][0])).toContain('FROM "message_trigger_rule"');
        expect(getSqlText(queryRaw.mock.calls[1][0])).toContain("FOR UPDATE");
        expect(getSqlText(queryRaw.mock.calls[2][0])).toContain('UPDATE "message_trigger_job"');

        queryRaw.mockReset();
        queryRaw.mockResolvedValueOnce([{ rule_id: "rule-1", branch_id: "branch-1" }])
            .mockResolvedValueOnce([{ id: "rule-1", jobs_stale: true }]);
        await expect(repository.claimPendingWithRuleFence("job-1", "branch-1")).resolves.toBeNull();
        expect(queryRaw).toHaveBeenCalledTimes(2);
    });

    it("uses the claim token as a CAS so a stale completion cannot overwrite a newer claim", async () => {
        const staleAttempt = createJob();
        staleAttempt.claimToken = "claim-a";
        messageTriggerJobModel.updateMany.mockResolvedValue({ count: 0 });
        messageTriggerJobModel.findUnique.mockResolvedValue(createRow({
            status: "processing",
            claimToken: "claim-b",
        }));

        const result = await repository.update(staleAttempt);

        expect(messageTriggerJobModel.updateMany).toHaveBeenCalledWith({
            where: { id: staleAttempt.id, claimToken: "claim-a", branchId: "branch-1" },
            data: expect.objectContaining({ claimToken: "claim-a" }),
        });
        expect(messageTriggerJobModel.update).not.toHaveBeenCalled();
        expect(result.claimToken).toBe("claim-b");
    });

    it("claims a branch job through a global rule without widening the job branch fence", async () => {
        queryRaw
            .mockResolvedValueOnce([{
                rule_id: "system:service_record_link",
                branch_id: "branch-1",
            }])
            .mockResolvedValueOnce([{
                id: "system:service_record_link",
                jobs_stale: false,
                branch_id: null,
            }])
            .mockResolvedValueOnce([{ id: "job-1", claim_token: "claim-b" }]);

        await expect(repository.claimPendingWithRuleFence("job-1", "branch-1")).resolves.toBe("claim-b");

        const ruleFenceSql = getSqlText(queryRaw.mock.calls[1][0]);
        const jobClaimSql = getSqlText(queryRaw.mock.calls[2][0]);
        expect(ruleFenceSql).toContain("OR branch_id IS NULL");
        expect(jobClaimSql).toContain("branch_id = ");
        expect(jobClaimSql).not.toContain("OR branch_id IS NULL");
    });

    it("hasActiveJobsBefore uses updatedAt as the generation fence when a dedupe row is reactivated", async () => {
        messageTriggerJobModel.findFirst.mockResolvedValueOnce({ id: "job-1" }).mockResolvedValueOnce(null);

        await expect(repository.hasActiveJobsBefore("branch-1", "rule-1", now)).resolves.toBe(true);
        await expect(repository.hasActiveJobsBefore("branch-1", "rule-1", now)).resolves.toBe(false);
        expect(messageTriggerJobModel.findFirst).toHaveBeenCalledWith({
            where: {
                branchId: "branch-1",
                ruleId: "rule-1",
                status: { in: ["pending", "processing", "dispatching"] },
                updatedAt: { lt: now },
            },
            select: { id: true },
        });
    });

    it("findDuePendingSystemScope filters out jobs with future nextAttemptAt and includes null/past", async () => {
        messageTriggerJobModel.findMany.mockResolvedValue([]);

        await repository.findDuePendingSystemScope(25);

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

    it("findUpcomingPendingByBranch keeps future, overdue, processing, and dispatching jobs visible", async () => {
        messageTriggerJobModel.findMany.mockResolvedValue([]);

        await repository.findUpcomingPendingByBranch("branch-1", 25);

        expect(messageTriggerJobModel.findMany).toHaveBeenCalledWith({
            where: {
                branchId: "branch-1",
                status: { in: ["pending", "processing", "dispatching"] },
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
                ruleId: { not: MESSAGE_AUTOMATION_INTENT_RULE_ID },
                status: { in: ["failed", "canceled"] },
            },
            orderBy: { updatedAt: "desc" },
            take: 25,
        });
    });

    it("findRecentUndeliveredByBranch scopes to branch and the failed/canceled since-window, newest first", async () => {
        const since = new Date("2026-07-08T00:00:00.000Z");
        const until = new Date("2026-07-09T00:00:00.000Z");
        messageTriggerJobModel.findMany.mockResolvedValue([
            createRow({
                id: "job-canceled",
                status: "canceled",
                canceledAt: new Date("2026-07-08T12:00:00.000Z"),
                cancelReason: "사용자가 발송을 취소함",
                updatedAt: new Date("2026-07-08T12:00:00.000Z"),
            }),
            createRow({
                id: "job-failed",
                status: "failed",
                cancelReason: "provider rejected",
                updatedAt: new Date("2026-07-08T13:00:00.000Z"),
            }),
        ]);

        const result = await repository.findRecentUndeliveredByBranch("branch-1", since, until, 25);

        // Deliberately scoped with objectContaining (not a canceledByUser
        // guard test — see the dedicated guard test below): branch scoping,
        // the failed/canceled status split, and the per-status since-window
        // (canceledAt for canceled rows, updatedAt for failed rows, since
        // there is no dedicated failedAt column) are what this test covers.
        expect(messageTriggerJobModel.findMany).toHaveBeenCalledWith({
            where: expect.objectContaining({
                branchId: "branch-1",
                ruleId: { not: MESSAGE_AUTOMATION_INTENT_RULE_ID },
                OR: [
                    { status: "canceled", canceledAt: { gte: since, lt: until } },
                    { status: "failed", updatedAt: { gte: since, lt: until } },
                ],
            }),
            orderBy: { updatedAt: "desc" },
            take: 25,
        });
        expect(result.map((job) => job.status)).toEqual(["canceled", "failed"]);
        expect(result[0]?.cancelReason).toBe("사용자가 발송을 취소함");
        expect(result[1]?.cancelReason).toBe("provider rejected");
    });

    it("findRecentUndeliveredByBranch's guarded WHERE clause excludes a user-canceled row from the digest (canceledByUser guard)", async () => {
        const since = new Date("2026-07-08T00:00:00.000Z");
        const until = new Date("2026-07-09T00:00:00.000Z");
        messageTriggerJobModel.findMany.mockResolvedValue([]);

        await repository.findRecentUndeliveredByBranch("branch-1", since, until, 25);

        // Mutation-sensitive assertion, isolated from the shape test above:
        // a cancel the user pressed themselves must never be reported back
        // to them as a problem, so canceledByUser: false must always be
        // part of the WHERE clause. Deleting or weakening this line in the
        // implementation fails this test (and only this test — the shape
        // test above uses objectContaining and does not assert on this key).
        const [{ where }] = messageTriggerJobModel.findMany.mock.calls[0];
        expect(where.canceledByUser).toBe(false);
    });

    it("countRecentUndeliveredByBranch uses the same guarded half-open window", async () => {
        const since = new Date("2026-07-08T00:00:00.000Z");
        const until = new Date("2026-07-09T00:00:00.000Z");
        messageTriggerJobModel.count.mockResolvedValue(73);

        await expect(
            repository.countRecentUndeliveredByBranch("branch-1", since, until),
        ).resolves.toBe(73);
        expect(messageTriggerJobModel.count).toHaveBeenCalledWith({
            where: {
                branchId: "branch-1",
                ruleId: { not: MESSAGE_AUTOMATION_INTENT_RULE_ID },
                canceledByUser: false,
                OR: [
                    { status: "canceled", canceledAt: { gte: since, lt: until } },
                    { status: "failed", updatedAt: { gte: since, lt: until } },
                ],
            },
        });
    });

    it("findHistoryByBranch excludes internal intent rows before applying the history limit", async () => {
        messageTriggerJobModel.findMany.mockResolvedValue([]);

        await repository.findHistoryByBranch("branch-1", 25);

        expect(messageTriggerJobModel.findMany).toHaveBeenCalledWith({
            where: {
                branchId: "branch-1",
                ruleId: { not: MESSAGE_AUTOMATION_INTENT_RULE_ID },
            },
            orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
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
            /INSERT INTO "message_trigger_job" \([\s\S]*next_attempt_at,\s*claim_token,\s*updated_at[\s\S]*\)\s*VALUES/,
        );
        // branch_id is the ONLY uuid-cast parameter: rule_id is a text column and system rules
        // use non-uuid ids ("system:service_record_link") — casting it to uuid breaks the insert.
        expect(sqlText.match(/::uuid/g)).toHaveLength(1);
        expect(sqlText).toMatch(/0,\s*NULL,\s*NULL,\s*date_trunc\('milliseconds', clock_timestamp\(\)\)/);
        const normalizedSqlText = sqlText.replace(/\s+/g, " ");
        expect(normalizedSqlText).toContain('ON CONFLICT ("dedupe_key") DO UPDATE SET');
        expect(normalizedSqlText).toContain(
            'WHERE "message_trigger_job"."status" IN (\'pending\', \'canceled\')',
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
        expect(sqlText).toContain('WHERE "message_trigger_job"."status" IN (\'pending\', \'canceled\')');
    });

    it("does not resurrect a failed same-dedupe job after its message-log retry path takes ownership", async () => {
        queryRaw.mockResolvedValueOnce([]);
        messageTriggerJobModel.findUnique.mockResolvedValueOnce(createRow({
            status: "failed",
            attempts: 1,
            cancelReason: "provider rejected",
        }));

        const result = await repository.upsertPending(createJob());

        expect(result.status).toBe("failed");
        expect(result.attempts).toBe(1);
        const sqlText = getSqlText(queryRaw.mock.calls[0][0]).replace(/\s+/g, " ");
        expect(sqlText).toContain(
            'WHERE "message_trigger_job"."status" IN (\'pending\', \'canceled\')',
        );
    });

    it("upsertPending's guarded WHERE clause excludes a user-canceled row from resurrection (resurrection guard)", async () => {
        queryRaw.mockResolvedValueOnce([]);
        messageTriggerJobModel.findUnique.mockResolvedValueOnce(createRow({
            status: "canceled",
            canceledAt: new Date("2026-07-08T12:00:00.000Z"),
            cancelReason: "사용자가 발송을 취소함",
        }));

        const result = await repository.upsertPending(createJob());

        // The guarded UPDATE matches nothing, so the repository falls back to
        // reading the row as-is: it is still canceled, not resurrected to pending.
        expect(result.status).toBe("canceled");

        // Mutation-sensitive assertion: pins the guard's exact text so reverting or
        // weakening the clause fails this test. The rule may refresh pending rows and
        // reactivate internal cancellations, but failed rows belong exclusively to the
        // message-log retry path and must not become a second provider submission.
        const sqlText = getSqlText(queryRaw.mock.calls[0][0]).replace(/\s+/g, " ");
        expect(sqlText).toContain(
            "WHERE \"message_trigger_job\".\"status\" IN ('pending', 'canceled') "
            + "AND NOT (\"message_trigger_job\".\"status\" = 'canceled' AND \"message_trigger_job\".\"canceled_by_user\" = true)",
        );
    });

    it("promotes only an owned automatic scheduling marker to pending", async () => {
        const job = MessageTriggerJobEntity.create({
            branchId: "branch-1",
            ruleId: SERVICE_RECORD_LINK_RULE_ID,
            scheduledFor: new Date("2026-07-09T01:00:00.000Z"),
            clientId: 1,
            employeeScheduleId: 42,
            recipientType: MessageTriggerRecipientType.PRIMARY_EMPLOYEE,
            recipientPhone: "01012345678",
            templateKey: MessageTriggerTemplateKey.SERVICE_RECORD_LINK,
            dedupeKey: `${SERVICE_RECORD_LINK_RULE_ID}:schedule:42:primary`,
            payload: {
                clientId: 1,
                clientName: "김산모",
                employeeId: 7,
                employeeName: "홍제공",
                memberId: "employee:7",
                recipientName: "홍제공",
                recipientPhone: "01012345678",
                buttonUrl: "https://mobile.test/service-record/efl_token",
                messageBody: "service record link",
                templateVariables: { serviceRecordUrl: "https://mobile.test/service-record/efl_token" },
            },
        });
        queryRaw.mockResolvedValueOnce([{
            id: "claim-1",
            branch_id: "branch-1",
            rule_id: SERVICE_RECORD_LINK_RULE_ID,
            status: "pending",
            scheduled_for: job.scheduledFor,
            attempts: 0,
            next_attempt_at: null,
            sent_at: null,
            canceled_at: null,
            cancel_reason: null,
            client_id: job.clientId,
            employee_schedule_id: job.employeeScheduleId,
            recipient_type: job.recipientType,
            recipient_phone: job.recipientPhone,
            template_key: job.templateKey,
            dedupe_key: job.dedupeKey,
            payload: job.payload,
            created_at: new Date("2026-07-08T00:00:00.000Z"),
            updated_at: new Date("2026-07-09T00:00:00.123Z"),
        }]);

        const result = await repository.promoteAutomaticSchedulingClaim(
            "claim-1",
            "2026-07-09 00:00:00.123456+00",
            job,
        );

        expect(result).toMatchObject({
            id: "claim-1",
            status: "pending",
            ruleId: SERVICE_RECORD_LINK_RULE_ID,
            employeeScheduleId: 42,
        });
        const sqlText = getSqlText(queryRaw.mock.calls[0][0]).replace(/\s+/g, " ");
        expect(sqlText).toContain('UPDATE "message_trigger_job"');
        expect(sqlText).toContain("SET status = 'pending'");
        expect(sqlText).toContain("status = 'failed'");
        expect(sqlText).toContain("cancel_reason = ");
        expect(sqlText).toContain("canceled_by_user = false");
        expect(sqlText).toContain("updated_at = ");
        expect(sqlText).toContain("RETURNING *");
    });

    it("fails closed when an automatic scheduling claim version is stale", async () => {
        const job = MessageTriggerJobEntity.create({
            branchId: "branch-1",
            ruleId: SERVICE_RECORD_LINK_RULE_ID,
            scheduledFor: new Date("2026-07-09T01:00:00.000Z"),
            clientId: 1,
            employeeScheduleId: 42,
            recipientType: MessageTriggerRecipientType.PRIMARY_EMPLOYEE,
            recipientPhone: "01012345678",
            templateKey: MessageTriggerTemplateKey.SERVICE_RECORD_LINK,
            dedupeKey: `${SERVICE_RECORD_LINK_RULE_ID}:schedule:42:primary`,
            payload: {
                clientId: 1,
                clientName: "김산모",
                employeeId: 7,
                employeeName: "홍제공",
                memberId: "employee:7",
                recipientName: "홍제공",
                recipientPhone: "01012345678",
                templateVariables: {},
            },
        });
        queryRaw.mockResolvedValueOnce([]);

        await expect(repository.promoteAutomaticSchedulingClaim(
            "claim-1",
            "2026-07-09 00:00:00.123456+00",
            job,
        )).resolves.toBeNull();
        expect(messageTriggerJobModel.findUnique).not.toHaveBeenCalled();
        const sqlText = getSqlText(queryRaw.mock.calls[0][0]).replace(/\s+/g, " ");
        expect(sqlText).toContain("updated_at = ");
        expect(sqlText).toContain("dedupe_key = ");
        expect(sqlText).toContain("employee_schedule_id = ");
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

    it("preserves an existing intent-generated job while narrowly reactivating approval cancellation", async () => {
        const job = createJob();
        const expectedUpdatedAt = new Date("2026-07-09T00:00:00.123Z");
        const existingPending = createRow({
            id: "existing-job",
            dedupeKey: job.dedupeKey,
            status: "pending",
        });
        queryRaw
            .mockResolvedValueOnce([{
                id: "rule-1",
                branch_id: "branch-1",
                jobs_stale: false,
                updated_at: expectedUpdatedAt,
            }])
            .mockResolvedValueOnce([]);
        messageTriggerJobModel.findUnique.mockResolvedValue(existingPending);

        const result = await repository.upsertPendingForRuleGeneration(
            job,
            expectedUpdatedAt,
            false,
            true,
        );

        expect(result?.id).toBe("existing-job");
        expect(result?.status).toBe("pending");
        const conflictQuery = queryRaw.mock.calls[1][0] as {
            strings?: readonly string[];
            values?: readonly unknown[];
        };
        const sqlText = getSqlText(conflictQuery).replace(/\s+/g, " ");
        expect(sqlText).toContain('ON CONFLICT ("dedupe_key") DO UPDATE SET');
        expect(sqlText).toContain(
            'WHERE "message_trigger_job"."status" = \'canceled\' '
            + 'AND "message_trigger_job"."canceled_by_user" = false '
            + 'AND "message_trigger_job"."cancel_reason" =',
        );
        expect(conflictQuery.values).toContain(MESSAGE_SENDER_APPROVAL_REQUIRED_CANCEL_REASON);
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
        expect(updateSql).toContain("status IN ('pending', 'processing')");
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
            where: { ruleId: "rule-1", status: { in: ["pending", "processing"] } },
            data: {
                status: "canceled",
                canceledAt: now,
                cancelReason: "rule disabled",
                claimToken: null,
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
                status: { in: ["pending", "processing"] },
                OR: [
                    { clientId: 42 },
                    { employeeSchedule: { is: { clientId: 42 } } },
                ],
            },
            data: {
                status: "canceled",
                canceledAt: now,
                cancelReason: "Client deleted",
                claimToken: null,
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
                status: { in: ["pending", "processing"] },
                clientId: null,
                employeeScheduleId: null,
                NOT: { ruleId: { startsWith: "agent-sms:" } },
            },
            data: {
                status: "canceled",
                canceledAt: now,
                cancelReason: "Related client or schedule deleted",
                claimToken: null,
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
                status: { in: ["pending", "processing"] },
                scheduledFor: { lt: cutoff },
            },
            data: {
                status: "canceled",
                canceledAt: now,
                cancelReason: "승인 전 예정 시각 경과",
                claimToken: null,
            },
        });
    });

    it("cancelPendingByUser conditionally cancels a job scoped to id, branch, and pending status", async () => {
        messageTriggerJobModel.updateMany
            .mockResolvedValueOnce({ count: 1 })
            .mockResolvedValueOnce({ count: 0 });

        await expect(
            repository.cancelPendingByUser("job-1", "branch-1", "사용자가 발송을 취소함"),
        ).resolves.toBe(true);
        // A second call simulates the job no longer being pending (already sent,
        // currently processing, or already canceled) or belonging to another
        // branch: the conditional where clause matches nothing, so the method
        // reports failure instead of pretending success.
        await expect(
            repository.cancelPendingByUser("job-1", "branch-1", "사용자가 발송을 취소함"),
        ).resolves.toBe(false);

        expect(messageTriggerJobModel.updateMany).toHaveBeenCalledWith({
            where: { id: "job-1", branchId: "branch-1", status: { in: ["pending", "processing"] } },
            data: {
                status: "canceled",
                canceledAt: now,
                cancelReason: "사용자가 발송을 취소함",
                canceledByUser: true,
                nextAttemptAt: null,
                claimToken: null,
            },
        });
    });

    it("findStaleProcessingSystemScope queries processing and dispatching rows older than cutoff", async () => {
        const cutoff = new Date("2026-07-09T00:10:00.000Z");
        messageTriggerJobModel.findMany.mockResolvedValue([
            createRow({
                status: "processing",
                updatedAt: new Date("2026-07-08T23:59:00.000Z"),
            }),
            createRow({
                id: "job-dispatching",
                status: "dispatching",
                updatedAt: new Date("2026-07-08T23:58:00.000Z"),
            }),
        ]);

        const result = await repository.findStaleProcessingSystemScope(cutoff, 10);

        expect(messageTriggerJobModel.findMany).toHaveBeenCalledWith({
            where: {
                status: { in: ["processing", "dispatching"] },
                updatedAt: { lt: cutoff },
            },
            orderBy: { updatedAt: "asc" },
            take: 10,
        });
        expect(result.map((job) => job.status)).toEqual(["processing", "dispatching"]);
    });

    it("findByIdInBranch returns null when the id and branch do not both match", async () => {
        messageTriggerJobModel.findFirst.mockResolvedValueOnce(null);

        await expect(repository.findByIdInBranch("branch-1", "job-1")).resolves.toBeNull();

        expect(messageTriggerJobModel.findFirst).toHaveBeenCalledWith({
            where: { id: "job-1", branchId: "branch-1" },
        });
    });

    it("findByIdInBranch resolves the row when the id and branch both match", async () => {
        messageTriggerJobModel.findFirst.mockResolvedValueOnce(createRow());

        const result = await repository.findByIdInBranch("branch-1", "job-1");

        expect(result?.id).toBe("job-1");
        expect(result?.branchId).toBe("branch-1");
    });

    it("update pins branchId into the claim-token updateMany where clause", async () => {
        const job = createJob();
        job.claimToken = "claim-a";
        messageTriggerJobModel.updateMany.mockResolvedValue({ count: 1 });
        messageTriggerJobModel.findUnique.mockResolvedValue(createRow({ claimToken: "claim-a" }));

        await repository.update(job);

        expect(messageTriggerJobModel.updateMany).toHaveBeenCalledWith({
            where: { id: job.id, claimToken: "claim-a", branchId: "branch-1" },
            data: expect.any(Object),
        });
        expect(messageTriggerJobModel.findUnique).toHaveBeenCalledWith({
            where: { id: job.id, branchId: "branch-1" },
        });
    });

    it("update pins branchId into the plain update where clause when there is no claim token", async () => {
        const job = createJob();
        messageTriggerJobModel.update.mockResolvedValue(createRow());

        await repository.update(job);

        expect(messageTriggerJobModel.update).toHaveBeenCalledWith({
            where: { id: job.id, branchId: "branch-1" },
            data: expect.any(Object),
        });
    });

    it("update falls back to an id-only where and warns when the job has no branch", async () => {
        const warnSpy = jest.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
        const job = createJob();
        job.branchId = null;
        messageTriggerJobModel.update.mockResolvedValue(createRow({ branchId: null }));

        await repository.update(job);

        expect(messageTriggerJobModel.update).toHaveBeenCalledWith({
            where: { id: job.id },
            data: expect.any(Object),
        });
        expect(warnSpy).toHaveBeenCalledWith(
            expect.stringContaining("message_trigger_job_null_branch_write"),
        );
        warnSpy.mockRestore();
    });
});
