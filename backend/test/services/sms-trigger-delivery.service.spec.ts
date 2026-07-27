import { Prisma } from "@prisma/client";
import { AligoService } from "application/services/aligo.service";
import {
    SmsTriggerDeliveryService,
    SMS_TEMPLATE_DELIVERY,
} from "application/services/sms-trigger-delivery.service";
import { SystemTemplateService } from "application/services/system-template.service";
import { SystemTemplateKey } from "domain/constants/system-template-registry";
import {
    MessageTriggerRecipientType,
    MessageTriggerTemplateKey,
} from "domain/constants/message-trigger-catalog";
import { MessageTriggerJobEntity } from "domain/entities/message-trigger-job.entity";
import { TriggerJobDeferredError } from "domain/errors/trigger-job-deferred.error";
import { MessageLogEntity } from "domain/entities/message-log.entity";
import { IMessageLogRepository } from "domain/repositories/message-log.repository.interface";

describe("SmsTriggerDeliveryService", () => {
    const branchId = "branch-1";

    const captureError = async (promise: Promise<unknown>): Promise<unknown> => {
        try {
            await promise;
            return undefined;
        } catch (error) {
            return error;
        }
    };

    const createServiceInfoJob = () =>
        MessageTriggerJobEntity.reconstitute(
            "job-service-info",
            branchId,
            "rule-service-info",
            "pending",
            new Date("2026-06-12T00:00:00.000Z"),
            null,
            null,
            null,
            7,
            null,
            MessageTriggerRecipientType.CLIENT,
            "010-1234-5678",
            MessageTriggerTemplateKey.SERVICE_INFO,
            "rule-service-info:7",
            {
                clientId: 7,
                clientName: "김지니",
                memberId: "7",
                recipientName: "김지니",
                recipientPhone: "010-1234-5678",
                templateVariables: {
                    name: "김지니",
                    clientName: "김지니",
                },
            },
            new Date("2026-06-05T00:00:00.000Z"),
            new Date("2026-06-05T00:00:00.000Z"),
        );

    const createTransientPrismaError = () =>
        new Prisma.PrismaClientKnownRequestError("Can't reach database server", {
            code: "P1001",
            clientVersion: "test",
        });

    it("sends the service information trigger through SMS instead of alimtalk", async () => {
        const aligoService = {
            sendSms: jest.fn().mockResolvedValue({
                request: {
                    senderPhone: "01099998888",
                    receiver: "01012345678",
                    msgType: "LMS",
                    testModeYn: "N",
                },
                response: {
                    result_code: 1,
                    message: "성공적으로 전송요청 하였습니다.",
                    msg_id: 321,
                    success_cnt: 1,
                    error_cnt: 0,
                    msg_type: "LMS",
                },
            }),
        };
        const systemTemplateService = {
            getByKey: jest.fn().mockResolvedValue({
                content: "{{name}} 산모님 서비스 안내",
            }),
        };
        const logRepository = {
            save: jest.fn().mockImplementation(async (log: MessageLogEntity) => log),
        };
        const service = new SmsTriggerDeliveryService(
            aligoService as unknown as AligoService,
            systemTemplateService as unknown as SystemTemplateService,
            logRepository as unknown as IMessageLogRepository,
        );

        await expect(service.sendJob(createServiceInfoJob())).resolves.toBe(true);

        expect(systemTemplateService.getByKey).toHaveBeenCalledWith(SystemTemplateKey.SERVICE_INFO);
        expect(aligoService.sendSms).toHaveBeenCalledWith({
            receiver: "010-1234-5678",
            message: "김지니 산모님 서비스 안내",
            recipientName: "김지니",
            title: "서비스 안내",
            msgType: "AUTO",
        });
        const savedLog = logRepository.save.mock.calls[0]?.[0] as MessageLogEntity;
        expect(savedLog.provider).toBe("aligo_sms");
        expect(savedLog.templateKey).toBe("service_info_sms");
        expect(savedLog.triggerJobId).toBe("job-service-info");
        expect(savedLog.receiver).toBe("01012345678");
        expect(savedLog.recipientName).toBe("김지니");
        expect(savedLog.recipientPhone).toBe("010-1234-5678");
        expect(savedLog.messageBody).toBe("김지니 산모님 서비스 안내");
        expect(savedLog.status).toBe("sent");
        expect(savedLog.aligoMid).toBe("321");
        expect(savedLog.variables).toEqual(expect.objectContaining({
            automationKey: "SERVICE_INFO_SMS",
            systemTemplateKey: SystemTemplateKey.SERVICE_INFO,
            name: "김지니",
            recipientName: "김지니",
        }));
    });

    it("sends a CLIENT_WELCOME job through Aligo and records the SMS contract", async () => {
        const job = MessageTriggerJobEntity.reconstitute(
            "job-client-welcome",
            branchId,
            "rule-client-welcome",
            "pending",
            new Date("2026-07-17T00:00:00.000Z"),
            null,
            null,
            null,
            7,
            null,
            MessageTriggerRecipientType.CLIENT,
            "010-1234-5678",
            MessageTriggerTemplateKey.CLIENT_WELCOME,
            "rule-client-welcome:7",
            {
                clientId: 7,
                clientName: "김산모",
                memberId: "7",
                recipientName: "김산모",
                recipientPhone: "010-1234-5678",
                templateVariables: {
                    clientName: "김산모",
                    registrationDate: "2026-07-17",
                    serviceType: "바우처",
                },
            },
            new Date("2026-07-17T00:00:00.000Z"),
            new Date("2026-07-17T00:00:00.000Z"),
        );
        const aligoService = {
            sendSms: jest.fn().mockResolvedValue({
                request: { receiver: "01012345678", msgType: "LMS", testModeYn: "N" },
                response: { result_code: 1, message: "성공", msg_id: 275, success_cnt: 1, error_cnt: 0 },
            }),
        };
        const systemTemplateService = {
            getByKey: jest.fn().mockResolvedValue({
                content: "{{clientName}}님 {{registrationDate}} 등록 완료 ({{serviceType}})",
            }),
        };
        const logRepository = { save: jest.fn().mockImplementation(async (log: MessageLogEntity) => log) };
        const service = new SmsTriggerDeliveryService(
            aligoService as unknown as AligoService,
            systemTemplateService as unknown as SystemTemplateService,
            logRepository as unknown as IMessageLogRepository,
        );

        await expect(service.sendJob(job)).resolves.toBe(true);

        expect(systemTemplateService.getByKey).toHaveBeenCalledWith(SystemTemplateKey.CLIENT_WELCOME);
        expect(aligoService.sendSms).toHaveBeenCalledWith(expect.objectContaining({
            receiver: "010-1234-5678",
            message: "김산모님 2026-07-17 등록 완료 (바우처)",
            title: "고객 등록 안내",
        }));
        const savedLog = logRepository.save.mock.calls[0]?.[0] as MessageLogEntity;
        expect(savedLog.templateKey).toBe("client_welcome_sms");
        expect(savedLog.status).toBe("sent");
        expect(savedLog.variables).toEqual(expect.objectContaining({
            automationKey: "CLIENT_WELCOME_SMS",
            systemTemplateKey: SystemTemplateKey.CLIENT_WELCOME,
        }));
    });

    it("sends the CLIENT_GREETING trigger through SMS with the same log contract as the retired sender", async () => {
        const greetingJob = MessageTriggerJobEntity.reconstitute(
            "job-greeting-1",
            branchId,
            "rule-greeting-1",
            "pending",
            new Date("2026-06-27T00:00:00.000Z"),
            null,
            null,
            null,
            0,
            42,
            MessageTriggerRecipientType.CLIENT,
            "010-5678-1234",
            MessageTriggerTemplateKey.CLIENT_GREETING,
            "rule-greeting-1:client:42",
            {
                clientId: 42,
                clientName: "김산모",
                memberId: "42",
                recipientName: "김산모",
                recipientPhone: "010-5678-1234",
                templateVariables: {
                    name: "김산모",
                    clientName: "김산모",
                    phone: "010-5678-1234",
                },
            },
            new Date("2026-06-27T00:00:00.000Z"),
            new Date("2026-06-27T00:00:00.000Z"),
        );

        const aligoService = {
            sendSms: jest.fn().mockResolvedValue({
                request: {
                    senderPhone: "01099998888",
                    receiver: "01056781234",
                    msgType: "LMS",
                    testModeYn: "N",
                },
                response: {
                    result_code: 1,
                    message: "성공적으로 전송요청 하였습니다.",
                    msg_id: 999,
                    success_cnt: 1,
                    error_cnt: 0,
                    msg_type: "LMS",
                },
            }),
        };
        const systemTemplateService = {
            getByKey: jest.fn().mockResolvedValue({
                content: "{{name}}님 안녕하세요! 아이미래입니다.",
            }),
        };
        const logRepository = {
            save: jest.fn().mockImplementation(async (log: MessageLogEntity) => log),
        };
        const service = new SmsTriggerDeliveryService(
            aligoService as unknown as AligoService,
            systemTemplateService as unknown as SystemTemplateService,
            logRepository as unknown as IMessageLogRepository,
        );

        await expect(service.sendJob(greetingJob)).resolves.toBe(true);

        expect(systemTemplateService.getByKey).toHaveBeenCalledWith(SystemTemplateKey.GREETING);
        expect(aligoService.sendSms).toHaveBeenCalledWith({
            receiver: "010-5678-1234",
            message: "김산모님 안녕하세요! 아이미래입니다.",
            recipientName: "김산모",
            title: "인사 메시지",
            msgType: "AUTO",
        });

        // Verify the log matches the retired ClientGreetingSmsAutomationService byte-for-byte
        const savedLog = logRepository.save.mock.calls[0]?.[0] as MessageLogEntity;
        expect(savedLog.provider).toBe("aligo_sms");
        expect(savedLog.templateKey).toBe("client_greeting_sms");
        expect(savedLog.triggerJobId).toBe("job-greeting-1");
        expect(savedLog.recipientName).toBe("김산모");
        expect(savedLog.recipientPhone).toBe("010-5678-1234");
        expect(savedLog.status).toBe("sent");
        expect(savedLog.aligoMid).toBe("999");
        expect(savedLog.variables).toEqual(expect.objectContaining({
            automationKey: "CLIENT_GREETING_SMS",
            systemTemplateKey: SystemTemplateKey.GREETING,
            triggerType: "client_created",
            title: "인사 메시지",
            recipientName: "김산모",
        }));
    });

    it("throws a plain error when branchId is missing", async () => {
        const aligoService = { sendSms: jest.fn() };
        const systemTemplateService = { getByKey: jest.fn() };
        const logRepository = { save: jest.fn() };
        const service = new SmsTriggerDeliveryService(
            aligoService as unknown as AligoService,
            systemTemplateService as unknown as SystemTemplateService,
            logRepository as unknown as IMessageLogRepository,
        );
        const job = createServiceInfoJob();
        job.branchId = null;

        const error = await captureError(service.sendJob(job));

        expect(error).toBeInstanceOf(Error);
        expect(error).not.toBeInstanceOf(TriggerJobDeferredError);
        expect(error).toMatchObject({
            message: "SMS trigger job job-service-info is missing branchId",
        });
        expect(aligoService.sendSms).not.toHaveBeenCalled();
        expect(logRepository.save).not.toHaveBeenCalled();
    });

    it("sms pre-provider transient DB error defers the job transiently", async () => {
        const prismaError = createTransientPrismaError();
        const aligoService = { sendSms: jest.fn() };
        const systemTemplateService = {
            getByKey: jest.fn().mockRejectedValue(prismaError),
        };
        const logRepository = { save: jest.fn() };
        const service = new SmsTriggerDeliveryService(
            aligoService as unknown as AligoService,
            systemTemplateService as unknown as SystemTemplateService,
            logRepository as unknown as IMessageLogRepository,
        );

        const error = await captureError(service.sendJob(createServiceInfoJob()));

        expect(error).toBeInstanceOf(TriggerJobDeferredError);
        expect(error).toMatchObject({
            kind: "transient",
            message: expect.stringContaining("Can't reach database server"),
        });
        expect(aligoService.sendSms).not.toHaveBeenCalled();
        expect(logRepository.save).not.toHaveBeenCalled();
    });

    it("sms post-provider transient DB error does not defer after sendSms is invoked", async () => {
        const prismaError = createTransientPrismaError();
        const aligoService = {
            sendSms: jest.fn().mockResolvedValue({
                request: {
                    senderPhone: "01099998888",
                    receiver: "01012345678",
                    msgType: "LMS",
                    testModeYn: "N",
                },
                response: {
                    result_code: 1,
                    message: "성공적으로 전송요청 하였습니다.",
                    msg_id: 321,
                    success_cnt: 1,
                    error_cnt: 0,
                    msg_type: "LMS",
                },
            }),
        };
        const systemTemplateService = {
            getByKey: jest.fn().mockResolvedValue({
                content: "{{name}} 산모님 서비스 안내",
            }),
        };
        const logRepository = { save: jest.fn().mockRejectedValue(prismaError) };
        const service = new SmsTriggerDeliveryService(
            aligoService as unknown as AligoService,
            systemTemplateService as unknown as SystemTemplateService,
            logRepository as unknown as IMessageLogRepository,
        );

        const error = await captureError(service.sendJob(createServiceInfoJob()));

        expect(error).toBe(prismaError);
        expect(error).not.toBeInstanceOf(TriggerJobDeferredError);
        expect(aligoService.sendSms).toHaveBeenCalledTimes(1);
        expect(logRepository.save).toHaveBeenCalledTimes(2);
    });
});

describe("SMS delivery routing drift guard", () => {
});

describe("SERVICE_RECORD_LINK delivery", () => {
    const serviceRecordLinkTemplate = `[사회서비스 제공자 품질평가 A등급]
안녕하세요, 인천 아이미래로 입니다 :)

{{employeeName}} 관리사님, {{clientName}} 산모님의 {{serviceStartDate}} 시작 서비스 제공기록지 작성 링크입니다.
매일 서비스 제공 완료 직전에 서비스 세부사항 기록 후에, 산모님께 승인을 받으시면 됩니다.

최초 접속 시에 관리사님의 전화번호 인증이 필요합니다. 링크 접속 후 휴대폰 번호로 본인확인하고, 방문일마다 기록을 남겨주세요.

감사합니다.

제공기록지 링크
{{serviceRecordUrl}}`;
    const renderedServiceRecordLinkMessage = `[사회서비스 제공자 품질평가 A등급]
안녕하세요, 인천 아이미래로 입니다 :)

홍제공 관리사님, 김산모 산모님의 2026-07-03 시작 서비스 제공기록지 작성 링크입니다.
매일 서비스 제공 완료 직전에 서비스 세부사항 기록 후에, 산모님께 승인을 받으시면 됩니다.

최초 접속 시에 관리사님의 전화번호 인증이 필요합니다. 링크 접속 후 휴대폰 번호로 본인확인하고, 방문일마다 기록을 남겨주세요.

감사합니다.

제공기록지 링크
https://mobile.test/service-record/efl_token`;

    const buildService = (overrides: {
        aligoService: unknown;
        logRepository: unknown;
        systemTemplateService?: unknown;
    }) =>
        new SmsTriggerDeliveryService(
            overrides.aligoService as unknown as AligoService,
            (overrides.systemTemplateService ?? { getByKey: jest.fn() }) as unknown as SystemTemplateService,
            overrides.logRepository as unknown as IMessageLogRepository,
        );

    const createServiceRecordJob = () =>
        MessageTriggerJobEntity.reconstitute(
            "job-service-record-link",
            "branch-1",
            "system:service_record_link",
            "pending",
            new Date("2026-07-03T06:00:00.000Z"),
            null,
            null,
            null,
            7,
            11,
            MessageTriggerRecipientType.PRIMARY_EMPLOYEE,
            "010-1111-2222",
            MessageTriggerTemplateKey.SERVICE_RECORD_LINK,
            "system:service_record_link:schedule:11:primary",
            {
                clientId: 7,
                clientName: "김산모",
                employeeId: 30,
                employeeName: "홍제공",
                memberId: "employee:30",
                recipientName: "홍제공",
                recipientPhone: "010-1111-2222",
                messageBody: "[아가잼잼] 김산모님 제공기록지 링크\nhttps://mobile.test/service-record/efl_token",
                templateVariables: {
                    clientName: "김산모",
                    employeeName: "홍제공",
                    serviceStartDate: "2026-07-03",
                    serviceRecordUrl: "https://mobile.test/service-record/efl_token",
                },
            },
            new Date("2026-07-02T00:00:00.000Z"),
            new Date("2026-07-02T00:00:00.000Z"),
        );

    it("renders the editable service-record system template and records it in SMS history", async () => {
        const aligoService = {
            sendSms: jest.fn().mockResolvedValue({
                request: { receiver: "01011112222", msgType: "LMS", testModeYn: "N" },
                response: { result_code: 1, message: "성공", msg_id: 123, success_cnt: 1, error_cnt: 0 },
            }),
        };
        const systemTemplateService = {
            getByKey: jest.fn().mockResolvedValue({
                content: serviceRecordLinkTemplate,
            }),
        };
        const logRepository = { save: jest.fn().mockImplementation(async (log: MessageLogEntity) => log) };
        const service = buildService({ aligoService, logRepository, systemTemplateService });

        await expect(service.sendJob(createServiceRecordJob())).resolves.toBe(true);

        expect(systemTemplateService.getByKey).toHaveBeenCalledWith(SystemTemplateKey.SERVICE_RECORD_LINK);
        expect(aligoService.sendSms).toHaveBeenCalledWith({
            receiver: "010-1111-2222",
            message: renderedServiceRecordLinkMessage,
            recipientName: "홍제공",
            title: "제공기록지 작성 링크",
            msgType: "AUTO",
        });
        const savedLog = logRepository.save.mock.calls[0]?.[0] as MessageLogEntity;
        expect(savedLog.provider).toBe("aligo_sms");
        expect(savedLog.templateKey).toBe("service_record_link_sms");
        expect(savedLog.status).toBe("sent");
        expect(savedLog.variables).toEqual(expect.objectContaining({
            automationKey: "SERVICE_RECORD_LINK_SMS",
            triggerType: "service_start_at_15",
            systemTemplateKey: SystemTemplateKey.SERVICE_RECORD_LINK,
            employeeName: "홍제공",
            serviceRecordUrl: "https://mobile.test/service-record/efl_token",
        }));
    });

    it("records a failed retryable SMS history row when Aligo rejects the service-record link message", async () => {
        const aligoService = {
            sendSms: jest.fn().mockResolvedValue({
                request: { receiver: "01011112222", msgType: "LMS", testModeYn: "N" },
                response: { result_code: -1, message: "잔액 부족", msg_id: null, success_cnt: 0, error_cnt: 1 },
            }),
        };
        const systemTemplateService = {
            getByKey: jest.fn().mockResolvedValue({
                content: serviceRecordLinkTemplate,
            }),
        };
        const logRepository = { save: jest.fn().mockImplementation(async (log: MessageLogEntity) => log) };
        const service = buildService({ aligoService, logRepository, systemTemplateService });

        await expect(service.sendJob(createServiceRecordJob())).resolves.toBe(false);

        const savedLog = logRepository.save.mock.calls[0]?.[0] as MessageLogEntity;
        expect(savedLog.templateKey).toBe("service_record_link_sms");
        expect(savedLog.status).toBe("failed");
        expect(savedLog.errorMessage).toBe("잔액 부족");
        expect(savedLog.nextRetryAt).toBeInstanceOf(Date);
    });

    it("uses the registry default when the editable service-record link template row is unavailable", async () => {
        const aligoService = {
            sendSms: jest.fn().mockResolvedValue({
                request: { receiver: "01011112222", msgType: "LMS", testModeYn: "N" },
                response: { result_code: 1, message: "성공", msg_id: 123, success_cnt: 1, error_cnt: 0 },
            }),
        };
        const systemTemplateService = {
            getByKey: jest.fn().mockRejectedValue(new Error("template row unavailable")),
        };
        const logRepository = { save: jest.fn().mockImplementation(async (log: MessageLogEntity) => log) };
        const service = buildService({ aligoService, logRepository, systemTemplateService });
        const job = createServiceRecordJob();
        job.payload.messageBody = "   ";

        await expect(service.sendJob(job)).resolves.toBe(true);

        expect(aligoService.sendSms).toHaveBeenCalledWith(expect.objectContaining({
            message: renderedServiceRecordLinkMessage,
            title: "제공기록지 작성 링크",
        }));
    });
});

describe("PRICE_INFO data guard", () => {
    const createPriceInfoJob = (templateVariables: Record<string, string>) =>
        MessageTriggerJobEntity.reconstitute(
            "job-price-info",
            "branch-1",
            "rule-price-info",
            "pending",
            new Date("2026-06-30T00:00:00.000Z"),
            null,
            null,
            null,
            7,
            null,
            MessageTriggerRecipientType.CLIENT,
            "010-1234-5678",
            MessageTriggerTemplateKey.PRICE_INFO,
            "rule-price-info:7",
            {
                clientId: 7,
                clientName: "김지니",
                memberId: "7",
                recipientName: "김지니",
                recipientPhone: "010-1234-5678",
                templateVariables,
            },
            new Date("2026-06-30T00:00:00.000Z"),
            new Date("2026-06-30T00:00:00.000Z"),
        );

    const buildService = (overrides: { aligoService: any; logRepository: any; systemTemplateService?: any }) =>
        new SmsTriggerDeliveryService(
            overrides.aligoService as unknown as AligoService,
            (overrides.systemTemplateService ?? {
                getByKey: jest.fn().mockResolvedValue({ content: "총 금액 {{fullPrice}}원 / {{bankName}} {{accNum}}" }),
            }) as unknown as SystemTemplateService,
            overrides.logRepository as unknown as IMessageLogRepository,
        );

    it("cancels a PRICE_INFO job and does not send when price/bank data is missing", async () => {
        const aligoService = { sendSms: jest.fn() };
        const logRepository = { save: jest.fn() };
        const service = buildService({ aligoService, logRepository });
        const job = createPriceInfoJob({ name: "김지니", fullPrice: "", actualPrice: "", bankName: "", accNum: "" });

        const sent = await service.sendJob(job);

        expect(sent).toBe(false);
        expect(job.status).toBe("canceled");
        expect(aligoService.sendSms).not.toHaveBeenCalled();
        expect(logRepository.save).not.toHaveBeenCalled();
    });

    it("sends a PRICE_INFO job when all essential data is present", async () => {
        const aligoService = {
            sendSms: jest.fn().mockResolvedValue({
                request: { senderPhone: "01099998888", receiver: "01012345678", msgType: "LMS", testModeYn: "N" },
                response: { result_code: 1, message: "성공", msg_id: 321, success_cnt: 1, error_cnt: 0, msg_type: "LMS" },
            }),
        };
        const logRepository = { save: jest.fn().mockImplementation(async (log) => log) };
        const service = buildService({ aligoService, logRepository });
        const job = createPriceInfoJob({
            name: "김지니",
            fullPrice: "1200000",
            grant: "1080000",
            actualPrice: "120000",
            bankName: "국민",
            accNum: "123-45-6789",
            duration: "20",
            type: "단태아 첫째아 A가1형",
        });

        const sent = await service.sendJob(job);

        expect(sent).toBe(true);
        expect(aligoService.sendSms).toHaveBeenCalledTimes(1);
        expect(logRepository.save).toHaveBeenCalledTimes(1);
    });

    it("cancels a PRICE_INFO job when the government grant is blank", async () => {
        const aligoService = { sendSms: jest.fn() };
        const logRepository = { save: jest.fn() };
        const service = buildService({ aligoService, logRepository });
        const job = createPriceInfoJob({
            name: "김지니",
            fullPrice: "1200000",
            grant: "",
            actualPrice: "120000",
            bankName: "국민",
            accNum: "123-45-6789",
            duration: "20",
            type: "단태아 첫째아 A가1형",
        });

        const sent = await service.sendJob(job);

        expect(sent).toBe(false);
        expect(job.status).toBe("canceled");
        expect(aligoService.sendSms).not.toHaveBeenCalled();
    });

    it("cancels a PRICE_INFO job when price/bank are present but duration is blank", async () => {
        const aligoService = { sendSms: jest.fn() };
        const logRepository = { save: jest.fn() };
        const service = buildService({ aligoService, logRepository });
        const job = createPriceInfoJob({
            name: "김지니",
            fullPrice: "1200000",
            grant: "1080000",
            actualPrice: "120000",
            bankName: "국민",
            accNum: "123-45-6789",
            duration: "",
            type: "단태아 첫째아 A가1형",
        });

        const sent = await service.sendJob(job);

        expect(sent).toBe(false);
        expect(job.status).toBe("canceled");
        expect(aligoService.sendSms).not.toHaveBeenCalled();
    });
});
