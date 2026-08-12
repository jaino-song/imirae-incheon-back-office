import { Test, TestingModule } from "@nestjs/testing";
import { ConflictException, ExecutionContext, INestApplication, ValidationPipe } from "@nestjs/common";
import request from "supertest";
import { MessageTriggerController } from "interface/controllers/message-trigger.controller";
import {
    MessageTriggerService,
    type MessageLogRecordView,
    type UpcomingMessageTriggerJobView,
} from "application/services/message-trigger.service";
import { JwtGuard } from "infrastructure/auth/jwt.guard";
import { TenantGuard } from "infrastructure/tenant/tenant.guard";
import {
    MessageTriggerEventType,
    MessageTriggerOffsetType,
    MessageTriggerRecipientType,
    MessageTriggerTemplateKey,
    type MessageTriggerTemplateCatalogItem,
} from "domain/constants/message-trigger-catalog";
import { MessageTriggerRuleEntity } from "domain/entities/message-trigger-rule.entity";
import { SmsRetryService } from "application/services/sms-retry.service";

describe("MessageTriggerController (Integration)", () => {
    type RuleOverrides = Partial<{
        id: string;
        branchId: string | null;
        name: string;
        isActive: boolean;
        eventType: MessageTriggerEventType;
        offsetType: MessageTriggerOffsetType;
        offsetDays: number;
        recipientType: MessageTriggerRecipientType;
        templateKey: MessageTriggerTemplateKey;
        createdAt: Date;
        updatedAt: Date;
    }>;

    let app: INestApplication;
    let triggerService: {
        listRules: jest.Mock;
        listUpcomingJobs: jest.Mock;
        listHistory: jest.Mock;
        cancelJobByUser: jest.Mock;
        createRule: jest.Mock;
        getRule: jest.Mock;
        updateRule: jest.Mock;
        deleteRule: jest.Mock;
        listTemplates: jest.Mock;
    };
    let smsRetryService: {
        retryById: jest.Mock;
    };

    const branchId = "org-1";

    const createMockRule = (
        overrides: RuleOverrides = {},
    ) =>
        MessageTriggerRuleEntity.reconstitute(
            overrides.id ?? "rule-1",
            overrides.branchId ?? branchId,
            overrides.name ?? "고객 등록 즉시 발송",
            overrides.isActive ?? true,
            overrides.eventType ?? MessageTriggerEventType.CLIENT_CREATED,
            overrides.offsetType ?? MessageTriggerOffsetType.IMMEDIATE,
            overrides.offsetDays ?? 0,
            overrides.recipientType ?? MessageTriggerRecipientType.CLIENT,
            overrides.templateKey ?? MessageTriggerTemplateKey.CLIENT_WELCOME,
            overrides.createdAt ?? new Date("2025-01-01T00:00:00.000Z"),
            overrides.updatedAt ?? new Date("2025-01-02T00:00:00.000Z"),
        );

    const createMockUpcomingJob = (
        overrides: Partial<UpcomingMessageTriggerJobView> = {},
    ): UpcomingMessageTriggerJobView => ({
        id: overrides.id ?? "job-1",
        ruleId: overrides.ruleId ?? "rule-1",
        ruleName: overrides.ruleName ?? "고객 등록 즉시 발송",
        eventType: overrides.eventType ?? MessageTriggerEventType.CLIENT_CREATED,
        offsetType: overrides.offsetType ?? MessageTriggerOffsetType.IMMEDIATE,
        offsetDays: overrides.offsetDays ?? 0,
        recipientType: overrides.recipientType ?? MessageTriggerRecipientType.CLIENT,
        recipientPhone: overrides.recipientPhone ?? "010-1234-5678",
        templateKey: overrides.templateKey ?? MessageTriggerTemplateKey.CLIENT_WELCOME,
        status: overrides.status ?? "pending",
        scheduledFor: overrides.scheduledFor ?? new Date("2025-01-03T09:00:00.000Z"),
        sentAt: overrides.sentAt ?? null,
        canceledAt: overrides.canceledAt ?? null,
        cancelReason: overrides.cancelReason ?? null,
        clientId: overrides.clientId ?? 101,
        employeeScheduleId: overrides.employeeScheduleId ?? null,
        payload: overrides.payload ?? {
            memberId: "101",
            recipientName: "김고객",
            recipientPhone: "010-1234-5678",
            templateVariables: {
                clientName: "김고객",
            },
        },
        createdAt: overrides.createdAt ?? new Date("2025-01-01T00:00:00.000Z"),
        updatedAt: overrides.updatedAt ?? new Date("2025-01-01T00:00:00.000Z"),
    });

    const createMockHistoryRecord = (
        overrides: Partial<MessageLogRecordView> = {},
    ): MessageLogRecordView => ({
        id: overrides.id ?? 1,
        provider: overrides.provider ?? "aligo_sms",
        templateKey: overrides.templateKey ?? MessageTriggerTemplateKey.SERVICE_INFO,
        triggerJobId: overrides.triggerJobId ?? "job-1",
        receiver: overrides.receiver ?? "010-1234-5678",
        clientId: overrides.clientId ?? 101,
        recipientPhone: overrides.recipientPhone ?? "010-1234-5678",
        messageBody: overrides.messageBody ?? "고객 등록 안내 메시지",
        variables: overrides.variables ?? { clientName: "김고객" },
        status: overrides.status ?? "sent",
        aligoMid: overrides.aligoMid ?? "mid-1",
        errorMessage: overrides.errorMessage ?? null,
        attempts: overrides.attempts ?? 1,
        lastAttemptAt: overrides.lastAttemptAt ?? new Date("2025-01-03T09:01:00.000Z"),
        nextRetryAt: overrides.nextRetryAt ?? null,
        createdAt: overrides.createdAt ?? new Date("2025-01-03T09:00:00.000Z"),
        updatedAt: overrides.updatedAt ?? new Date("2025-01-03T09:01:00.000Z"),
        ruleId: overrides.ruleId ?? "rule-1",
        ruleName: overrides.ruleName ?? "고객 등록 즉시 발송",
        eventType: overrides.eventType ?? MessageTriggerEventType.CLIENT_CREATED,
        offsetType: overrides.offsetType ?? MessageTriggerOffsetType.IMMEDIATE,
        offsetDays: overrides.offsetDays ?? 0,
        scheduledFor: overrides.scheduledFor ?? new Date("2025-01-03T09:00:00.000Z"),
        recipientType: overrides.recipientType ?? MessageTriggerRecipientType.CLIENT,
        recipientName: overrides.recipientName ?? "김고객",
        clientName: overrides.clientName ?? "김고객",
        employeeName: overrides.employeeName ?? null,
    });

    const createMockTemplate = (
        overrides: Partial<MessageTriggerTemplateCatalogItem> = {},
    ): MessageTriggerTemplateCatalogItem => ({
        key: overrides.key ?? MessageTriggerTemplateKey.SERVICE_INFO,
        name: overrides.name ?? "서비스 안내",
        description: overrides.description ?? "서비스 시작 전 안내",
        allowedEventTypes: overrides.allowedEventTypes ?? [MessageTriggerEventType.SERVICE_START],
        allowedRecipientTypes: overrides.allowedRecipientTypes ?? [MessageTriggerRecipientType.CLIENT],
        requiredVariables: overrides.requiredVariables ?? [{ key: "clientName", label: "고객명" }],
        providers: overrides.providers ?? {
            sms: { templateKey: "SERVICE_INFO" },
        },
    });

    beforeEach(async () => {
        triggerService = {
            listRules: jest.fn(),
            listUpcomingJobs: jest.fn(),
            listHistory: jest.fn(),
            cancelJobByUser: jest.fn(),
            createRule: jest.fn(),
            getRule: jest.fn(),
            updateRule: jest.fn(),
            deleteRule: jest.fn(),
            listTemplates: jest.fn(),
        };
        smsRetryService = {
            retryById: jest.fn(),
        };

        const mockAuthGuard = {
            canActivate: (context: ExecutionContext) => {
                const requestContext = context.switchToHttp().getRequest();
                requestContext.user = {
                    userId: "user-1",
                    branchId,
                    role: "admin",
                    branchRole: "admin",
                };
                requestContext.tenant = {
                    userId: "user-1",
                    branchId,
                    globalRole: "admin",
                    branchRole: "admin",
                };
                return true;
            },
        };

        const moduleFixture: TestingModule = await Test.createTestingModule({
            controllers: [MessageTriggerController],
            providers: [
                {
                    provide: MessageTriggerService,
                    useValue: triggerService,
                },
                {
                    provide: SmsRetryService,
                    useValue: smsRetryService,
                },
            ],
        })
            .overrideGuard(JwtGuard)
            .useValue(mockAuthGuard)
            .overrideGuard(TenantGuard)
            .useValue(mockAuthGuard)
            .compile();

        app = moduleFixture.createNestApplication();
        app.useGlobalPipes(new ValidationPipe({ transform: true }));
        await app.init();
    });

    afterEach(async () => {
        await app.close();
    });

    describe("GET /message-trigger-rules", () => {
        it("returns rules for the authenticated tenant", async () => {
            triggerService.listRules.mockResolvedValue([createMockRule()]);

            const response = await request(app.getHttpServer()).get("/message-trigger-rules");

            expect(response.status).toBe(200);
            expect(response.body).toHaveLength(1);
            expect(triggerService.listRules).toHaveBeenCalledWith(branchId);
        });
    });

    describe("GET /message-trigger-jobs/upcoming", () => {
        it("uses the default limit when the query is omitted", async () => {
            triggerService.listUpcomingJobs.mockResolvedValue([createMockUpcomingJob()]);

            const response = await request(app.getHttpServer()).get("/message-trigger-jobs/upcoming");

            expect(response.status).toBe(200);
            expect(triggerService.listUpcomingJobs).toHaveBeenCalledWith(branchId, 200);
        });

        it("rejects limits above 500", async () => {
            triggerService.listUpcomingJobs.mockResolvedValue([]);

            const response = await request(app.getHttpServer())
                .get("/message-trigger-jobs/upcoming")
                .query({ limit: 999 });

            expect(response.status).toBe(400);
            expect(triggerService.listUpcomingJobs).not.toHaveBeenCalled();
        });
    });

    describe("POST /message-trigger-jobs/:id/cancel", () => {
        it("cancels a pending job for the authenticated tenant", async () => {
            triggerService.cancelJobByUser.mockResolvedValue({ id: "job-1", status: "canceled" });

            const response = await request(app.getHttpServer())
                .post("/message-trigger-jobs/job-1/cancel");

            expect(response.status).toBe(201);
            expect(response.body).toEqual({ id: "job-1", status: "canceled" });
            expect(triggerService.cancelJobByUser).toHaveBeenCalledWith(branchId, "job-1");
        });

        it("surfaces a 409 conflict when the job can no longer be canceled", async () => {
            triggerService.cancelJobByUser.mockRejectedValue(
                new ConflictException("이미 발송되었거나 취소할 수 없는 상태입니다"),
            );

            const response = await request(app.getHttpServer())
                .post("/message-trigger-jobs/job-1/cancel");

            expect(response.status).toBe(409);
            expect(response.body.message).toBe("이미 발송되었거나 취소할 수 없는 상태입니다");
        });
    });

    describe("GET /message-logs", () => {
        it("returns history for the authenticated tenant", async () => {
            triggerService.listHistory.mockResolvedValue([createMockHistoryRecord()]);

            const response = await request(app.getHttpServer())
                .get("/message-logs")
                .query({ limit: 25 });

            expect(response.status).toBe(200);
            expect(response.body).toHaveLength(1);
            expect(triggerService.listHistory).toHaveBeenCalledWith(branchId, 25, 0);
        });

        it("passes validated skip to history lookup", async () => {
            triggerService.listHistory.mockResolvedValue([createMockHistoryRecord()]);

            const response = await request(app.getHttpServer())
                .get("/message-logs")
                .query({ limit: 25, skip: 50 });

            expect(response.status).toBe(200);
            expect(triggerService.listHistory).toHaveBeenCalledWith(branchId, 25, 50);
        });
    });

    describe("POST /message-logs/:id/retry", () => {
        it("schedules the branch-owned history log for retry", async () => {
            smsRetryService.retryById.mockResolvedValue({
                id: 77,
                status: "pending",
                templateKey: "service_record_link_sms",
            });

            const response = await request(app.getHttpServer())
                .post("/message-logs/77/retry");

            expect(response.status).toBe(201);
            expect(response.body).toMatchObject({
                id: 77,
                status: "pending",
                templateKey: "service_record_link_sms",
            });
            expect(smsRetryService.retryById).toHaveBeenCalledWith(branchId, 77);
        });

        it("rejects an invalid log id before retrying", async () => {
            const response = await request(app.getHttpServer())
                .post("/message-logs/not-a-number/retry");

            expect(response.status).toBe(400);
            expect(smsRetryService.retryById).not.toHaveBeenCalled();
        });
    });

    describe("POST /message-trigger-rules", () => {
        it("creates a rule with a valid payload", async () => {
            const createDto = {
                name: "서비스 시작 리마인드",
                isActive: true,
                eventType: "SERVICE_START",
                offsetType: "BEFORE_DAYS",
                offsetDays: 2,
                recipientType: "CLIENT",
                templateKey: "SERVICE_START_REMINDER",
            };
            triggerService.createRule.mockResolvedValue(
                createMockRule({
                    id: "rule-2",
                    name: createDto.name,
                    eventType: MessageTriggerEventType.SERVICE_START,
                    offsetType: MessageTriggerOffsetType.BEFORE_DAYS,
                    offsetDays: 2,
                    templateKey: MessageTriggerTemplateKey.SERVICE_START_REMINDER,
                }),
            );

            const response = await request(app.getHttpServer())
                .post("/message-trigger-rules")
                .send(createDto);

            expect(response.status).toBe(201);
            expect(triggerService.createRule).toHaveBeenCalledWith(
                branchId,
                expect.objectContaining({
                    name: "서비스 시작 리마인드",
                    offsetDays: 2,
                    templateKey: "SERVICE_START_REMINDER",
                }),
            );
        });

        it("creates the service information rule for seven days before service start", async () => {
            const createDto = {
                name: "서비스 시작 7일 전 서비스 안내",
                isActive: true,
                eventType: "SERVICE_START",
                offsetType: "BEFORE_DAYS",
                offsetDays: 7,
                recipientType: "CLIENT",
                templateKey: "SERVICE_INFO",
            };
            triggerService.createRule.mockResolvedValue(
                createMockRule({
                    id: "rule-service-info",
                    name: createDto.name,
                    eventType: MessageTriggerEventType.SERVICE_START,
                    offsetType: MessageTriggerOffsetType.BEFORE_DAYS,
                    offsetDays: 7,
                    templateKey: MessageTriggerTemplateKey.SERVICE_INFO,
                }),
            );

            const response = await request(app.getHttpServer())
                .post("/message-trigger-rules")
                .send(createDto);

            expect(response.status).toBe(201);
            expect(triggerService.createRule).toHaveBeenCalledWith(
                branchId,
                expect.objectContaining({
                    name: "서비스 시작 7일 전 서비스 안내",
                    eventType: "SERVICE_START",
                    offsetType: "BEFORE_DAYS",
                    offsetDays: 7,
                    recipientType: "CLIENT",
                    templateKey: "SERVICE_INFO",
                }),
            );
        });

        it("rejects invalid trigger enums", async () => {
            const response = await request(app.getHttpServer())
                .post("/message-trigger-rules")
                .send({
                    name: "잘못된 규칙",
                    isActive: true,
                    eventType: "INVALID_EVENT",
                    offsetType: "IMMEDIATE",
                    recipientType: "CLIENT",
                    templateKey: "CLIENT_WELCOME",
                });

            expect(response.status).toBe(400);
            expect(triggerService.createRule).not.toHaveBeenCalled();
        });
    });

    describe("GET /message-trigger-rules/:id", () => {
        it("fetches a single rule for the authenticated tenant", async () => {
            triggerService.getRule.mockResolvedValue(createMockRule({ id: "rule-42" }));

            const response = await request(app.getHttpServer()).get("/message-trigger-rules/rule-42");

            expect(response.status).toBe(200);
            expect(triggerService.getRule).toHaveBeenCalledWith(branchId, "rule-42");
        });
    });

    describe("PATCH /message-trigger-rules/:id", () => {
        it("updates a rule with a valid partial payload", async () => {
            triggerService.updateRule.mockResolvedValue(
                createMockRule({
                    id: "rule-42",
                    isActive: false,
                    name: "비활성 규칙",
                }),
            );

            const response = await request(app.getHttpServer())
                .patch("/message-trigger-rules/rule-42")
                .send({
                    name: "비활성 규칙",
                    isActive: false,
                });

            expect(response.status).toBe(200);
            expect(triggerService.updateRule).toHaveBeenCalledWith(
                branchId,
                "rule-42",
                expect.objectContaining({
                    name: "비활성 규칙",
                    isActive: false,
                }),
            );
        });

        it("rejects invalid numeric updates", async () => {
            const response = await request(app.getHttpServer())
                .patch("/message-trigger-rules/rule-42")
                .send({
                    offsetDays: -1,
                });

            expect(response.status).toBe(400);
            expect(triggerService.updateRule).not.toHaveBeenCalled();
        });
    });

    describe("DELETE /message-trigger-rules/:id", () => {
        it("deletes a rule for the authenticated tenant", async () => {
            triggerService.deleteRule.mockResolvedValue(undefined);

            const response = await request(app.getHttpServer()).delete("/message-trigger-rules/rule-42");

            expect(response.status).toBe(200);
            expect(triggerService.deleteRule).toHaveBeenCalledWith(branchId, "rule-42");
        });
    });

    describe("GET /message-trigger-templates", () => {
        it("passes SMS catalog filters through to the service", async () => {
            triggerService.listTemplates.mockResolvedValue([createMockTemplate()]);

            const response = await request(app.getHttpServer())
                .get("/message-trigger-templates")
                .query({
                    eventType: "SERVICE_START",
                    recipientType: "CLIENT",
                });

            expect(response.status).toBe(200);
            expect(response.body).toHaveLength(1);
            expect(triggerService.listTemplates).toHaveBeenCalledWith({
                eventType: "SERVICE_START",
                recipientType: "CLIENT",
            });
        });
    });
});
