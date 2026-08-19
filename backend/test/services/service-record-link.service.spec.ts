import { BadRequestException, NotFoundException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { ServiceRecordLinkService } from "application/services/service-record-link.service";
import {
    SERVICE_RECORD_LINK_SCHEDULING_RETRY_REASON,
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
import { PrismaService } from "infrastructure/database/prisma.service";

describe("ServiceRecordLinkService", () => {
    const createPrisma = () => ({
        $queryRaw: jest.fn().mockResolvedValue([{ id: "claim-1" }]),
        employee_schedule: {
            findUnique: jest.fn(),
        },
        message_trigger_job: {
            updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        },
        message_trigger_rule: {
            upsert: jest.fn().mockResolvedValue(undefined),
        },
    });
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

    it("issues a token that expires at end-date 20:00 KST and schedules SMS for start-date 15:00 KST", async () => {
        const prisma = createPrisma();
        const tokenService = createTokenService();
        const jobRepository = createJobRepository();
        const service = new ServiceRecordLinkService(
            prisma as unknown as PrismaService,
            tokenService as never,
            createConfigService() as unknown as ConfigService,
            jobRepository as unknown as IMessageTriggerJobRepository,
            createLogRepository() as unknown as IMessageLogRepository,
        );
        prisma.employee_schedule.findUnique.mockResolvedValue(createSchedule());

        await service.scheduleForServiceStart(10);

        expect(tokenService.issueLink).toHaveBeenCalledWith({
            branchId: "branch-1",
            scheduleId: 10,
            employeeId: 30,
            expectedPhone: "010-1111-2222",
            expiresAt: new Date("2026-07-12T20:00:00+09:00"),
        });
        const job = jobRepository.upsertPending.mock.calls[0]?.[0] as MessageTriggerJobEntity;
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
        );
        prisma.employee_schedule.findUnique.mockResolvedValue(createSchedule());

        const result = await service.prepareLink(10, "010-6621-1878");

        expect(tokenService.reuseActiveLink).toHaveBeenCalledWith(expect.objectContaining({
            branchId: "branch-1",
            scheduleId: 10,
            employeeId: 30,
            expectedPhone: "01066211878",
        }));
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
        );
        prisma.employee_schedule.findUnique.mockResolvedValue(createSchedule());

        await service.sendNow(10);

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

    it("claims the durable automatic retry marker before issuing a token", async () => {
        const prisma = createPrisma();
        const tokenService = createTokenService();
        const service = new ServiceRecordLinkService(
            prisma as unknown as PrismaService,
            tokenService as never,
            createConfigService() as unknown as ConfigService,
            createJobRepository() as unknown as IMessageTriggerJobRepository,
            createLogRepository() as unknown as IMessageLogRepository,
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
        expect(sql.strings.join("?")).toContain("blocker.\"status\" IN ('pending', 'processing', 'sent')");
        expect(sql.strings.join("?")).toContain('"canceled_by_user" = false');
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
        tokenService.issueLink.mockRejectedValue(new Error("token unavailable"));
        const service = new ServiceRecordLinkService(
            prisma as unknown as PrismaService,
            tokenService as never,
            createConfigService() as unknown as ConfigService,
            createJobRepository() as unknown as IMessageTriggerJobRepository,
            createLogRepository() as unknown as IMessageLogRepository,
        );
        prisma.employee_schedule.findUnique.mockResolvedValue(createSchedule());
        const before = Date.now();

        await expect(service.scheduleForServiceStart(10)).rejects.toThrow("token unavailable");

        const updateCall = prisma.message_trigger_job.updateMany.mock.calls[0]?.[0];
        expect(updateCall).toEqual({
            where: {
                dedupeKey: `${SERVICE_RECORD_LINK_RULE_ID}:schedule:10:primary`,
                status: "failed",
                cancelReason: SERVICE_RECORD_LINK_SCHEDULING_RETRY_REASON,
                canceledByUser: false,
            },
            data: { nextAttemptAt: expect.any(Date) },
        });
        expect(updateCall.data.nextAttemptAt.getTime()).toBeGreaterThan(before + 5 * 60 * 1000);
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
        );
        prisma.employee_schedule.findUnique.mockResolvedValue(createSchedule());

        await expect(service.scheduleForServiceStart(10)).rejects.toThrow("token unavailable");
    });

    it("extends an existing token to end-date 20:00 KST", async () => {
        const tokenService = createTokenService();
        const service = new ServiceRecordLinkService(
            createPrisma() as unknown as PrismaService,
            tokenService as never,
            createConfigService() as unknown as ConfigService,
            createJobRepository() as unknown as IMessageTriggerJobRepository,
            createLogRepository() as unknown as IMessageLogRepository,
        );

        await service.extendExpiryForEndDate(10, new Date("2026-07-12T00:00:00.000Z"));

        expect(tokenService.extendExpiryForSchedule).toHaveBeenCalledWith(
            10,
            new Date("2026-07-12T20:00:00+09:00"),
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
        );

        await expect(
            service.extendExpiryForEndDate(10, new Date("2026-07-12T00:00:00.000Z")),
        ).rejects.toBe(error);
    });
});
