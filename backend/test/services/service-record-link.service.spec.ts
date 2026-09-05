import { BadRequestException, NotFoundException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { ServiceRecordLinkService } from "application/services/service-record-link.service";
import {
    SERVICE_RECORD_LINK_BRANCH_DISABLED_REASON,
    SERVICE_RECORD_LINK_RULE_ID,
    SERVICE_RECORD_LINK_SMS_LOG_TEMPLATE_KEY,
    SERVICE_RECORD_LINK_SMS_TITLE,
} from "domain/constants/service-record-link-message";
import {
    MessageTriggerEventType,
    MessageTriggerOffsetType,
    MessageTriggerRecipientType,
    MessageTriggerTemplateKey,
} from "domain/constants/message-trigger-catalog";
import { MessageLogEntity } from "domain/entities/message-log.entity";
import { MessageTriggerJobEntity } from "domain/entities/message-trigger-job.entity";
import { IMessageLogRepository } from "domain/repositories/message-log.repository.interface";
import { IMessageTriggerJobRepository } from "domain/repositories/message-trigger-job.repository.interface";
import { IMessageTriggerRuleBranchOverrideRepository } from "domain/repositories/message-trigger-rule-branch-override.repository.interface";
import { PrismaService } from "infrastructure/database/prisma.service";

describe("ServiceRecordLinkService", () => {
    const createPrisma = () => {
        const prisma = {
            $executeRaw: jest.fn().mockResolvedValue(1),
            $queryRaw: jest.fn().mockResolvedValue([{
                id: "claim-1",
                claim_version: "2026-07-09 00:00:00.123456+00",
            }]),
            $transaction: jest.fn(),
            employee_schedule: {
                findUnique: jest.fn(),
            },
            message_trigger_job: {
                updateMany: jest.fn().mockResolvedValue({ count: 0 }),
            },
            message_trigger_rule: {
                upsert: jest.fn().mockResolvedValue(undefined),
                findUnique: jest.fn().mockResolvedValue({ isActive: true }),
            },
            system_template: {
                findUnique: jest.fn().mockResolvedValue({ customVariables: [] }),
            },
        };
        prisma.$transaction.mockImplementation(async (work: (transaction: typeof prisma) => unknown) => (
            work(prisma)
        ));
        return prisma;
    };
    const createTokenService = () => ({
        issueLink: jest.fn().mockResolvedValue({ linkToken: "efl_token" }),
        reuseActiveLink: jest.fn().mockResolvedValue(null),
        prepareLink: jest.fn().mockResolvedValue({ linkToken: "efl_prepared" }),
        activatePreparedLink: jest.fn().mockResolvedValue(true),
        revokeForSchedule: jest.fn().mockResolvedValue(undefined),
        extendExpiryForSchedule: jest.fn().mockResolvedValue(undefined),
    });
    const createConfigService = () => ({
        get: jest.fn((key: string, fallback?: string) => (
            key === "MOBILE_SERVICE_RECORD_BASE_URL" ? "https://mobile.test/" : fallback
        )),
    });
    const createJobRepository = () => ({
        findPendingByRuleIdsAndEmployeeScheduleId: jest.fn().mockResolvedValue([]),
        update: jest.fn(),
        promoteAutomaticSchedulingClaim: jest.fn().mockImplementation(async (
            _markerId: string,
            _expectedClaimVersion: string,
            job: MessageTriggerJobEntity,
        ) => {
            Object.defineProperty(job, "id", { value: "job-1" });
            return job;
        }),
        upsertPending: jest.fn().mockImplementation(async (job: MessageTriggerJobEntity) => {
            Object.defineProperty(job, "id", { value: "job-1" });
            return job;
        }),
    });
    const createLogRepository = () => ({
        save: jest.fn().mockImplementation(async (log: MessageLogEntity) => log),
        update: jest.fn().mockImplementation(async (log: MessageLogEntity) => log),
        findRetryableServiceRecordSmsByScheduleId: jest.fn().mockResolvedValue([]),
    });
    /** Default: no branch override present, matching pre-feature behaviour (global rule always governs). */
    const createOverrideRepository = () => ({
        findOne: jest.fn().mockResolvedValue(null),
        findAllByBranch: jest.fn().mockResolvedValue([]),
        upsert: jest.fn().mockImplementation(async (branchId: string, ruleId: string, isActive: boolean) => (
            { branchId, ruleId, isActive }
        )),
        cancelJobsForBranchRule: jest.fn().mockResolvedValue(undefined),
    });
    const createSchedule = (overrides: Record<string, unknown> = {}) => ({
        id: 10,
        branchId: "branch-1",
        clientId: 20,
        startDate: new Date("2026-07-03T00:00:00.000Z"),
        endDate: new Date("2026-07-12T00:00:00.000Z"),
        replaced: false,
        primaryEmployee: {
            id: 30,
            name: "홍제공",
            phone: "010-1111-2222",
            birthday: "900101",
        },
        client: {
            id: 20,
            name: "김산모",
        },
        ...overrides,
    });

    it("issues a token that expires 7 days after end-date at 20:00 KST and schedules SMS for start-date 15:00 KST", async () => {
        const prisma = createPrisma();
        const tokenService = createTokenService();
        const jobRepository = createJobRepository();
        const service = new ServiceRecordLinkService(
            prisma as unknown as PrismaService,
            tokenService as never,
            createConfigService() as unknown as ConfigService,
            jobRepository as unknown as IMessageTriggerJobRepository,
            createLogRepository() as unknown as IMessageLogRepository,
            createOverrideRepository() as unknown as IMessageTriggerRuleBranchOverrideRepository,
        );
        prisma.employee_schedule.findUnique.mockResolvedValue(createSchedule());

        await service.scheduleForServiceStart(10);

        expect(tokenService.issueLink).toHaveBeenCalledWith({
            branchId: "branch-1",
            scheduleId: 10,
            employeeId: 30,
            expectedPhone: "010-1111-2222",
            expiresAt: new Date("2026-07-19T11:00:00.000Z"),
        });
        const job = jobRepository.promoteAutomaticSchedulingClaim.mock.calls[0]?.[2] as MessageTriggerJobEntity;
        expect(job.ruleId).toBe(SERVICE_RECORD_LINK_RULE_ID);
        expect(job.dedupeKey).toBe(`${SERVICE_RECORD_LINK_RULE_ID}:schedule:10:primary`);
        expect(job.templateKey).toBe(MessageTriggerTemplateKey.SERVICE_RECORD_LINK);
        expect(job.recipientType).toBe(MessageTriggerRecipientType.PRIMARY_EMPLOYEE);
        expect(job.scheduledFor).toEqual(new Date("2026-07-03T15:00:00+09:00"));
        expect(job.payload.messageBody).toContain("https://mobile.test/service-record/efl_token");
        expect(job.payload.messageBody).toContain("휴대폰 번호로 본인확인");
        expect(job.payload.templateVariables).toEqual(expect.objectContaining({
            clientName: "김산모",
            employeeName: "홍제공",
            serviceRecordUrl: "https://mobile.test/service-record/efl_token",
        }));
    });

    it("sendNow grants a 24-hour late token and upserts an immediate pending job", async () => {
        const prisma = createPrisma();
        const tokenService = createTokenService();
        const jobRepository = createJobRepository();
        const service = new ServiceRecordLinkService(
            prisma as unknown as PrismaService,
            tokenService as never,
            createConfigService() as unknown as ConfigService,
            jobRepository as unknown as IMessageTriggerJobRepository,
            createLogRepository() as unknown as IMessageLogRepository,
            createOverrideRepository() as unknown as IMessageTriggerRuleBranchOverrideRepository,
        );
        prisma.employee_schedule.findUnique.mockResolvedValue(createSchedule());

        const before = Date.now();
        const result = await service.sendNow(10);
        const after = Date.now();

        expect(tokenService.reuseActiveLink).toHaveBeenCalledWith(expect.objectContaining({
            branchId: "branch-1",
            scheduleId: 10,
            employeeId: 30,
            expectedPhone: "010-1111-2222",
        }));
        const issuedExpiry = tokenService.issueLink.mock.calls[0]?.[0].expiresAt as Date;
        expect(issuedExpiry.getTime()).toBeGreaterThanOrEqual(before + 24 * 60 * 60 * 1000);
        expect(issuedExpiry.getTime()).toBeLessThanOrEqual(after + 24 * 60 * 60 * 1000);
        const job = jobRepository.upsertPending.mock.calls[0]?.[0] as MessageTriggerJobEntity;
        expect(job.scheduledFor.getTime()).toBeGreaterThanOrEqual(before);
        expect(job.scheduledFor.getTime()).toBeLessThanOrEqual(after);
        expect(result.scheduledFor).toBe(job.scheduledFor);
        expect(result.jobId).toBe("job-1");
        expect(job.dedupeKey).toMatch(
            new RegExp(`^${SERVICE_RECORD_LINK_RULE_ID}:schedule:10:primary:manual:[0-9a-f-]{36}$`),
        );
        expect(job.payload.buttonUrl).toBe("https://mobile.test/service-record/efl_token");
    });

    it("sendNow reuses the active URL while creating a unique UUID dedupe key for each message", async () => {
        const prisma = createPrisma();
        const tokenService = createTokenService();
        tokenService.reuseActiveLink.mockResolvedValue({ linkToken: "efl_existing" });
        const jobRepository = createJobRepository();
        const service = new ServiceRecordLinkService(
            prisma as unknown as PrismaService,
            tokenService as never,
            createConfigService() as unknown as ConfigService,
            jobRepository as unknown as IMessageTriggerJobRepository,
            createLogRepository() as unknown as IMessageLogRepository,
            createOverrideRepository() as unknown as IMessageTriggerRuleBranchOverrideRepository,
        );
        prisma.employee_schedule.findUnique.mockResolvedValue(createSchedule());

        await service.sendNow(10);
        await service.sendNow(10);

        const firstJob = jobRepository.upsertPending.mock.calls[0]?.[0] as MessageTriggerJobEntity;
        const secondJob = jobRepository.upsertPending.mock.calls[1]?.[0] as MessageTriggerJobEntity;
        expect(firstJob.dedupeKey).not.toBe(secondJob.dedupeKey);
        expect(firstJob.dedupeKey).toMatch(
            new RegExp(`^${SERVICE_RECORD_LINK_RULE_ID}:schedule:10:primary:manual:[0-9a-f-]{36}$`),
        );
        expect(firstJob.dedupeKey).not.toContain("efl_existing");
        expect(secondJob.dedupeKey).not.toContain("efl_existing");
        expect(firstJob.payload.buttonUrl).toBe("https://mobile.test/service-record/efl_existing");
        expect(secondJob.payload.buttonUrl).toBe("https://mobile.test/service-record/efl_existing");
        expect(tokenService.issueLink).not.toHaveBeenCalled();
    });

    it("prepares an inactive exact URL for a manually overridden verification phone", async () => {
        const prisma = createPrisma();
        const tokenService = createTokenService();
        const jobRepository = createJobRepository();
        const logRepository = createLogRepository();
        const service = new ServiceRecordLinkService(
            prisma as unknown as PrismaService,
            tokenService as never,
            createConfigService() as unknown as ConfigService,
            jobRepository as unknown as IMessageTriggerJobRepository,
            logRepository as unknown as IMessageLogRepository,
            createOverrideRepository() as unknown as IMessageTriggerRuleBranchOverrideRepository,
        );
        prisma.employee_schedule.findUnique.mockResolvedValue(createSchedule());

        const result = await service.prepareLink(10, "010-6621-1878");

        expect(tokenService.reuseActiveLink).toHaveBeenCalledWith(expect.objectContaining({
            branchId: "branch-1",
            scheduleId: 10,
            employeeId: 30,
            expectedPhone: "01066211878",
        }), { includeLocked: false });
        expect(tokenService.prepareLink).toHaveBeenCalledWith(expect.objectContaining({
            branchId: "branch-1",
            scheduleId: 10,
            employeeId: 30,
            expectedPhone: "01066211878",
        }));
        expect(result).toEqual({
            serviceRecordUrl: "https://mobile.test/service-record/efl_prepared",
            preparedLinkToken: "efl_prepared",
            expiresAt: expect.any(Date),
        });
        expect(prisma.message_trigger_rule.upsert).not.toHaveBeenCalled();
        expect(jobRepository.findPendingByRuleIdsAndEmployeeScheduleId).not.toHaveBeenCalled();
        expect(jobRepository.upsertPending).not.toHaveBeenCalled();
        expect(logRepository.findRetryableServiceRecordSmsByScheduleId).not.toHaveBeenCalled();
    });

    it("prepareLink returns the current active URL instead of preparing a replacement token", async () => {
        const prisma = createPrisma();
        const tokenService = createTokenService();
        tokenService.reuseActiveLink.mockResolvedValue({ linkToken: "efl_existing" });
        const service = new ServiceRecordLinkService(
            prisma as unknown as PrismaService,
            tokenService as never,
            createConfigService() as unknown as ConfigService,
            createJobRepository() as unknown as IMessageTriggerJobRepository,
            createLogRepository() as unknown as IMessageLogRepository,
            createOverrideRepository() as unknown as IMessageTriggerRuleBranchOverrideRepository,
        );
        prisma.employee_schedule.findUnique.mockResolvedValue(createSchedule());

        await expect(service.prepareLink(10)).resolves.toEqual({
            serviceRecordUrl: "https://mobile.test/service-record/efl_existing",
            preparedLinkToken: "efl_existing",
            expiresAt: expect.any(Date),
        });
        expect(tokenService.prepareLink).not.toHaveBeenCalled();
    });

    it("resetLink issues a fresh active URL without enqueueing an SMS", async () => {
        const prisma = createPrisma();
        const tokenService = createTokenService();
        const jobRepository = createJobRepository();
        const logRepository = createLogRepository();
        const service = new ServiceRecordLinkService(
            prisma as unknown as PrismaService,
            tokenService as never,
            createConfigService() as unknown as ConfigService,
            jobRepository as unknown as IMessageTriggerJobRepository,
            logRepository as unknown as IMessageLogRepository,
            createOverrideRepository() as unknown as IMessageTriggerRuleBranchOverrideRepository,
        );
        prisma.employee_schedule.findUnique.mockResolvedValue(createSchedule());

        await expect(service.resetLink(10)).resolves.toEqual({
            serviceRecordUrl: "https://mobile.test/service-record/efl_token",
            expiresAt: expect.any(Date),
        });

        expect(tokenService.issueLink).toHaveBeenCalledWith(expect.objectContaining({
            branchId: "branch-1",
            scheduleId: 10,
            employeeId: 30,
            expectedPhone: "010-1111-2222",
        }));
        expect(tokenService.reuseActiveLink).not.toHaveBeenCalled();
        expect(tokenService.prepareLink).not.toHaveBeenCalled();
        expect(tokenService.activatePreparedLink).not.toHaveBeenCalled();
        expect(prisma.message_trigger_rule.upsert).not.toHaveBeenCalled();
        expect(jobRepository.findPendingByRuleIdsAndEmployeeScheduleId).toHaveBeenCalledWith(
            [SERVICE_RECORD_LINK_RULE_ID],
            10,
        );
        expect(logRepository.findRetryableServiceRecordSmsByScheduleId).toHaveBeenCalledWith(10);
        expect(jobRepository.upsertPending).not.toHaveBeenCalled();
    });

    it("sendNow uses a manual phone override for both link verification and SMS delivery", async () => {
        const prisma = createPrisma();
        const tokenService = createTokenService();
        const jobRepository = createJobRepository();
        const service = new ServiceRecordLinkService(
            prisma as unknown as PrismaService,
            tokenService as never,
            createConfigService() as unknown as ConfigService,
            jobRepository as unknown as IMessageTriggerJobRepository,
            createLogRepository() as unknown as IMessageLogRepository,
            createOverrideRepository() as unknown as IMessageTriggerRuleBranchOverrideRepository,
        );
        prisma.employee_schedule.findUnique.mockResolvedValue(createSchedule());

        await service.sendNow(10, "efl_prepared", "01066211878");

        expect(tokenService.activatePreparedLink).toHaveBeenCalledWith(expect.objectContaining({
            linkToken: "efl_prepared",
            branchId: "branch-1",
            scheduleId: 10,
            employeeId: 30,
            expectedPhone: "01066211878",
        }));
        expect(tokenService.issueLink).not.toHaveBeenCalled();
        const job = jobRepository.upsertPending.mock.calls[0]?.[0] as MessageTriggerJobEntity;
        expect(job.recipientPhone).toBe("01066211878");
        expect(job.payload.recipientPhone).toBe("01066211878");
        expect(job.payload.buttonUrl).toBe("https://mobile.test/service-record/efl_prepared");
        expect(job.payload.messageBody).toContain("https://mobile.test/service-record/efl_prepared");
    });

    it("rejects an expired or mismatched prepared link instead of silently minting another URL", async () => {
        const prisma = createPrisma();
        const tokenService = createTokenService();
        tokenService.activatePreparedLink.mockResolvedValue(false);
        const jobRepository = createJobRepository();
        const logRepository = createLogRepository();
        const service = new ServiceRecordLinkService(
            prisma as unknown as PrismaService,
            tokenService as never,
            createConfigService() as unknown as ConfigService,
            jobRepository as unknown as IMessageTriggerJobRepository,
            logRepository as unknown as IMessageLogRepository,
            createOverrideRepository() as unknown as IMessageTriggerRuleBranchOverrideRepository,
        );
        prisma.employee_schedule.findUnique.mockResolvedValue(createSchedule());

        await expect(service.sendNow(10, "efl_invalid")).rejects.toBeInstanceOf(BadRequestException);
        expect(tokenService.issueLink).not.toHaveBeenCalled();
        expect(jobRepository.findPendingByRuleIdsAndEmployeeScheduleId).not.toHaveBeenCalled();
        expect(jobRepository.update).not.toHaveBeenCalled();
        expect(jobRepository.upsertPending).not.toHaveBeenCalled();
        expect(logRepository.findRetryableServiceRecordSmsByScheduleId).not.toHaveBeenCalled();
        expect(logRepository.update).not.toHaveBeenCalled();
    });

    it("provisions the fixed system rule before issuing a service-record token", async () => {
        const prisma = createPrisma();
        const tokenService = createTokenService();
        const service = new ServiceRecordLinkService(
            prisma as unknown as PrismaService,
            tokenService as never,
            createConfigService() as unknown as ConfigService,
            createJobRepository() as unknown as IMessageTriggerJobRepository,
            createLogRepository() as unknown as IMessageLogRepository,
            createOverrideRepository() as unknown as IMessageTriggerRuleBranchOverrideRepository,
        );
        prisma.employee_schedule.findUnique.mockResolvedValue(createSchedule());

        await service.sendNow(10);

        expect(prisma.$transaction).toHaveBeenCalledTimes(1);
        expect(prisma.$executeRaw).toHaveBeenCalledTimes(1);
        expect(prisma.system_template.findUnique).toHaveBeenCalledWith({
            where: { templateKey: "SERVICE_RECORD_LINK" },
            select: { customVariables: true },
        });
        expect(prisma.message_trigger_rule.upsert).toHaveBeenCalledWith({
            where: { id: SERVICE_RECORD_LINK_RULE_ID },
            create: {
                id: SERVICE_RECORD_LINK_RULE_ID,
                branchId: null,
                name: SERVICE_RECORD_LINK_SMS_TITLE,
                isActive: true,
                eventType: MessageTriggerEventType.SERVICE_START,
                offsetType: MessageTriggerOffsetType.SAME_DAY,
                offsetDays: 0,
                recipientType: MessageTriggerRecipientType.PRIMARY_EMPLOYEE,
                templateKey: MessageTriggerTemplateKey.SERVICE_RECORD_LINK,
                isDefault: false,
                jobsStale: false,
            },
            update: {},
        });
        expect(prisma.message_trigger_rule.upsert.mock.invocationCallOrder[0]).toBeLessThan(
            tokenService.issueLink.mock.invocationCallOrder[0]!,
        );
    });

    it("refuses to activate the fixed rule when a required template variable has no automatic source", async () => {
        const prisma = createPrisma();
        const tokenService = createTokenService();
        const jobRepository = createJobRepository();
        prisma.system_template.findUnique.mockResolvedValue({
            customVariables: [
                { key: "reservationCode", label: "예약번호", required: true },
            ],
        });
        const service = new ServiceRecordLinkService(
            prisma as unknown as PrismaService,
            tokenService as never,
            createConfigService() as unknown as ConfigService,
            jobRepository as unknown as IMessageTriggerJobRepository,
            createLogRepository() as unknown as IMessageLogRepository,
            createOverrideRepository() as unknown as IMessageTriggerRuleBranchOverrideRepository,
        );
        prisma.employee_schedule.findUnique.mockResolvedValue(createSchedule());

        await expect(service.sendNow(10)).rejects.toMatchObject({
            response: {
                unsupportedVariables: ["reservationCode"],
            },
        });

        expect(prisma.$executeRaw).toHaveBeenCalledTimes(1);
        expect(prisma.message_trigger_rule.upsert).not.toHaveBeenCalled();
        expect(tokenService.reuseActiveLink).not.toHaveBeenCalled();
        expect(tokenService.issueLink).not.toHaveBeenCalled();
        expect(jobRepository.upsertPending).not.toHaveBeenCalled();
    });

    it("claims the durable automatic retry marker before issuing a token", async () => {
        const prisma = createPrisma();
        const tokenService = createTokenService();
        const service = new ServiceRecordLinkService(
            prisma as unknown as PrismaService,
            tokenService as never,
            createConfigService() as unknown as ConfigService,
            createJobRepository() as unknown as IMessageTriggerJobRepository,
            createLogRepository() as unknown as IMessageLogRepository,
            createOverrideRepository() as unknown as IMessageTriggerRuleBranchOverrideRepository,
        );
        prisma.employee_schedule.findUnique.mockResolvedValue(createSchedule());

        await expect(service.scheduleForServiceStart(10)).resolves.toBe(true);

        expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
        expect(prisma.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
            tokenService.issueLink.mock.invocationCallOrder[0]!,
        );
        const sql = prisma.$queryRaw.mock.calls[0]?.[0] as { strings: readonly string[] };
        expect(sql.strings.join("?")).toContain('ON CONFLICT ("dedupe_key") DO UPDATE');
        expect(sql.strings.join("?")).toContain("WHERE NOT EXISTS");
        expect(sql.strings.join("?")).toContain("RETURNING id, updated_at::text AS claim_version");
        expect(sql.strings.join("?")).toContain("blocker.\"status\" IN ('pending', 'processing', 'dispatching', 'sent')");
        expect(sql.strings.join("?")).toContain('"canceled_by_user" = false');
    });

    it("promotes the owned automatic marker instead of generic failed-row upsert", async () => {
        const prisma = createPrisma();
        const tokenService = createTokenService();
        const jobRepository = createJobRepository();
        const service = new ServiceRecordLinkService(
            prisma as unknown as PrismaService,
            tokenService as never,
            createConfigService() as unknown as ConfigService,
            jobRepository as unknown as IMessageTriggerJobRepository,
            createLogRepository() as unknown as IMessageLogRepository,
            createOverrideRepository() as unknown as IMessageTriggerRuleBranchOverrideRepository,
        );
        prisma.employee_schedule.findUnique.mockResolvedValue(createSchedule());

        await expect(service.scheduleForServiceStart(10)).resolves.toBe(true);

        expect(jobRepository.promoteAutomaticSchedulingClaim).toHaveBeenCalledWith(
            "claim-1",
            "2026-07-09 00:00:00.123456+00",
            expect.objectContaining({
                status: "pending",
                ruleId: SERVICE_RECORD_LINK_RULE_ID,
                employeeScheduleId: 10,
            }),
        );
        expect(jobRepository.upsertPending).not.toHaveBeenCalled();
    });

    it("fails closed when the automatic marker is lost before promotion", async () => {
        const prisma = createPrisma();
        const tokenService = createTokenService();
        const jobRepository = createJobRepository();
        jobRepository.promoteAutomaticSchedulingClaim.mockResolvedValue(null);
        const service = new ServiceRecordLinkService(
            prisma as unknown as PrismaService,
            tokenService as never,
            createConfigService() as unknown as ConfigService,
            jobRepository as unknown as IMessageTriggerJobRepository,
            createLogRepository() as unknown as IMessageLogRepository,
            createOverrideRepository() as unknown as IMessageTriggerRuleBranchOverrideRepository,
        );
        prisma.employee_schedule.findUnique.mockResolvedValue(createSchedule());

        await expect(service.scheduleForServiceStart(10)).resolves.toBe(false);

        expect(tokenService.issueLink).toHaveBeenCalled();
        expect(jobRepository.promoteAutomaticSchedulingClaim).toHaveBeenCalledTimes(1);
        expect(jobRepository.upsertPending).not.toHaveBeenCalled();
        expect(prisma.message_trigger_job.updateMany).not.toHaveBeenCalled();
    });

    it("does not issue another token when another instance owns the automatic claim", async () => {
        const prisma = createPrisma();
        prisma.$queryRaw.mockResolvedValue([]);
        const tokenService = createTokenService();
        const jobRepository = createJobRepository();
        const service = new ServiceRecordLinkService(
            prisma as unknown as PrismaService,
            tokenService as never,
            createConfigService() as unknown as ConfigService,
            jobRepository as unknown as IMessageTriggerJobRepository,
            createLogRepository() as unknown as IMessageLogRepository,
            createOverrideRepository() as unknown as IMessageTriggerRuleBranchOverrideRepository,
        );
        prisma.employee_schedule.findUnique.mockResolvedValue(createSchedule());

        await expect(service.scheduleForServiceStart(10)).resolves.toBe(false);

        expect(tokenService.reuseActiveLink).not.toHaveBeenCalled();
        expect(tokenService.issueLink).not.toHaveBeenCalled();
        expect(jobRepository.upsertPending).not.toHaveBeenCalled();
        expect(prisma.message_trigger_job.updateMany).not.toHaveBeenCalled();
    });

    it("backs off the retry marker when automatic token issuance fails", async () => {
        const prisma = createPrisma();
        const tokenService = createTokenService();
        const jobRepository = createJobRepository();
        tokenService.issueLink.mockRejectedValue(new Error("token unavailable"));
        const service = new ServiceRecordLinkService(
            prisma as unknown as PrismaService,
            tokenService as never,
            createConfigService() as unknown as ConfigService,
            jobRepository as unknown as IMessageTriggerJobRepository,
            createLogRepository() as unknown as IMessageLogRepository,
            createOverrideRepository() as unknown as IMessageTriggerRuleBranchOverrideRepository,
        );
        prisma.employee_schedule.findUnique.mockResolvedValue(createSchedule());
        await expect(service.scheduleForServiceStart(10)).rejects.toThrow("token unavailable");

        expect(jobRepository.promoteAutomaticSchedulingClaim).not.toHaveBeenCalled();
        expect(jobRepository.upsertPending).not.toHaveBeenCalled();
        expect(prisma.message_trigger_job.updateMany).not.toHaveBeenCalled();
        const releaseSql = prisma.$executeRaw.mock.calls
            .map((call: unknown[]) => call[0] as { strings?: readonly string[] })
            .find((sql) => sql.strings?.join("?").includes("next_attempt_at"));
        expect(releaseSql).toBeDefined();
        expect(releaseSql?.strings?.join("?")).toContain('UPDATE "message_trigger_job"');
        expect(releaseSql?.strings?.join("?")).toContain("next_attempt_at");
        expect(releaseSql?.strings?.join("?")).toContain("interval '1 millisecond'");
        expect(releaseSql?.strings?.join("?")).toContain("updated_at = ?::timestamptz");
        expect(releaseSql?.strings?.join("?")).toContain("canceled_by_user = false");
    });

    it("supersedes retryable stale SMS logs before issuing a replacement token", async () => {
        const prisma = createPrisma();
        const tokenService = createTokenService();
        const logRepository = createLogRepository();
        const staleLog = MessageLogEntity.reconstitute(
            77,
            "branch-1",
            "aligo_sms",
            SERVICE_RECORD_LINK_SMS_LOG_TEMPLATE_KEY,
            "job-1",
            "01011112222",
            20,
            "old link",
            {},
            "failed",
            null,
            "temporary failure",
            1,
            new Date("2026-07-03T06:00:00.000Z"),
            new Date("2026-07-03T06:05:00.000Z"),
            new Date("2026-07-03T06:00:00.000Z"),
            new Date("2026-07-03T06:00:00.000Z"),
        );
        logRepository.findRetryableServiceRecordSmsByScheduleId.mockResolvedValue([staleLog]);
        const service = new ServiceRecordLinkService(
            prisma as unknown as PrismaService,
            tokenService as never,
            createConfigService() as unknown as ConfigService,
            createJobRepository() as unknown as IMessageTriggerJobRepository,
            logRepository as unknown as IMessageLogRepository,
            createOverrideRepository() as unknown as IMessageTriggerRuleBranchOverrideRepository,
        );
        prisma.employee_schedule.findUnique.mockResolvedValue(createSchedule());

        await service.sendNow(10);

        expect(logRepository.findRetryableServiceRecordSmsByScheduleId).toHaveBeenCalledWith(10);
        expect(staleLog.nextRetryAt).toBeNull();
        expect(staleLog.errorMessage).toBe("Service record link rescheduled");
        expect(logRepository.update).toHaveBeenCalledWith(staleLog);
        expect(logRepository.update.mock.invocationCallOrder[0]).toBeLessThan(
            tokenService.issueLink.mock.invocationCallOrder[0]!,
        );
    });

    it("records a failed history row when provider phone is missing", async () => {
        const prisma = createPrisma();
        const logRepository = createLogRepository();
        const jobRepository = createJobRepository();
        const service = new ServiceRecordLinkService(
            prisma as unknown as PrismaService,
            createTokenService() as never,
            createConfigService() as unknown as ConfigService,
            jobRepository as unknown as IMessageTriggerJobRepository,
            logRepository as unknown as IMessageLogRepository,
            createOverrideRepository() as unknown as IMessageTriggerRuleBranchOverrideRepository,
        );
        prisma.employee_schedule.findUnique.mockResolvedValue(createSchedule({
            primaryEmployee: {
                id: 30,
                name: "홍제공",
                phone: "",
                birthday: "900101",
            },
        }));

        await service.scheduleForServiceStart(10);

        expect(jobRepository.upsertPending).not.toHaveBeenCalled();
        const savedLog = logRepository.save.mock.calls[0]?.[0] as MessageLogEntity;
        expect(savedLog.templateKey).toBe(SERVICE_RECORD_LINK_SMS_LOG_TEMPLATE_KEY);
        expect(savedLog.status).toBe("failed");
        expect(savedLog.nextRetryAt).toBeNull();
        expect(savedLog.errorMessage).toBe("제공인력 전화번호 누락");
    });

    it("sendNow throws and does not write a permanent failure log when provider phone is missing", async () => {
        const prisma = createPrisma();
        const logRepository = createLogRepository();
        const jobRepository = createJobRepository();
        const service = new ServiceRecordLinkService(
            prisma as unknown as PrismaService,
            createTokenService() as never,
            createConfigService() as unknown as ConfigService,
            jobRepository as unknown as IMessageTriggerJobRepository,
            logRepository as unknown as IMessageLogRepository,
            createOverrideRepository() as unknown as IMessageTriggerRuleBranchOverrideRepository,
        );
        prisma.employee_schedule.findUnique.mockResolvedValue(createSchedule({
            primaryEmployee: {
                id: 30,
                name: "홍제공",
                phone: "",
                birthday: "900101",
            },
        }));

        await expect(service.sendNow(10)).rejects.toBeInstanceOf(BadRequestException);

        expect(jobRepository.upsertPending).not.toHaveBeenCalled();
        expect(logRepository.save).not.toHaveBeenCalled();
    });

    it("rejects an invalid manual recipient phone instead of falling back to the stored phone", async () => {
        const prisma = createPrisma();
        const jobRepository = createJobRepository();
        const service = new ServiceRecordLinkService(
            prisma as unknown as PrismaService,
            createTokenService() as never,
            createConfigService() as unknown as ConfigService,
            jobRepository as unknown as IMessageTriggerJobRepository,
            createLogRepository() as unknown as IMessageLogRepository,
            createOverrideRepository() as unknown as IMessageTriggerRuleBranchOverrideRepository,
        );
        prisma.employee_schedule.findUnique.mockResolvedValue(createSchedule());

        await expect(service.sendNow(10, undefined, "010-12")).rejects.toBeInstanceOf(
            BadRequestException,
        );

        expect(jobRepository.upsertPending).not.toHaveBeenCalled();
    });

    it("rejects resend for a replaced provider assignment", async () => {
        const prisma = createPrisma();
        const tokenService = createTokenService();
        const jobRepository = createJobRepository();
        const service = new ServiceRecordLinkService(
            prisma as unknown as PrismaService,
            tokenService as never,
            createConfigService() as unknown as ConfigService,
            jobRepository as unknown as IMessageTriggerJobRepository,
            createLogRepository() as unknown as IMessageLogRepository,
            createOverrideRepository() as unknown as IMessageTriggerRuleBranchOverrideRepository,
        );
        prisma.employee_schedule.findUnique.mockResolvedValue(createSchedule({ replaced: true }));

        await expect(service.sendNow(10)).rejects.toBeInstanceOf(NotFoundException);
        await expect(service.prepareLink(10)).rejects.toBeInstanceOf(NotFoundException);
        expect(tokenService.reuseActiveLink).not.toHaveBeenCalled();
        expect(tokenService.issueLink).not.toHaveBeenCalled();
        expect(tokenService.prepareLink).not.toHaveBeenCalled();
        expect(jobRepository.upsertPending).not.toHaveBeenCalled();
    });

    it("surfaces scheduling errors so the caller can arrange a retry", async () => {
        const prisma = createPrisma();
        const tokenService = createTokenService();
        tokenService.issueLink.mockRejectedValue(new Error("token unavailable"));
        const service = new ServiceRecordLinkService(
            prisma as unknown as PrismaService,
            tokenService as never,
            createConfigService() as unknown as ConfigService,
            createJobRepository() as unknown as IMessageTriggerJobRepository,
            createLogRepository() as unknown as IMessageLogRepository,
            createOverrideRepository() as unknown as IMessageTriggerRuleBranchOverrideRepository,
        );
        prisma.employee_schedule.findUnique.mockResolvedValue(createSchedule());

        await expect(service.scheduleForServiceStart(10)).rejects.toThrow("token unavailable");
    });

    it("extends an existing token to 7 days after end-date at 20:00 KST", async () => {
        const tokenService = createTokenService();
        const service = new ServiceRecordLinkService(
            createPrisma() as unknown as PrismaService,
            tokenService as never,
            createConfigService() as unknown as ConfigService,
            createJobRepository() as unknown as IMessageTriggerJobRepository,
            createLogRepository() as unknown as IMessageLogRepository,
            createOverrideRepository() as unknown as IMessageTriggerRuleBranchOverrideRepository,
        );

        await service.extendExpiryForEndDate(10, new Date("2026-07-12T00:00:00.000Z"));

        expect(tokenService.extendExpiryForSchedule).toHaveBeenCalledWith(
            10,
            new Date("2026-07-19T11:00:00.000Z"),
        );
    });

    it("revokes an existing token and pending jobs", async () => {
        const tokenService = createTokenService();
        const jobRepository = createJobRepository();
        const service = new ServiceRecordLinkService(
            createPrisma() as unknown as PrismaService,
            tokenService as never,
            createConfigService() as unknown as ConfigService,
            jobRepository as unknown as IMessageTriggerJobRepository,
            createLogRepository() as unknown as IMessageLogRepository,
            createOverrideRepository() as unknown as IMessageTriggerRuleBranchOverrideRepository,
        );

        await service.revoke(10);

        expect(tokenService.revokeForSchedule).toHaveBeenCalledWith(10);
        expect(jobRepository.findPendingByRuleIdsAndEmployeeScheduleId).toHaveBeenCalledWith(
            [SERVICE_RECORD_LINK_RULE_ID],
            10,
        );
    });

    it("rethrows token revocation failures", async () => {
        const tokenService = createTokenService();
        const error = new Error("token revoke failed");
        tokenService.revokeForSchedule.mockRejectedValue(error);
        const service = new ServiceRecordLinkService(
            createPrisma() as unknown as PrismaService,
            tokenService as never,
            createConfigService() as unknown as ConfigService,
            createJobRepository() as unknown as IMessageTriggerJobRepository,
            createLogRepository() as unknown as IMessageLogRepository,
            createOverrideRepository() as unknown as IMessageTriggerRuleBranchOverrideRepository,
        );

        await expect(service.revoke(10)).rejects.toBe(error);
    });

    it("rethrows token expiry extension failures", async () => {
        const tokenService = createTokenService();
        const error = new Error("token extension failed");
        tokenService.extendExpiryForSchedule.mockRejectedValue(error);
        const service = new ServiceRecordLinkService(
            createPrisma() as unknown as PrismaService,
            tokenService as never,
            createConfigService() as unknown as ConfigService,
            createJobRepository() as unknown as IMessageTriggerJobRepository,
            createLogRepository() as unknown as IMessageLogRepository,
            createOverrideRepository() as unknown as IMessageTriggerRuleBranchOverrideRepository,
        );

        await expect(
            service.extendExpiryForEndDate(10, new Date("2026-07-12T00:00:00.000Z")),
        ).rejects.toBe(error);
    });

    describe("branch activation override gate", () => {
        it("blocks the automatic scheduling path the repair sweep calls (service-record-link-reconciliation.service.ts:196) when the branch has opted out", async () => {
            const prisma = createPrisma();
            const tokenService = createTokenService();
            const jobRepository = createJobRepository();
            const overrideRepository = createOverrideRepository();
            overrideRepository.findOne.mockResolvedValue({
                branchId: "branch-1",
                ruleId: SERVICE_RECORD_LINK_RULE_ID,
                isActive: false,
            });
            const service = new ServiceRecordLinkService(
                prisma as unknown as PrismaService,
                tokenService as never,
                createConfigService() as unknown as ConfigService,
                jobRepository as unknown as IMessageTriggerJobRepository,
                createLogRepository() as unknown as IMessageLogRepository,
                overrideRepository as unknown as IMessageTriggerRuleBranchOverrideRepository,
            );
            prisma.employee_schedule.findUnique.mockResolvedValue(createSchedule());

            await expect(service.scheduleForServiceStart(10)).resolves.toBe(false);

            expect(prisma.$queryRaw).not.toHaveBeenCalled();
            expect(jobRepository.promoteAutomaticSchedulingClaim).not.toHaveBeenCalled();
            expect(jobRepository.upsertPending).not.toHaveBeenCalled();
            expect(tokenService.issueLink).not.toHaveBeenCalled();
        });

        it("opting back in after an opt-out lets a later automatic trigger enqueue a job again, and keeps the disabled-branch cancel reason registered in both raw-SQL allow-lists that guard against a permanent blocker", async () => {
            const prisma = createPrisma();
            const tokenService = createTokenService();
            const jobRepository = createJobRepository();
            const overrideRepository = createOverrideRepository();
            overrideRepository.findOne.mockResolvedValue({
                branchId: "branch-1",
                ruleId: SERVICE_RECORD_LINK_RULE_ID,
                isActive: false,
            });
            const service = new ServiceRecordLinkService(
                prisma as unknown as PrismaService,
                tokenService as never,
                createConfigService() as unknown as ConfigService,
                jobRepository as unknown as IMessageTriggerJobRepository,
                createLogRepository() as unknown as IMessageLogRepository,
                overrideRepository as unknown as IMessageTriggerRuleBranchOverrideRepository,
            );
            prisma.employee_schedule.findUnique.mockResolvedValue(createSchedule());

            // 1. Opted out: no job enqueued.
            await expect(service.scheduleForServiceStart(10)).resolves.toBe(false);
            expect(jobRepository.promoteAutomaticSchedulingClaim).not.toHaveBeenCalled();

            // 2. Opt back in.
            overrideRepository.findOne.mockResolvedValue({
                branchId: "branch-1",
                ruleId: SERVICE_RECORD_LINK_RULE_ID,
                isActive: true,
            });

            // 3. A legitimate later trigger must be able to enqueue again.
            await expect(service.scheduleForServiceStart(10)).resolves.toBe(true);
            expect(jobRepository.promoteAutomaticSchedulingClaim).toHaveBeenCalledTimes(1);
            expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);

            // claimAutomaticScheduling's raw SQL hardcodes the branch-disabled reason in two
            // allow-lists: the `WHERE NOT EXISTS ... blocker` clause and the
            // `ON CONFLICT ... DO UPDATE ... WHERE` reclaim clause. If a future edit drops the
            // reason from either, a branch-disabled cancellation becomes a permanent blocker —
            // that schedule/rule pair could never be scheduled again, silently. Guard both.
            const sql = prisma.$queryRaw.mock.calls[0]?.[0] as { values: readonly unknown[] };
            const occurrences = sql.values.filter(
                (value) => value === SERVICE_RECORD_LINK_BRANCH_DISABLED_REASON,
            );
            expect(occurrences).toHaveLength(2);
        });

        it("still allows a manual send for an opted-out branch (manual sends bypass the automatic-scheduling gate entirely)", async () => {
            const prisma = createPrisma();
            const tokenService = createTokenService();
            const jobRepository = createJobRepository();
            const overrideRepository = createOverrideRepository();
            overrideRepository.findOne.mockResolvedValue({
                branchId: "branch-1",
                ruleId: SERVICE_RECORD_LINK_RULE_ID,
                isActive: false,
            });
            const service = new ServiceRecordLinkService(
                prisma as unknown as PrismaService,
                tokenService as never,
                createConfigService() as unknown as ConfigService,
                jobRepository as unknown as IMessageTriggerJobRepository,
                createLogRepository() as unknown as IMessageLogRepository,
                overrideRepository as unknown as IMessageTriggerRuleBranchOverrideRepository,
            );
            prisma.employee_schedule.findUnique.mockResolvedValue(createSchedule());

            const result = await service.sendNow(10);

            expect(result.jobId).toBe("job-1");
            expect(jobRepository.upsertPending).toHaveBeenCalledTimes(1);
            expect(overrideRepository.findOne).not.toHaveBeenCalled();
        });

        it("a global kill switch (rule.isActive: false) still blocks automatic scheduling even when the branch override is isActive: true", async () => {
            const prisma = createPrisma();
            // No admin endpoint can produce this state directly on the fixed system rule; seed it
            // at the prisma/repository level, as only an operator touching the DB directly could.
            prisma.message_trigger_rule.findUnique.mockResolvedValue({ isActive: false });
            const tokenService = createTokenService();
            const jobRepository = createJobRepository();
            const overrideRepository = createOverrideRepository();
            overrideRepository.findOne.mockResolvedValue({
                branchId: "branch-1",
                ruleId: SERVICE_RECORD_LINK_RULE_ID,
                isActive: true,
            });
            const service = new ServiceRecordLinkService(
                prisma as unknown as PrismaService,
                tokenService as never,
                createConfigService() as unknown as ConfigService,
                jobRepository as unknown as IMessageTriggerJobRepository,
                createLogRepository() as unknown as IMessageLogRepository,
                overrideRepository as unknown as IMessageTriggerRuleBranchOverrideRepository,
            );
            prisma.employee_schedule.findUnique.mockResolvedValue(createSchedule());

            await expect(service.scheduleForServiceStart(10)).resolves.toBe(false);

            expect(jobRepository.promoteAutomaticSchedulingClaim).not.toHaveBeenCalled();
            expect(prisma.$queryRaw).not.toHaveBeenCalled();
        });
    });
});
