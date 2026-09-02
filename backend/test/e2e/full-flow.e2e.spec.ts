import { ExecutionContext, INestApplication } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { Test, TestingModule } from "@nestjs/testing";
import { json } from "express";
import request from "supertest";

import { ClientService } from "application/services/client.service";
import { EmployeeScheduleService } from "application/services/employee-schedule.service";
import { MessageAutomationIntentService } from "application/services/message-automation-intent.service";
import { MessageTriggerService } from "application/services/message-trigger.service";
import { ServiceRecordFinalizationService } from "application/services/service-record-finalization.service";
import { ServiceRecordLinkReconciliationService } from "application/services/service-record-link-reconciliation.service";
import { ServiceRecordLinkService } from "application/services/service-record-link.service";
import {
    getClientAutomationIntentDedupeKey,
    getScheduleAutomationIntentDedupeKey,
    MESSAGE_AUTOMATION_INTENT_RETRY_REASON,
    MESSAGE_AUTOMATION_INTENT_RULE_ID,
} from "domain/constants/message-automation-intent";
import {
    MessageTriggerEventType,
    MessageTriggerOffsetType,
    MessageTriggerRecipientType,
    MessageTriggerTemplateKey,
} from "domain/constants/message-trigger-catalog";
import {
    SERVICE_RECORD_LINK_RULE_ID,
    SERVICE_RECORD_LINK_SCHEDULING_RETRY_REASON,
} from "domain/constants/service-record-link-message";
import { normalizePhone } from "domain/utils/normalize-phone";
import { EFORMSIGN_CLIENT_REPOSITORY, IEformsignClientRepository } from "domain/repositories/eformsign.client.interface";
import {
    addBusinessDaysKr,
    countBusinessDaysKr,
    isoDateInKorea,
    isBusinessDayKr,
    UnsupportedKoreanHolidayYearError,
} from "domain/utils/business-days";
import { JwtGuard } from "infrastructure/auth/jwt.guard";
import { PrismaService } from "infrastructure/database/prisma.service";
import { GlobalValidationPipe } from "infrastructure/pipes/global-validation.pipe";
import { TenantModule } from "infrastructure/tenant/tenant.module";
import { ClientModule } from "module/client.module";
import { EmployeeModule } from "module/employee.module";
import { EmployeeScheduleModule } from "module/employee-schedule.module";
import { SchedulerLeaseModule } from "module/scheduler-lease.module";

const BRANCH_ID = "33dbe950-1574-4951-b7b4-92d97ab29512";
const OWNER_USER_ID = "ac5f25d7-f8cc-4c68-82a5-db6dc2968c5f";
const describeE2E = process.env["E2E_VENDOR_STUBS"] === "1" ? describe : describe.skip;

interface ScheduleFixture {
    clientId: number;
    employeeId: number;
    scheduleId: number;
}

interface TwoBusinessDayServicePeriod {
    startDate: string;
    endDate: string;
}

const createTwoBusinessDayServicePeriod = (anchorDate = isoDateInKorea()): TwoBusinessDayServicePeriod => {
    const startDate = addBusinessDaysKr(anchorDate, 1);
    return {
        startDate,
        endDate: addBusinessDaysKr(startDate, 1),
    };
};

const findNextBusinessFriday = (anchorDate = isoDateInKorea()): string => {
    const cursor = new Date(`${anchorDate}T00:00:00.000Z`);
    for (let offset = 0; offset < 56; offset += 1) {
        const candidate = cursor.toISOString().slice(0, 10);
        if (cursor.getUTCDay() === 5 && isBusinessDayKr(candidate)) return candidate;
        cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
    throw new Error(`Unable to find a Korean business Friday after ${anchorDate}`);
};

describe("full-flow service period fixture", () => {
    it("keeps two contracted sessions after a Friday/weekend boundary", () => {
        const friday = findNextBusinessFriday();
        const period = createTwoBusinessDayServicePeriod(friday);

        expect(isBusinessDayKr(period.startDate)).toBe(true);
        expect(isBusinessDayKr(period.endDate)).toBe(true);
        expect(countBusinessDaysKr(period.startDate, period.endDate)).toBe(2);
    });

    it("fails closed for service periods outside the supported holiday calendar", () => {
        expect(() => countBusinessDaysKr("2099-01-01", "2099-01-03")).toThrow(
            UnsupportedKoreanHolidayYearError,
        );
    });
});

describeE2E("BJJ-275 full connected flow", () => {
    let app: INestApplication;
    let prisma: PrismaService;
    let clientService: ClientService;
    let employeeScheduleService: EmployeeScheduleService;
    let messageAutomationIntentService: MessageAutomationIntentService;
    let messageTriggerService: MessageTriggerService;
    let finalizationService: ServiceRecordFinalizationService;
    let serviceRecordLinkService: ServiceRecordLinkService;
    let serviceRecordLinkReconciliationService: ServiceRecordLinkReconciliationService;
    let createDocumentSpy: jest.SpyInstance;

    const ownerJwtGuard = {
        canActivate: (context: ExecutionContext) => {
            context.switchToHttp().getRequest().user = {
                userId: OWNER_USER_ID,
                role: "owner",
                branchId: BRANCH_ID,
                branchRole: "owner",
            };
            return true;
        },
    };

    beforeAll(async () => {
        const moduleRef: TestingModule = await Test.createTestingModule({
            imports: [
                ConfigModule.forRoot({ isGlobal: true }),
                TenantModule,
                ClientModule,
                EmployeeModule,
                EmployeeScheduleModule,
                SchedulerLeaseModule,
            ],
        })
            .overrideGuard(JwtGuard)
            .useValue(ownerJwtGuard)
            .compile();

        app = moduleRef.createNestApplication();
        app.use(json({ limit: "1mb" }));
        app.useGlobalPipes(
            new GlobalValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
        );
        await app.init();

        prisma = app.get(PrismaService);
        clientService = app.get(ClientService, { strict: false });
        employeeScheduleService = app.get(EmployeeScheduleService, { strict: false });
        messageAutomationIntentService = app.get(MessageAutomationIntentService, { strict: false });
        messageTriggerService = app.get(MessageTriggerService, { strict: false });
        finalizationService = app.get(ServiceRecordFinalizationService);
        serviceRecordLinkService = app.get(ServiceRecordLinkService, { strict: false });
        serviceRecordLinkReconciliationService = app.get(ServiceRecordLinkReconciliationService, { strict: false });
        const eformsign = app.get<IEformsignClientRepository>(EFORMSIGN_CLIENT_REPOSITORY);
        createDocumentSpy = jest.spyOn(eformsign, "createDocument");
    });

    afterAll(async () => {
        createDocumentSpy?.mockRestore();
        await app?.close();
    });

    const cleanupScheduleFixture = async (fixture: Partial<ScheduleFixture>): Promise<void> => {
        if (fixture.clientId !== undefined) {
            await prisma.message_log.deleteMany({ where: { clientId: fixture.clientId } });
            await prisma.message_trigger_job.deleteMany({ where: { clientId: fixture.clientId } });
            await prisma.service_record_case.deleteMany({ where: { clientId: fixture.clientId } });
        }
        if (fixture.scheduleId !== undefined) {
            await prisma.message_trigger_job.deleteMany({ where: { employeeScheduleId: fixture.scheduleId } });
            await prisma.eformsign_doc.deleteMany({ where: { employeeScheduleId: fixture.scheduleId } });
            await prisma.service_record.deleteMany({ where: { scheduleId: fixture.scheduleId } });
            await prisma.employee_schedule.deleteMany({ where: { id: fixture.scheduleId } });
        }
        if (fixture.clientId !== undefined) {
            await prisma.client.deleteMany({ where: { id: fixture.clientId } });
        }
        if (fixture.employeeId !== undefined) {
            await prisma.employee.deleteMany({ where: { id: fixture.employeeId } });
        }
    };

    const createScheduleFixture = async (
        label: string,
        applyMessageAutomation: boolean,
        suppressGreetingSms: boolean,
    ): Promise<ScheduleFixture> => {
        const uniqueDigits = `${Date.now()}${Math.floor(Math.random() * 1000)}`.slice(-7);
        const employee = await prisma.employee.create({
            data: {
                name: `${label}-직원-${uniqueDigits}`,
                workArea: ["E2E"],
                phone: `0107${uniqueDigits}`,
                phoneNormalized: normalizePhone(`0107${uniqueDigits}`),
                grade: "E2E",
                openToNextWork: true,
                branchId: BRANCH_ID,
            },
        });
        let clientId: number | undefined;
        let scheduleId: number | undefined;
        try {
            const client = await clientService.create(BRANCH_ID, {
                name: `${label}-고객-${uniqueDigits}`,
                primaryEmployeeId: employee.id,
                address: "E2E 자동화 불변식 테스트 주소",
                phone: `0108${uniqueDigits}`,
                duration: 3,
                startDate: "2027-01-04",
                endDate: "2027-01-06",
                careCenter: false,
                voucherClient: false,
                breastPump: false,
                suppressGreetingSms,
                applyMessageAutomation,
            });
            clientId = client.id;
            const schedule = await prisma.employee_schedule.findFirstOrThrow({
                where: {
                    clientId,
                    primaryEmployeeId: employee.id,
                    branchId: BRANCH_ID,
                    replaced: false,
                },
                orderBy: { id: "desc" },
                select: { id: true },
            });
            scheduleId = schedule.id;
            return { clientId, employeeId: employee.id, scheduleId };
        } catch (error) {
            await cleanupScheduleFixture({ clientId, scheduleId, employeeId: employee.id });
            throw error;
        }
    };

    const createAutomationDisabledSchedule = (label: string): Promise<ScheduleFixture> =>
        createScheduleFixture(label, false, true);

    const createAutomationEnabledSchedule = (label: string): Promise<ScheduleFixture> =>
        createScheduleFixture(label, true, false);

    const ensureEmployeeAssignmentRule = async (label: string): Promise<{ id: string; created: boolean }> => {
        const existing = await prisma.message_trigger_rule.findFirst({
            where: {
                branchId: BRANCH_ID,
                isActive: true,
                eventType: MessageTriggerEventType.EMPLOYEE_ASSIGNED,
                recipientType: MessageTriggerRecipientType.PRIMARY_EMPLOYEE,
                templateKey: MessageTriggerTemplateKey.EMPLOYEE_ASSIGNED,
            },
            select: { id: true },
        });
        if (existing) return { id: existing.id, created: false };

        const id = `e2e:employee-assigned:${label}:${Date.now()}:${Math.floor(Math.random() * 1000)}`;
        await prisma.message_trigger_rule.create({
            data: {
                id,
                branchId: BRANCH_ID,
                name: `${label} 직원 배정 알림`,
                isActive: true,
                eventType: MessageTriggerEventType.EMPLOYEE_ASSIGNED,
                offsetType: MessageTriggerOffsetType.IMMEDIATE,
                offsetDays: 0,
                recipientType: MessageTriggerRecipientType.PRIMARY_EMPLOYEE,
                templateKey: MessageTriggerTemplateKey.EMPLOYEE_ASSIGNED,
                isDefault: false,
                jobsStale: false,
            },
        });
        return { id, created: true };
    };

    const cleanupEmployeeAssignmentRule = async (rule: { id: string; created: boolean }): Promise<void> => {
        if (!rule.created) return;
        await prisma.message_trigger_job.deleteMany({ where: { ruleId: rule.id } });
        await prisma.message_trigger_rule.deleteMany({ where: { id: rule.id } });
    };

    const listClientGenericJobs = async (clientId: number) => prisma.message_trigger_job.findMany({
        where: {
            clientId,
            employeeScheduleId: null,
            ruleId: { not: MESSAGE_AUTOMATION_INTENT_RULE_ID },
        },
        orderBy: { dedupeKey: "asc" },
        select: {
            id: true,
            dedupeKey: true,
            status: true,
            scheduledFor: true,
            templateKey: true,
        },
    });

    const markAutomationIntentDue = async (dedupeKey: string): Promise<void> => {
        await prisma.message_trigger_job.update({
            where: { dedupeKey },
            data: { nextAttemptAt: new Date(Date.now() - 1_000) },
        });
    };

    it("does not repair an automation-disabled future schedule without a service-record job or token", async () => {
        const fixture = await createAutomationDisabledSchedule("서비스기록-재조정-제외");
        try {
            expect(await prisma.message_trigger_job.count({
                where: {
                    employeeScheduleId: fixture.scheduleId,
                    ruleId: SERVICE_RECORD_LINK_RULE_ID,
                },
            })).toBe(0);
            expect(await prisma.service_record_token.count({ where: { scheduleId: fixture.scheduleId } })).toBe(0);
            expect(await prisma.message_trigger_job.count({
                where: {
                    ruleId: MESSAGE_AUTOMATION_INTENT_RULE_ID,
                    OR: [
                        { clientId: fixture.clientId },
                        { employeeScheduleId: fixture.scheduleId },
                    ],
                },
            })).toBe(0);

            const branch = await prisma.branch.findUnique({
                where: { id: BRANCH_ID },
                select: { smsSenderApprovalStatus: true },
            });
            if (!branch) throw new Error(`test branch ${BRANCH_ID} does not exist`);
            const restoreSmsApprovalStatus = branch.smsSenderApprovalStatus !== "approved";
            if (restoreSmsApprovalStatus) {
                await prisma.branch.update({
                    where: { id: BRANCH_ID },
                    data: { smsSenderApprovalStatus: "approved" },
                });
            }
            try {
                await serviceRecordLinkReconciliationService.reconcileMissingJobs(new Date());
                await serviceRecordLinkReconciliationService.reconcileMissingJobs(
                    new Date(Date.now() + 10 * 60 * 1000),
                );
            } finally {
                if (restoreSmsApprovalStatus) {
                    await prisma.branch.update({
                        where: { id: BRANCH_ID },
                        data: { smsSenderApprovalStatus: branch.smsSenderApprovalStatus },
                    });
                }
            }

            expect(await prisma.message_trigger_job.count({
                where: {
                    employeeScheduleId: fixture.scheduleId,
                    ruleId: SERVICE_RECORD_LINK_RULE_ID,
                },
            })).toBe(0);
            expect(await prisma.service_record_token.count({ where: { scheduleId: fixture.scheduleId } })).toBe(0);
            expect(await prisma.message_trigger_job.count({
                where: {
                    ruleId: MESSAGE_AUTOMATION_INTENT_RULE_ID,
                    OR: [
                        { clientId: fixture.clientId },
                        { employeeScheduleId: fixture.scheduleId },
                    ],
                },
            })).toBe(0);
        } finally {
            await cleanupScheduleFixture(fixture);
        }
    }, 30_000);

    it("persists and reconciles client and schedule automation intents after post-commit failures", async () => {
        let fixture: ScheduleFixture | undefined;
        let employeeAssignmentRule: { id: string; created: boolean } | undefined;
        let clientSyncSpy: jest.SpyInstance | undefined;
        let serviceRecordSchedulingSpy: jest.SpyInstance | undefined;
        try {
            employeeAssignmentRule = await ensureEmployeeAssignmentRule("자동화-복구");
            clientSyncSpy = jest
                .spyOn(messageTriggerService, "syncClientRulesForClient")
                .mockRejectedValueOnce(new Error("e2e client automation sync fault"));
            serviceRecordSchedulingSpy = jest
                .spyOn(serviceRecordLinkService, "scheduleForServiceStart")
                .mockRejectedValueOnce(new Error("e2e service-record scheduling fault"));

            fixture = await createAutomationEnabledSchedule("자동화-복구");
            expect(fixture).toEqual({
                clientId: expect.any(Number),
                employeeId: expect.any(Number),
                scheduleId: expect.any(Number),
            });
            expect(clientSyncSpy).toHaveBeenCalledTimes(1);
            expect(serviceRecordSchedulingSpy).toHaveBeenCalledTimes(1);

            const clientIntentDedupeKey = getClientAutomationIntentDedupeKey(BRANCH_ID, fixture.clientId);
            const scheduleIntentDedupeKey = getScheduleAutomationIntentDedupeKey(BRANCH_ID, fixture.scheduleId);
            const intents = await prisma.message_trigger_job.findMany({
                where: {
                    ruleId: MESSAGE_AUTOMATION_INTENT_RULE_ID,
                    OR: [
                        { dedupeKey: clientIntentDedupeKey },
                        { dedupeKey: scheduleIntentDedupeKey },
                    ],
                },
                orderBy: { dedupeKey: "asc" },
                select: {
                    dedupeKey: true,
                    status: true,
                    cancelReason: true,
                    canceledByUser: true,
                    clientId: true,
                    employeeScheduleId: true,
                },
            });
            expect(intents).toEqual([
                {
                    dedupeKey: clientIntentDedupeKey,
                    status: "failed",
                    cancelReason: MESSAGE_AUTOMATION_INTENT_RETRY_REASON,
                    canceledByUser: false,
                    clientId: fixture.clientId,
                    employeeScheduleId: null,
                },
                {
                    dedupeKey: scheduleIntentDedupeKey,
                    status: "failed",
                    cancelReason: MESSAGE_AUTOMATION_INTENT_RETRY_REASON,
                    canceledByUser: false,
                    clientId: fixture.clientId,
                    employeeScheduleId: fixture.scheduleId,
                },
            ]);
            expect(await prisma.message_trigger_job.count({
                where: { employeeScheduleId: fixture.scheduleId, ruleId: SERVICE_RECORD_LINK_RULE_ID },
            })).toBe(0);
            expect(await prisma.service_record_token.count({ where: { scheduleId: fixture.scheduleId } })).toBe(0);

            clientSyncSpy.mockRestore();
            serviceRecordSchedulingSpy.mockRestore();
            clientSyncSpy = undefined;
            serviceRecordSchedulingSpy = undefined;

            // The real failure path applies a five-minute retry delay. Move the
            // durable markers into the due window so this test can reconcile
            // immediately without sleeping or changing the scheduler clock.
            await prisma.message_trigger_job.updateMany({
                where: {
                    ruleId: MESSAGE_AUTOMATION_INTENT_RULE_ID,
                    OR: [
                        { dedupeKey: clientIntentDedupeKey },
                        { dedupeKey: scheduleIntentDedupeKey },
                    ],
                },
                data: { nextAttemptAt: new Date(Date.now() - 1_000) },
            });

            const branch = await prisma.branch.findUniqueOrThrow({
                where: { id: BRANCH_ID },
                select: { smsSenderApprovalStatus: true },
            });
            const restoreSmsApprovalStatus = branch.smsSenderApprovalStatus !== "approved";
            if (restoreSmsApprovalStatus) {
                await prisma.branch.update({
                    where: { id: BRANCH_ID },
                    data: { smsSenderApprovalStatus: "approved" },
                });
            }

            try {
                const reconciliationDate = new Date(Date.now() + 10 * 60 * 1000);
                await expect(
                    messageAutomationIntentService.reconcilePendingIntents(reconciliationDate),
                ).resolves.toBe(2);

                const clientJobs = await prisma.message_trigger_job.findMany({
                    where: {
                        clientId: fixture.clientId,
                        ruleId: { not: MESSAGE_AUTOMATION_INTENT_RULE_ID },
                        templateKey: MessageTriggerTemplateKey.CLIENT_GREETING,
                        status: "pending",
                    },
                    select: { id: true, ruleId: true, dedupeKey: true },
                });
                expect(clientJobs).toHaveLength(1);

                const employeeJobs = await prisma.message_trigger_job.findMany({
                    where: {
                        employeeScheduleId: fixture.scheduleId,
                        ruleId: employeeAssignmentRule.id,
                        status: "pending",
                    },
                    select: { id: true, dedupeKey: true },
                });
                expect(employeeJobs).toHaveLength(1);

                const serviceRecordJobs = await prisma.message_trigger_job.findMany({
                    where: {
                        employeeScheduleId: fixture.scheduleId,
                        ruleId: SERVICE_RECORD_LINK_RULE_ID,
                        status: "pending",
                    },
                    select: { id: true, dedupeKey: true },
                });
                expect(serviceRecordJobs).toEqual([
                    {
                        id: expect.any(String),
                        dedupeKey: `${SERVICE_RECORD_LINK_RULE_ID}:schedule:${fixture.scheduleId}:primary`,
                    },
                ]);
                const activeTokens = await prisma.service_record_token.findMany({
                    where: { scheduleId: fixture.scheduleId, active: true, revokedAt: null },
                    select: { id: true },
                });
                expect(activeTokens).toHaveLength(1);
                expect(await prisma.message_trigger_job.count({
                    where: {
                        ruleId: MESSAGE_AUTOMATION_INTENT_RULE_ID,
                        OR: [
                            { clientId: fixture.clientId },
                            { employeeScheduleId: fixture.scheduleId },
                        ],
                    },
                })).toBe(0);

                const beforeSecondReconciliation = {
                    clientJobs: clientJobs.map((job) => job.id),
                    employeeJobs: employeeJobs.map((job) => job.id),
                    serviceRecordJobs: serviceRecordJobs.map((job) => job.id),
                    activeTokens: activeTokens.map((token) => token.id),
                };
                await expect(
                    messageAutomationIntentService.reconcilePendingIntents(reconciliationDate),
                ).resolves.toBe(0);
                const afterSecondReconciliation = {
                    clientJobs: (await prisma.message_trigger_job.findMany({
                        where: {
                            clientId: fixture.clientId,
                            ruleId: { not: MESSAGE_AUTOMATION_INTENT_RULE_ID },
                            templateKey: MessageTriggerTemplateKey.CLIENT_GREETING,
                            status: "pending",
                        },
                        select: { id: true },
                    })).map((job) => job.id),
                    employeeJobs: (await prisma.message_trigger_job.findMany({
                        where: {
                            employeeScheduleId: fixture.scheduleId,
                            ruleId: employeeAssignmentRule.id,
                            status: "pending",
                        },
                        select: { id: true },
                    })).map((job) => job.id),
                    serviceRecordJobs: (await prisma.message_trigger_job.findMany({
                        where: {
                            employeeScheduleId: fixture.scheduleId,
                            ruleId: SERVICE_RECORD_LINK_RULE_ID,
                            status: "pending",
                        },
                        select: { id: true },
                    })).map((job) => job.id),
                    activeTokens: (await prisma.service_record_token.findMany({
                        where: { scheduleId: fixture.scheduleId, active: true, revokedAt: null },
                        select: { id: true },
                    })).map((token) => token.id),
                };
                expect(afterSecondReconciliation).toEqual(beforeSecondReconciliation);
            } finally {
                if (restoreSmsApprovalStatus) {
                    await prisma.branch.update({
                        where: { id: BRANCH_ID },
                        data: { smsSenderApprovalStatus: branch.smsSenderApprovalStatus },
                    });
                }
            }
        } finally {
            clientSyncSpy?.mockRestore();
            serviceRecordSchedulingSpy?.mockRestore();
            if (fixture) await cleanupScheduleFixture(fixture);
            if (employeeAssignmentRule) await cleanupEmployeeAssignmentRule(employeeAssignmentRule);
        }
    }, 30_000);

    it("cancels assignment automation and does not rebuild it when a schedule is replaced", async () => {
        let fixture: ScheduleFixture | undefined;
        let employeeAssignmentRule: { id: string; created: boolean } | undefined;
        try {
            employeeAssignmentRule = await ensureEmployeeAssignmentRule("자동화-대체-종료");
            fixture = await createAutomationEnabledSchedule("자동화-대체-종료");

            // Reconcile once so the assertion always starts with a persisted
            // pending assignment generation, even when schedule creation was
            // intentionally configured not to await its automation intent.
            await messageTriggerService.syncEmployeeAssignmentRulesForSchedule(
                BRANCH_ID,
                fixture.scheduleId,
                true,
            );
            const beforeReplacement = await prisma.message_trigger_job.findMany({
                where: {
                    employeeScheduleId: fixture.scheduleId,
                    ruleId: employeeAssignmentRule.id,
                    status: "pending",
                },
                select: { id: true, dedupeKey: true },
            });
            expect(beforeReplacement.length).toBeGreaterThan(0);

            await employeeScheduleService.update(BRANCH_ID, fixture.scheduleId, { replaced: true });

            const assignmentJobs = await prisma.message_trigger_job.findMany({
                where: {
                    employeeScheduleId: fixture.scheduleId,
                    ruleId: employeeAssignmentRule.id,
                },
                select: { id: true, dedupeKey: true, status: true, sentAt: true, canceledByUser: true },
            });
            expect(assignmentJobs).toHaveLength(beforeReplacement.length);
            expect(assignmentJobs.every((job) => job.status === "canceled")).toBe(true);
            expect(assignmentJobs.every((job) => job.sentAt === null)).toBe(true);
            expect(assignmentJobs.every((job) => job.canceledByUser === false)).toBe(true);
            expect(await prisma.message_trigger_job.count({
                where: {
                    employeeScheduleId: fixture.scheduleId,
                    ruleId: employeeAssignmentRule.id,
                    status: { in: ["pending", "processing"] },
                },
            })).toBe(0);
            await expect(prisma.employee_schedule.findUniqueOrThrow({
                where: { id: fixture.scheduleId },
                select: { replaced: true },
            })).resolves.toEqual({ replaced: true });
        } finally {
            if (fixture) await cleanupScheduleFixture(fixture);
            if (employeeAssignmentRule) await cleanupEmployeeAssignmentRule(employeeAssignmentRule);
        }
    }, 30_000);

    it("keeps generated client jobs stable when the intent marker deletion fails", async () => {
        let fixture: ScheduleFixture | undefined;
        let intentDeleteSpy: jest.SpyInstance | undefined;
        let deleteFaultInjected = false;
        try {
            const originalDeleteMany = prisma.message_trigger_job.deleteMany.bind(prisma.message_trigger_job);
            intentDeleteSpy = jest.spyOn(prisma.message_trigger_job, "deleteMany").mockImplementation((args) => {
                const where = args?.where;
                const isIntentDeletion = where?.ruleId === MESSAGE_AUTOMATION_INTENT_RULE_ID
                    && where.status === "failed"
                    && where.cancelReason === MESSAGE_AUTOMATION_INTENT_RETRY_REASON
                    && where.canceledByUser === false
                    && Boolean(where.id);
                if (!deleteFaultInjected && isIntentDeletion) {
                    deleteFaultInjected = true;
                    throw new Error("e2e marker-delete crash after client jobs were generated");
                }
                return originalDeleteMany(args);
            });

            fixture = await createAutomationEnabledSchedule("자동화-표식삭제-충돌");
            expect(deleteFaultInjected).toBe(true);
            expect(intentDeleteSpy).toHaveBeenCalled();

            const clientIntentDedupeKey = getClientAutomationIntentDedupeKey(BRANCH_ID, fixture.clientId);
            const clientIntent = await prisma.message_trigger_job.findUniqueOrThrow({
                where: { dedupeKey: clientIntentDedupeKey },
                select: { id: true, status: true, cancelReason: true, nextAttemptAt: true },
            });
            expect(clientIntent).toEqual(expect.objectContaining({
                status: "failed",
                cancelReason: MESSAGE_AUTOMATION_INTENT_RETRY_REASON,
                nextAttemptAt: expect.any(Date),
            }));

            const jobsBeforeRetry = await listClientGenericJobs(fixture.clientId);
            expect(jobsBeforeRetry.length).toBeGreaterThan(0);
            expect(new Set(jobsBeforeRetry.map((job) => job.dedupeKey)).size).toBe(jobsBeforeRetry.length);

            intentDeleteSpy.mockRestore();
            intentDeleteSpy = undefined;
            await markAutomationIntentDue(clientIntentDedupeKey);

            await expect(messageAutomationIntentService.reconcilePendingIntents()).resolves.toBe(1);
            await expect(prisma.message_trigger_job.findUnique({
                where: { dedupeKey: clientIntentDedupeKey },
                select: { id: true },
            })).resolves.toBeNull();
            await expect(listClientGenericJobs(fixture.clientId)).resolves.toEqual(jobsBeforeRetry);

            await expect(messageAutomationIntentService.reconcilePendingIntents()).resolves.toBe(0);
            await expect(listClientGenericJobs(fixture.clientId)).resolves.toEqual(jobsBeforeRetry);
        } finally {
            intentDeleteSpy?.mockRestore();
            if (fixture) await cleanupScheduleFixture(fixture);
        }
    }, 30_000);

    it("converges concurrent client intent fulfillment to one stable job set", async () => {
        let fixture: ScheduleFixture | undefined;
        let clientSyncSpy: jest.SpyInstance | undefined;
        try {
            clientSyncSpy = jest
                .spyOn(messageTriggerService, "syncClientRulesForClient")
                .mockRejectedValueOnce(new Error("e2e client sync fault before concurrent retry"));
            fixture = await createAutomationEnabledSchedule("자동화-동시-복구");
            expect(clientSyncSpy).toHaveBeenCalledTimes(1);

            clientSyncSpy.mockRestore();
            clientSyncSpy = undefined;
            const clientIntentDedupeKey = getClientAutomationIntentDedupeKey(BRANCH_ID, fixture.clientId);
            await expect(prisma.message_trigger_job.findUnique({
                where: { dedupeKey: clientIntentDedupeKey },
                select: { status: true },
            })).resolves.toEqual({ status: "failed" });
            await markAutomationIntentDue(clientIntentDedupeKey);

            const fulfillmentParams = {
                branchId: BRANCH_ID,
                clientId: fixture.clientId,
                includePast: true,
                suppressGreeting: false,
            } as const;
            const results = await Promise.all([
                messageAutomationIntentService.fulfillClientIntent(fulfillmentParams),
                messageAutomationIntentService.fulfillClientIntent(fulfillmentParams),
            ]);
            expect(results.sort()).toEqual([false, true]);

            const jobsAfterConcurrentFulfillment = await listClientGenericJobs(fixture.clientId);
            expect(jobsAfterConcurrentFulfillment.length).toBeGreaterThan(0);
            expect(new Set(jobsAfterConcurrentFulfillment.map((job) => job.id)).size)
                .toBe(jobsAfterConcurrentFulfillment.length);
            expect(new Set(jobsAfterConcurrentFulfillment.map((job) => job.dedupeKey)).size)
                .toBe(jobsAfterConcurrentFulfillment.length);
            await expect(prisma.message_trigger_job.findUnique({
                where: { dedupeKey: clientIntentDedupeKey },
                select: { id: true },
            })).resolves.toBeNull();

            await expect(messageAutomationIntentService.reconcilePendingIntents()).resolves.toBe(0);
            await expect(listClientGenericJobs(fixture.clientId)).resolves.toEqual(
                jobsAfterConcurrentFulfillment,
            );
        } finally {
            clientSyncSpy?.mockRestore();
            if (fixture) await cleanupScheduleFixture(fixture);
        }
    }, 30_000);

    it("converges concurrent service-start scheduling to one automatic job and active token", async () => {
        const fixture = await createAutomationDisabledSchedule("서비스기록-동시-예약");
        try {
            // Warm the one-time rule/case setup so the race below isolates automatic
            // job claiming and active-token reuse, rather than bootstrap upserts.
            await expect(serviceRecordLinkService.scheduleForServiceStart(fixture.scheduleId)).resolves.toBe(true);
            await prisma.message_trigger_job.deleteMany({ where: { employeeScheduleId: fixture.scheduleId } });
            await prisma.service_record_token.deleteMany({ where: { scheduleId: fixture.scheduleId } });

            const settledResults = await Promise.allSettled([
                serviceRecordLinkService.scheduleForServiceStart(fixture.scheduleId),
                serviceRecordLinkService.scheduleForServiceStart(fixture.scheduleId),
            ]);
            const rejectedResults = settledResults.filter((result) => result.status === "rejected");
            expect(rejectedResults).toHaveLength(0);
            const results = settledResults
                .filter((result): result is PromiseFulfilledResult<boolean> => result.status === "fulfilled")
                .map((result) => result.value);
            expect(results.filter(Boolean)).toHaveLength(1);

            const automaticJobs = await prisma.message_trigger_job.findMany({
                where: {
                    employeeScheduleId: fixture.scheduleId,
                    ruleId: SERVICE_RECORD_LINK_RULE_ID,
                },
                select: { dedupeKey: true, status: true },
            });
            expect(automaticJobs).toHaveLength(1);
            expect(automaticJobs[0]).toEqual({
                dedupeKey: `${SERVICE_RECORD_LINK_RULE_ID}:schedule:${fixture.scheduleId}:primary`,
                status: "pending",
            });

            const activeTokens = await prisma.service_record_token.findMany({
                where: { scheduleId: fixture.scheduleId, active: true, revokedAt: null },
                select: { id: true },
            });
            expect(activeTokens).toHaveLength(1);
        } finally {
            await cleanupScheduleFixture(fixture);
        }
    }, 30_000);

    it("repairs a durable scheduling marker without reviving a user-canceled job", async () => {
        const repairFixture = await createAutomationDisabledSchedule("서비스기록-복구-표식");
        const canceledFixture = await createAutomationDisabledSchedule("서비스기록-사용자-취소");
        try {
            await expect(serviceRecordLinkService.scheduleForServiceStart(repairFixture.scheduleId)).resolves.toBe(true);
            await expect(serviceRecordLinkService.scheduleForServiceStart(canceledFixture.scheduleId)).resolves.toBe(true);

            await prisma.service_record_token.deleteMany({
                where: { scheduleId: repairFixture.scheduleId },
            });
            await prisma.message_trigger_job.updateMany({
                where: {
                    employeeScheduleId: repairFixture.scheduleId,
                    ruleId: SERVICE_RECORD_LINK_RULE_ID,
                },
                data: {
                    status: "failed",
                    cancelReason: SERVICE_RECORD_LINK_SCHEDULING_RETRY_REASON,
                    nextAttemptAt: new Date(Date.now() - 60_000),
                },
            });
            await prisma.message_trigger_job.updateMany({
                where: {
                    employeeScheduleId: canceledFixture.scheduleId,
                    ruleId: SERVICE_RECORD_LINK_RULE_ID,
                },
                data: {
                    status: "canceled",
                    canceledAt: new Date(),
                    cancelReason: "사용자가 발송을 취소함",
                    canceledByUser: true,
                    nextAttemptAt: null,
                },
            });
            const canceledTokenCount = await prisma.service_record_token.count({
                where: { scheduleId: canceledFixture.scheduleId, active: true, revokedAt: null },
            });

            const branch = await prisma.branch.findUniqueOrThrow({
                where: { id: BRANCH_ID },
                select: { smsSenderApprovalStatus: true },
            });
            const restoreSmsApprovalStatus = branch.smsSenderApprovalStatus !== "approved";
            if (restoreSmsApprovalStatus) {
                await prisma.branch.update({
                    where: { id: BRANCH_ID },
                    data: { smsSenderApprovalStatus: "approved" },
                });
            }
            try {
                await expect(
                    serviceRecordLinkReconciliationService.reconcileMissingJobs(new Date()),
                ).resolves.toBe(1);
            } finally {
                if (restoreSmsApprovalStatus) {
                    await prisma.branch.update({
                        where: { id: BRANCH_ID },
                        data: { smsSenderApprovalStatus: branch.smsSenderApprovalStatus },
                    });
                }
            }

            const repairedJob = await prisma.message_trigger_job.findUniqueOrThrow({
                where: {
                    dedupeKey: `${SERVICE_RECORD_LINK_RULE_ID}:schedule:${repairFixture.scheduleId}:primary`,
                },
            });
            expect(repairedJob.status).toBe("pending");
            expect(await prisma.service_record_token.count({
                where: { scheduleId: repairFixture.scheduleId, active: true, revokedAt: null },
            })).toBe(1);

            const canceledJob = await prisma.message_trigger_job.findUniqueOrThrow({
                where: {
                    dedupeKey: `${SERVICE_RECORD_LINK_RULE_ID}:schedule:${canceledFixture.scheduleId}:primary`,
                },
            });
            expect(canceledJob.status).toBe("canceled");
            expect(canceledJob.canceledByUser).toBe(true);
            expect(await prisma.service_record_token.count({
                where: { scheduleId: canceledFixture.scheduleId, active: true, revokedAt: null },
            })).toBe(canceledTokenCount);
        } finally {
            await cleanupScheduleFixture(repairFixture);
            await cleanupScheduleFixture(canceledFixture);
        }
    }, 30_000);

    it("creates a contract client and completes assignment, messaging, entry, and finalization through vendor stubs", async () => {
        const runId = `${Date.now()}`.slice(-8);
        const employeePhone = `0108${runId}`.slice(0, 11);
        const clientPhone = `0109${runId}`.slice(0, 11);
        const { startDate, endDate } = createTwoBusinessDayServicePeriod();

        const clientRes = await request(app.getHttpServer()).post("/clients").send({
            name: `전체흐름고객-${runId}`,
            phone: clientPhone,
            duration: 2,
            startDate,
            endDate,
            careCenter: false,
            voucherClient: false,
            breastPump: false,
            areaId: "namdong",
            source: "contract_auto_registration",
            suppressGreetingSms: false,
        });
        expect(clientRes.status).toBe(201);
        const clientId = clientRes.body.id as number;
        expect((await prisma.client.findUniqueOrThrow({ where: { id: clientId } })).suppressGreetingSms).toBe(true);

        const employeeRes = await request(app.getHttpServer()).post("/employees").send({
            name: `전체흐름직원-${runId}`,
            workArea: ["남동구"],
            phone: employeePhone,
            grade: "스탠다드",
            openToNextWork: true,
        });
        expect(employeeRes.status).toBe(201);
        const employeeId = employeeRes.body.id as number;
        expect(employeeId).toEqual(expect.any(Number));

        const scheduleRes = await request(app.getHttpServer()).post("/employee-schedules").send({
            clientId,
            primaryEmployeeId: employeeId,
            secondaryEmployeeId: null,
            workAddress: "인천 남동구 E2E로 1",
            startDate,
            endDate,
        });
        expect(scheduleRes.status).toBe(201);
        const scheduleId = scheduleRes.body.id as number;
        expect(await prisma.employee_schedule.findUnique({ where: { id: scheduleId } })).not.toBeNull();
        const automaticLinkJob = await prisma.message_trigger_job.findUniqueOrThrow({
            where: {
                dedupeKey: `${SERVICE_RECORD_LINK_RULE_ID}:schedule:${scheduleId}:primary`,
            },
        });
        expect(["pending", "processing", "sent"]).toContain(automaticLinkJob.status);
        expect(automaticLinkJob.scheduledFor).toEqual(
            new Date(`${startDate}T15:00:00+09:00`),
        );
        expect(automaticLinkJob.payload).toEqual(expect.objectContaining({
            templateVariables: expect.objectContaining({
                serviceStartDate: startDate,
                serviceRecordUrl: expect.stringMatching(/\/service-record\/efl_/),
            }),
        }));

        const prepared = await request(app.getHttpServer())
            .post(`/admin/service-records/schedules/${scheduleId}/prepare-link`)
            .send({ recipientPhone: employeePhone });
        expect(prepared.status).toBe(201);
        expect(prepared.body.preparedLinkToken).toEqual(expect.any(String));

        const sent = await request(app.getHttpServer())
            .post(`/admin/service-records/schedules/${scheduleId}/send-link`)
            .send({ preparedLinkToken: prepared.body.preparedLinkToken, recipientPhone: employeePhone });
        expect(sent.status).toBe(201);
        expect(sent.body.status).toBe("sent");
        expect((await prisma.message_trigger_job.findUniqueOrThrow({ where: { id: sent.body.jobId } })).status).toBe("sent");

        const link = await request(app.getHttpServer()).get(`/service-record/link/${prepared.body.preparedLinkToken}`);
        expect(link.status).toBe(200);
        expect(link.body.valid).toBe(true);

        const verified = await request(app.getHttpServer()).post("/service-record/verify").send({
            linkToken: prepared.body.preparedLinkToken,
            phone: employeePhone,
        });
        expect(verified.status).toBe(201);
        expect(verified.body.accessToken).toEqual(expect.any(String));
        const auth = { Authorization: `Bearer ${verified.body.accessToken}` };

        const header = await request(app.getHttpServer()).put("/service-record/header").set(auth).send({
            momName: "전체흐름산모",
            momBirth: "900101",
            babyName: "전체흐름아기",
            babyBirth: startDate.replaceAll("-", "").slice(2),
            deliveryType: "자연분만",
            babyWeight: "3.2kg",
        });
        expect(header.status).toBe(200);

        const submitted = await request(app.getHttpServer()).post("/service-record/sessions/1/submit").set(auth).send({
            serviceDate: startDate,
            answers: { sitzBath: "실시", sleep: "잘 잠", stool: "정상" },
            paymentConfirmed: true,
            momApproval: "approved",
            clientSignature: "data:image/png;base64,aQ==",
        });
        expect(submitted.status).toBe(201);
        const secondSubmitted = await request(app.getHttpServer()).post("/service-record/sessions/2/submit").set(auth).send({
            serviceDate: endDate,
            answers: { sitzBath: "실시", sleep: "잘 잠", stool: "정상" },
            paymentConfirmed: true,
            momApproval: "approved",
            clientSignature: "data:image/png;base64,aQ==",
        });
        expect(secondSubmitted.status).toBe(201);

        const context = await request(app.getHttpServer()).get("/service-record/context").set(auth);
        expect(context.status).toBe(200);
        expect(context.body.sessions).toEqual(expect.arrayContaining([
            expect.objectContaining({ sessionIndex: 1, locked: true }),
        ]));

        const acknowledged = await request(app.getHttpServer()).post("/service-record/finalize").set(auth);
        expect(acknowledged.status).toBe(201);
        expect(acknowledged.body.status).toBe("READY_TO_FINALIZE");

        const serviceCase = await prisma.service_record_case.findUniqueOrThrow({ where: { clientId } });
        const dueAt = new Date(Date.now() - 60_000);
        await prisma.service_record_case.update({
            where: { id: serviceCase.id },
            data: { finalizationDueAt: dueAt },
        });
        const finalizedCount = await finalizationService.processDueCases(new Date());
        expect(finalizedCount).toBe(1);
        expect((await prisma.service_record_case.findUniqueOrThrow({ where: { id: serviceCase.id } })).status)
            .toBe("DOCUMENTS_CREATED");
        expect(createDocumentSpy).toHaveBeenCalled();
        expect(await prisma.eformsign_doc.count({
            where: { serviceRecordCaseId: serviceCase.id, documentKind: "service_record_snapshot" },
        })).toBeGreaterThan(0);
    }, 30_000);
});
