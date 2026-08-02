import { NotificationService } from "application/services/notification.service";
import { NotificationEntity } from "domain/entities/notification.entity";
import { UserEntity } from "domain/entities/user.entity";

describe("NotificationService", () => {
    const branchId = "branch-1";
    const createUser = (id: string): UserEntity =>
        UserEntity.reconstitute(
            id,
            null,
            `${id}@example.com`,
            `사용자 ${id}`,
            null,
            "user",
            new Date("2026-05-01T00:00:00.000Z"),
            null,
            true,
            new Date("2026-05-01T00:00:00.000Z"),
            "email",
        );

    const subscribePushUsecase = { execute: jest.fn() };
    const unsubscribePushUsecase = { execute: jest.fn() };
    const sendNotificationUsecase = { execute: jest.fn(), broadcast: jest.fn(), sendToUsers: jest.fn() };
    const getNotificationsUsecase = { execute: jest.fn(), getUnread: jest.fn(), countUnread: jest.fn() };
    const markNotificationReadUsecase = { execute: jest.fn(), markAllAsRead: jest.fn() };
    const getVapidKeyUsecase = { execute: jest.fn() };
    const userRepository = {
        findById: jest.fn(),
        findByKakaoId: jest.fn(),
        findByEmail: jest.fn(),
        findByRoles: jest.fn(),
        findNotificationRecipientsByBranchId: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
    };
    const emailPort = {
        send: jest.fn(),
        sendNotificationEmail: jest.fn(),
    };
    const systemSettingService = { getUserEmailNotificationsEnabled: jest.fn() };

    let service: NotificationService;
    let originalNotificationEmailEnabled: string | undefined;

    beforeEach(() => {
        originalNotificationEmailEnabled = process.env["NOTIFICATION_EMAIL_ENABLED"];
        process.env["NOTIFICATION_EMAIL_ENABLED"] = "true";

        service = new NotificationService(
            subscribePushUsecase as never,
            unsubscribePushUsecase as never,
            sendNotificationUsecase as never,
            getNotificationsUsecase as never,
            markNotificationReadUsecase as never,
            getVapidKeyUsecase as never,
            userRepository as never,
            emailPort as never,
            systemSettingService as never,
        );

        userRepository.findById.mockResolvedValue(null);
        userRepository.findNotificationRecipientsByBranchId.mockResolvedValue([
            createUser("user-1"),
            createUser("user-2"),
            createUser("user-1"),
        ]);
        getNotificationsUsecase.execute.mockResolvedValue([]);
        sendNotificationUsecase.execute.mockImplementation((branchid: string, params: { userId: string }) =>
            Promise.resolve(NotificationEntity.create(params.userId, "title", "body", { branchid }))
        );
    });

    afterEach(() => {
        if (originalNotificationEmailEnabled === undefined) {
            delete process.env["NOTIFICATION_EMAIL_ENABLED"];
        } else {
            process.env["NOTIFICATION_EMAIL_ENABLED"] = originalNotificationEmailEnabled;
        }
        jest.clearAllMocks();
    });

    it("should persist notifications for unique branch users", async () => {
        await expect(
            service.sendToBranchUsers(
                branchId,
                "전자문서 검토 필요",
                "검토가 필요합니다.",
                { type: "eformsign-review-required", documentId: "doc-1" },
            )
        ).resolves.toEqual({ sent: 2, failed: 0 });

        expect(sendNotificationUsecase.execute).toHaveBeenCalledTimes(2);
        expect(sendNotificationUsecase.execute).toHaveBeenCalledWith(
            branchId,
            expect.objectContaining({ userId: "user-1" }),
        );
        expect(sendNotificationUsecase.execute).toHaveBeenCalledWith(
            branchId,
            expect.objectContaining({ userId: "user-2" }),
        );
    });

    it("should preserve in-app notifications without sending email when globally disabled", async () => {
        process.env["NOTIFICATION_EMAIL_ENABLED"] = "false";
        const savedNotification = NotificationEntity.create("user-1", "title", "body");
        sendNotificationUsecase.execute.mockResolvedValue(savedNotification);

        await expect(
            service.sendNotification(branchId, "user-1", "title", "body"),
        ).resolves.toBe(savedNotification);

        expect(emailPort.send).not.toHaveBeenCalled();
        expect(emailPort.sendNotificationEmail).not.toHaveBeenCalled();
        expect(systemSettingService.getUserEmailNotificationsEnabled).not.toHaveBeenCalled();
    });

    it("should skip deduped branch notifications for the same document", async () => {
        getNotificationsUsecase.execute.mockResolvedValueOnce([
            NotificationEntity.create("user-1", "old", "old", {
                type: "eformsign-review-required",
                documentId: "doc-1",
            }),
        ]);

        await expect(
            service.sendToBranchUsers(
                branchId,
                "전자문서 검토 필요",
                "검토가 필요합니다.",
                { type: "eformsign-review-required", documentId: "doc-1" },
                {
                    dedupe: {
                        type: "eformsign-review-required",
                        documentId: "doc-1",
                    },
                },
            )
        ).resolves.toEqual({ sent: 1, failed: 0 });

        expect(sendNotificationUsecase.execute).toHaveBeenCalledTimes(1);
        expect(sendNotificationUsecase.execute).toHaveBeenCalledWith(
            branchId,
            expect.objectContaining({ userId: "user-2" }),
        );
    });

    it("should throttle role notification emails instead of sending every email at once", async () => {
        jest.useFakeTimers();

        const emailResolvers: Array<() => void> = [];
        userRepository.findByRoles.mockResolvedValue([
            createUser("user-1"),
            createUser("user-2"),
            createUser("user-3"),
        ]);
        userRepository.findById.mockImplementation((userId: string) =>
            Promise.resolve(createUser(userId))
        );
        systemSettingService.getUserEmailNotificationsEnabled.mockResolvedValue(true);
        sendNotificationUsecase.sendToUsers.mockResolvedValue({ sent: 3, failed: 0 });
        emailPort.send.mockImplementation(() =>
            new Promise((resolve) => {
                emailResolvers.push(() => resolve("email-id"));
            })
        );

        const sendPromise = service.sendToRoles(
            ["admin", "manager", "user"],
            "서비스 종료 예정",
            "일주일 내로 종료되는 서비스 3건을 확인해 보세요",
        );

        try {
            for (let i = 0; i < 10; i++) {
                await jest.advanceTimersByTimeAsync(0);
            }

            expect(emailPort.send).toHaveBeenCalledTimes(1);
            emailResolvers.shift()?.();
            await Promise.resolve();

            await jest.advanceTimersByTimeAsync(500);
            expect(emailPort.send).toHaveBeenCalledTimes(1);

            await jest.advanceTimersByTimeAsync(100);
            expect(emailPort.send).toHaveBeenCalledTimes(2);
            emailResolvers.shift()?.();
            await Promise.resolve();

            await jest.advanceTimersByTimeAsync(600);
            expect(emailPort.send).toHaveBeenCalledTimes(3);
            emailResolvers.shift()?.();
            await expect(sendPromise).resolves.toEqual({ sent: 3, failed: 0 });
            expect(emailPort.send).toHaveBeenCalledTimes(3);
        } finally {
            jest.useRealTimers();
        }
    });

    it("should send templated notification emails with dynamic body and CTA label", async () => {
        userRepository.findByRoles.mockResolvedValue([createUser("user-1")]);
        userRepository.findById.mockResolvedValue(createUser("user-1"));
        systemSettingService.getUserEmailNotificationsEnabled.mockResolvedValue(true);
        sendNotificationUsecase.sendToUsers.mockResolvedValue({ sent: 1, failed: 0 });
        emailPort.sendNotificationEmail.mockResolvedValue("template-email-id");

        await expect(
            service.sendToRoles(
                ["admin", "manager", "user"],
                "서비스 시작 예정",
                "일주일 내로 시작되는 서비스 6건을 확인해 보세요",
                { url: "/clients/filtered?filter=starting-soon" },
                {
                    ctaUrl: "https://example.com/login",
                    ctaLabel: "로그인해서 확인하기",
                },
            )
        ).resolves.toEqual({ sent: 1, failed: 0 });

        expect(emailPort.sendNotificationEmail).toHaveBeenCalledWith({
            to: "user-1@example.com",
            name: "사용자 user-1",
            title: "서비스 시작 예정",
            body: "일주일 내로 시작되는 서비스 6건을 확인해 보세요",
            ctaUrl: "https://example.com/login",
            ctaLabel: "로그인해서 확인하기",
        });
        expect(emailPort.send).not.toHaveBeenCalled();
    });
});
