import {
    BadGatewayException,
    BadRequestException,
    ServiceUnavailableException,
} from "@nestjs/common";
import { AligoService } from "application/services/aligo.service";
import { MessageSenderApprovalService } from "application/services/message-sender-approval.service";
import { PrismaService } from "infrastructure/database/prisma.service";
import { MessageDeliveryController } from "interface/controllers/message-delivery.controller";

describe("MessageDeliveryController", () => {
    let controller: MessageDeliveryController;
    let aligoService: jest.Mocked<Pick<AligoService, "sendSms">>;
    let messageSenderApprovalService: jest.Mocked<Pick<MessageSenderApprovalService, "ensureApproved">>;
    let prismaService: {
        client: { findFirst: jest.Mock };
        message_log: { create: jest.Mock; update: jest.Mock };
    };

    beforeEach(() => {
        aligoService = {
            sendSms: jest.fn(),
        };
        messageSenderApprovalService = {
            ensureApproved: jest.fn().mockResolvedValue(undefined),
        };
        prismaService = {
            client: {
                findFirst: jest.fn(),
            },
            message_log: {
                create: jest.fn().mockResolvedValue({
                    id: 42,
                    variables: {
                        triggerType: "immediate",
                    },
                }),
                update: jest.fn().mockResolvedValue({}),
            },
        };
        controller = new MessageDeliveryController(
            aligoService as unknown as AligoService,
            messageSenderApprovalService as unknown as MessageSenderApprovalService,
            prismaService as unknown as PrismaService,
        );
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    it("should reject scheduled requests that are less than 10 minutes ahead in KST", async () => {
        jest.spyOn(Date, "now").mockReturnValue(new Date("2026-03-09T11:00:00.000Z").getTime());

        await expect(
            controller.sendSms(
                { branchId: "org-1" },
                {
                    receiver: "01012345678",
                    message: "테스트",
                    triggerType: "scheduled",
                    scheduledDate: "2026-03-09",
                    scheduledTime: "20:05",
                },
            ),
        ).rejects.toThrow(BadRequestException);

        expect(aligoService.sendSms).not.toHaveBeenCalled();
        expect(prismaService.message_log.create).not.toHaveBeenCalled();
    });

    it.each([
        { scheduledDate: "2026-02-30", scheduledTime: "12:00", reason: "impossible calendar day" },
        { scheduledDate: "2026-02-28", scheduledTime: "24:00", reason: "midnight overflow" },
        { scheduledDate: "2026-03-01", scheduledTime: "24:01", reason: "out-of-range time" },
        { scheduledDate: "2026-03-01", scheduledTime: "12:60", reason: "minute overflow" },
        { scheduledDate: "2026-2-01", scheduledTime: "12:00", reason: "malformed date" },
    ])("should reject $reason before creating a log or calling Aligo", async ({ scheduledDate, scheduledTime }) => {
        jest.spyOn(Date, "now").mockReturnValue(new Date("2026-01-01T00:00:00.000Z").getTime());

        await expect(
            controller.sendSms(
                { branchId: "org-1" },
                {
                    receiver: "01012345678",
                    message: "테스트 예약 발송",
                    triggerType: "scheduled",
                    scheduledDate,
                    scheduledTime,
                },
            ),
        ).rejects.toThrow(BadRequestException);

        expect(aligoService.sendSms).not.toHaveBeenCalled();
        expect(prismaService.message_log.create).not.toHaveBeenCalled();
    });

    it("should reject a scheduled request with missing date or time before side effects", async () => {
        await expect(
            controller.sendSms(
                { branchId: "org-1" },
                {
                    receiver: "01012345678",
                    message: "필수 예약 값 누락",
                    triggerType: "scheduled",
                },
            ),
        ).rejects.toThrow(BadRequestException);

        expect(aligoService.sendSms).not.toHaveBeenCalled();
        expect(prismaService.message_log.create).not.toHaveBeenCalled();
    });

    it("should normalize scheduled fields for the Aligo request and response payload", async () => {
        jest.spyOn(Date, "now").mockReturnValue(new Date("2026-03-09T11:00:00.000Z").getTime());
        aligoService.sendSms.mockResolvedValue({
            request: {
                senderPhone: "0212345678",
                receiver: "01012345678",
                msgType: "LMS",
                scheduledDate: "20260309",
                scheduledTime: "2015",
                testModeYn: "Y",
            },
            response: {
                result_code: 1,
                message: "성공적으로 전송요청 하였습니다.",
                msg_id: 321,
                success_cnt: 1,
                error_cnt: 0,
                msg_type: "LMS",
            },
        });

        const result = await controller.sendSms(
            { branchId: "org-1" },
            {
                receiver: "010-1234-5678",
                recipientName: "김산모",
                message: "장문 테스트 메시지",
                title: "안내",
                triggerType: "scheduled",
                scheduledDate: "2026-03-09",
                scheduledTime: "20:15",
                testMode: true,
            },
        );

        expect(aligoService.sendSms).toHaveBeenCalledWith({
            receiver: "010-1234-5678",
            message: "장문 테스트 메시지",
            recipientName: "김산모",
            title: "안내",
            msgType: undefined,
            scheduledDate: "20260309",
            scheduledTime: "2015",
            testMode: true,
        });
        expect(result).toEqual({
            provider: "aligo_sms",
            triggerType: "scheduled",
            request: {
                senderPhone: "0212345678",
                receiver: "01012345678",
                msgType: "LMS",
                scheduledAt: "202603092015",
                testMode: true,
            },
            result: {
                resultCode: 1,
                message: "성공적으로 전송요청 하였습니다.",
                msgId: 321,
                successCount: 1,
                errorCount: 0,
                msgType: "LMS",
            },
        });
        expect(prismaService.message_log.create).toHaveBeenCalledWith({
            data: expect.objectContaining({
                branchId: "org-1",
                provider: "aligo_sms",
                templateKey: "안내",
                receiver: "010-1234-5678",
                status: "pending",
                attempts: 0,
            }),
        });
        expect(prismaService.message_log.update).toHaveBeenCalledWith({
            where: { id: 42 },
            data: expect.objectContaining({
                receiver: "01012345678",
                recipientPhone: "01012345678",
                status: "pending",
                aligoMid: "321",
                errorMessage: null,
                attempts: 1,
            }),
        });
    });

    it("should accept successful Aligo SMS responses when numeric fields arrive as strings", async () => {
        aligoService.sendSms.mockResolvedValue({
            request: {
                senderPhone: "0212345678",
                receiver: "01012345678",
                msgType: "SMS",
                testModeYn: "N",
            },
            response: {
                result_code: "1" as unknown as number,
                message: "success",
                msg_id: "123" as unknown as number,
                success_cnt: "1" as unknown as number,
                error_cnt: "0" as unknown as number,
                msg_type: "SMS",
            },
        });

        await expect(
            controller.sendSms(
                { branchId: "org-1" },
                {
                    receiver: "01012345678",
                    message: "테스트 발송 본문",
                    triggerType: "immediate",
                    msgType: "AUTO",
                },
            ),
        ).resolves.toMatchObject({
            provider: "aligo_sms",
            triggerType: "immediate",
            result: {
                message: "success",
            },
        });

        expect(prismaService.message_log.update).toHaveBeenCalledWith({
            where: { id: 42 },
            data: expect.objectContaining({
                status: "sent",
                errorMessage: null,
            }),
        });
        expect(prismaService.client.findFirst).not.toHaveBeenCalled();
    });

    it.each([
        { description: "an omitted client ID", clientId: undefined },
        { description: "an explicit null client ID", clientId: null },
    ])("should treat $description as an unassociated SMS", async ({ clientId }) => {
        aligoService.sendSms.mockResolvedValue({
            request: {
                senderPhone: "0212345678",
                receiver: "01012345678",
                msgType: "SMS",
                testModeYn: "N",
            },
            response: {
                result_code: 1,
                message: "success",
                msg_id: 123,
                success_cnt: 1,
                error_cnt: 0,
                msg_type: "SMS",
            },
        });

        await expect(
            controller.sendSms(
                { branchId: "branch-a" },
                {
                    receiver: "01012345678",
                    message: "연결되지 않은 수신자 안내",
                    ...(clientId === undefined ? {} : { clientId }),
                },
            ),
        ).resolves.toMatchObject({ provider: "aligo_sms" });

        expect(prismaService.client.findFirst).not.toHaveBeenCalled();
        expect(prismaService.message_log.create).toHaveBeenCalledWith({
            data: expect.objectContaining({
                branchId: "branch-a",
                clientId: null,
            }),
        });
    });

    it("should reject a client from another branch before approval, history, or provider side effects", async () => {
        prismaService.client.findFirst.mockResolvedValue(null);

        await expect(
            controller.sendSms(
                { branchId: "branch-a" },
                {
                    receiver: "01012345678",
                    message: "다른 지점 고객 오염 시도",
                    clientId: 7,
                },
            ),
        ).rejects.toThrow("Client not found for branch");

        expect(prismaService.client.findFirst).toHaveBeenCalledWith({
            where: { id: 7, branchId: "branch-a" },
            select: { id: true },
        });
        expect(messageSenderApprovalService.ensureApproved).not.toHaveBeenCalled();
        expect(prismaService.message_log.create).not.toHaveBeenCalled();
        expect(prismaService.message_log.update).not.toHaveBeenCalled();
        expect(aligoService.sendSms).not.toHaveBeenCalled();
    });

    it("should preserve the client association for a same-branch manual SMS", async () => {
        prismaService.client.findFirst.mockResolvedValue({ id: 7 });
        aligoService.sendSms.mockResolvedValue({
            request: {
                senderPhone: "0212345678",
                receiver: "01012345678",
                msgType: "SMS",
                testModeYn: "N",
            },
            response: {
                result_code: 1,
                message: "success",
                msg_id: 123,
                success_cnt: 1,
                error_cnt: 0,
                msg_type: "SMS",
            },
        });

        await expect(
            controller.sendSms(
                { branchId: "branch-a" },
                {
                    receiver: "01012345678",
                    message: "같은 지점 고객 안내",
                    clientId: 7,
                },
            ),
        ).resolves.toMatchObject({ provider: "aligo_sms" });

        expect(prismaService.client.findFirst).toHaveBeenCalledWith({
            where: { id: 7, branchId: "branch-a" },
            select: { id: true },
        });
        expect(prismaService.message_log.create).toHaveBeenCalledWith({
            data: expect.objectContaining({ branchId: "branch-a", clientId: 7 }),
        });
        expect(aligoService.sendSms).toHaveBeenCalledTimes(1);
    });

    it("should record failed logs and reject when Aligo does not accept the SMS request", async () => {
        jest.spyOn(Date, "now").mockReturnValue(new Date("2026-06-05T09:20:00.000Z").getTime());
        aligoService.sendSms.mockResolvedValue({
            request: {
                senderPhone: "0212345678",
                receiver: "01012345678",
                msgType: "LMS",
                testModeYn: "N",
            },
            response: {
                result_code: -101,
                message: "수신번호 형식이 올바르지 않습니다.",
                error_cnt: 1,
                msg_type: "LMS",
            },
        });

        await expect(
            controller.sendSms(
                { branchId: "org-1" },
                {
                    receiver: "01012345678",
                    message: "테스트 발송 본문",
                    title: "안내",
                    triggerType: "immediate",
                    msgType: "AUTO",
                },
            ),
        ).rejects.toThrow(BadGatewayException);

        expect(prismaService.message_log.update).toHaveBeenCalledWith({
            where: { id: 42 },
            data: expect.objectContaining({
                receiver: "01012345678",
                recipientPhone: "01012345678",
                status: "failed",
                errorMessage: "수신번호 형식이 올바르지 않습니다.",
                attempts: 1,
                nextRetryAt: new Date("2026-06-05T09:25:00.000Z"),
            }),
        });
    });

    it("should not schedule auto-retry on partial-success batches (would duplicate to already-delivered recipients)", async () => {
        jest.spyOn(Date, "now").mockReturnValue(new Date("2026-06-05T09:20:00.000Z").getTime());
        aligoService.sendSms.mockResolvedValue({
            request: {
                senderPhone: "0212345678",
                receiver: "01012345678,01099999999",
                msgType: "SMS",
                testModeYn: "N",
            },
            response: {
                result_code: 1,
                message: "일부 수신번호 형식이 올바르지 않습니다.",
                success_cnt: 1,
                error_cnt: 1,
                msg_type: "SMS",
            },
        });

        await expect(
            controller.sendSms(
                { branchId: "org-1" },
                {
                    receiver: "01012345678,01099999999",
                    message: "테스트 발송 본문",
                    title: "안내",
                    triggerType: "immediate",
                    msgType: "AUTO",
                },
            ),
        ).rejects.toThrow(BadGatewayException);

        expect(prismaService.message_log.update).toHaveBeenCalledWith({
            where: { id: 42 },
            data: expect.objectContaining({
                status: "failed",
                recipientPhone: "01012345678,01099999999",
                nextRetryAt: null,
                errorMessage: expect.stringContaining("부분 발송"),
            }),
        });
    });

    it("should record a failed log and reject when Aligo rejects the SMS request before returning a result body", async () => {
        jest.spyOn(Date, "now").mockReturnValue(new Date("2026-06-05T09:20:00.000Z").getTime());
        aligoService.sendSms.mockRejectedValue(
            new Error("Aligo SMS API error (403): 등록되지 않은 IP 입니다."),
        );

        await expect(
            controller.sendSms(
                { branchId: "org-1" },
                {
                    receiver: "01012345678",
                    message: "테스트 발송 본문",
                    title: "안내",
                    triggerType: "immediate",
                    msgType: "AUTO",
                },
            ),
        ).rejects.toThrow(BadGatewayException);

        expect(prismaService.message_log.update).toHaveBeenCalledWith({
            where: { id: 42 },
            data: expect.objectContaining({
                status: "failed",
                errorMessage: "Aligo SMS API error (403): 등록되지 않은 IP 입니다.",
                attempts: 1,
                nextRetryAt: new Date("2026-06-05T09:25:00.000Z"),
            }),
        });
    });

    it("should not call the provider when the initial delivery record cannot be created", async () => {
        prismaService.message_log.create.mockRejectedValue(new Error("database unavailable"));

        await expect(
            controller.sendSms(
                { branchId: "org-1" },
                {
                    receiver: "01012345678",
                    message: "테스트 발송 본문",
                    triggerType: "immediate",
                },
            ),
        ).rejects.toThrow(ServiceUnavailableException);

        expect(aligoService.sendSms).not.toHaveBeenCalled();
    });

    it("should surface a partial persistence failure while keeping the pre-created record", async () => {
        aligoService.sendSms.mockResolvedValue({
            request: {
                senderPhone: "0212345678",
                receiver: "01012345678",
                msgType: "SMS",
                testModeYn: "N",
            },
            response: {
                result_code: 1,
                message: "success",
                msg_id: 123,
                success_cnt: 1,
                error_cnt: 0,
                msg_type: "SMS",
            },
        });
        prismaService.message_log.update.mockRejectedValue(new Error("database unavailable"));

        await expect(
            controller.sendSms(
                { branchId: "org-1" },
                {
                    receiver: "01012345678",
                    message: "테스트 발송 본문",
                    triggerType: "immediate",
                },
            ),
        ).rejects.toThrow(
            "문자 공급자에는 접수되었지만 발송 기록 상태를 갱신하지 못했습니다.",
        );

        expect(prismaService.message_log.create).toHaveBeenCalledTimes(1);
        expect(aligoService.sendSms).toHaveBeenCalledTimes(1);
    });
});
