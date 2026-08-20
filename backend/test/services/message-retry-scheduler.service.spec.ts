import { MessageRetrySchedulerService } from "application/services/message-retry-scheduler.service";
import { SmsRetryService } from "application/services/sms-retry.service";
import { MessageLogEntity } from "domain/entities/message-log.entity";
import { IMessageLogRepository } from "domain/repositories/message-log.repository.interface";

describe("MessageRetrySchedulerService", () => {
    const createLog = (provider: string, retrySafety?: string) =>
        MessageLogEntity.reconstitute(
            provider === "aligo_sms" ? 77 : 78,
            "branch-1",
            provider,
            provider === "aligo_sms" ? "client_greeting_sms" : "CLIENT_CREATED",
            null,
            "01012345678",
            7,
            "message",
            retrySafety ? { retrySafety } : {},
            "failed",
            null,
            "retryable",
            1,
            new Date("2026-06-05T09:20:00.000Z"),
            new Date("2026-06-05T10:20:00.000Z"),
            new Date("2026-06-05T09:20:00.000Z"),
            new Date("2026-06-05T09:20:00.000Z"),
        );

    const createMockLogRepository = () => ({
        findPendingRetries: jest.fn(),
        update: jest.fn(),
    });

    let scheduler: MessageRetrySchedulerService;
    let logRepository: ReturnType<typeof createMockLogRepository>;
    let smsRetryService: { retry: jest.Mock };
    let nowSpy: jest.SpyInstance<number, []>;

    beforeEach(() => {
        logRepository = createMockLogRepository();
        smsRetryService = { retry: jest.fn().mockResolvedValue(undefined) };
        scheduler = new MessageRetrySchedulerService(
            logRepository as unknown as IMessageLogRepository,
            smsRetryService as unknown as SmsRetryService,
        );
        nowSpy = jest.spyOn(Date, "now");
        nowSpy.mockReturnValue(0);
    });

    afterEach(() => {
        nowSpy.mockRestore();
        jest.clearAllMocks();
    });

    it("retries SMS and terminates legacy Alimtalk retries", async () => {
        const smsLog = createLog("aligo_sms");
        const alimtalkLog = createLog("aligo_alimtalk");
        logRepository.findPendingRetries.mockResolvedValue([smsLog, alimtalkLog]);

        await scheduler.retryFailedMessages();

        expect(smsRetryService.retry).toHaveBeenCalledWith(smsLog);
        expect(alimtalkLog.status).toBe("failed");
        expect(alimtalkLog.nextRetryAt).toBeNull();
        expect(logRepository.update).toHaveBeenCalledWith(alimtalkLog);
    });

    it("does not resend uncertain Aligo SMS and marks it for provider-history/manual verification", async () => {
        const uncertainLog = createLog("aligo_sms", "uncertain");
        logRepository.findPendingRetries.mockResolvedValue([uncertainLog]);

        await scheduler.retryFailedMessages();

        expect(smsRetryService.retry).not.toHaveBeenCalled();
        expect(logRepository.update).toHaveBeenCalledWith(uncertainLog);
        expect(uncertainLog.status).toBe("failed");
        expect(uncertainLog.nextRetryAt).toBeNull();
        expect(uncertainLog.errorMessage).toContain("제공자 이력");
        expect(uncertainLog.errorMessage).toContain("수동 확인");
    });

    it("continues retrying provider-rejected Aligo SMS logs", async () => {
        const providerRejectedLog = createLog("aligo_sms", "provider-rejected");
        logRepository.findPendingRetries.mockResolvedValue([providerRejectedLog]);

        await scheduler.retryFailedMessages();

        expect(smsRetryService.retry).toHaveBeenCalledWith(providerRejectedLog);
        expect(logRepository.update).not.toHaveBeenCalled();
    });

    it("terminates unsupported message providers instead of retrying forever", async () => {
        const unsupportedLog = createLog("legacy_provider");
        logRepository.findPendingRetries.mockResolvedValue([unsupportedLog]);

        await scheduler.retryFailedMessages();

        expect(smsRetryService.retry).not.toHaveBeenCalled();
        expect(logRepository.update).toHaveBeenCalledWith(unsupportedLog);
        expect(unsupportedLog.errorMessage).toContain("지원이 종료된 메시지 공급자");
    });

    it("enters cooldown after transient prisma connectivity errors", async () => {
        const prismaError = Object.assign(
            new Error("Timed out fetching a new connection from the connection pool"),
            { code: "P2024" },
        );
        logRepository.findPendingRetries.mockRejectedValue(prismaError);

        await scheduler.retryFailedMessages();
        await scheduler.retryFailedMessages();

        expect(logRepository.findPendingRetries).toHaveBeenCalledTimes(1);
    });

    it("clears a stale lock and starts a fresh run", async () => {
        let releaseFirstRun: (() => void) | undefined;
        logRepository.findPendingRetries.mockImplementationOnce(
            () =>
                new Promise((resolve) => {
                    releaseFirstRun = () => resolve([]);
                }),
        );
        logRepository.findPendingRetries.mockResolvedValueOnce([]);

        const firstRun = scheduler.retryFailedMessages();

        nowSpy.mockReturnValue(16 * 60 * 1000);
        await scheduler.retryFailedMessages();

        expect(logRepository.findPendingRetries).toHaveBeenCalledTimes(2);

        releaseFirstRun?.();
        await firstRun;
    });
});
