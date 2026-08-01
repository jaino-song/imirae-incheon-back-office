import { SendNotificationUsecase } from "application/usecases/notification/send-notification.usecase";
import { NotificationEntity } from "domain/entities/notification.entity";
import { INotificationRepository } from "domain/repositories/notification.repository.interface";
import { IPushSubscriptionRepository } from "domain/repositories/push-subscription.repository.interface";
import { IWebPushPort } from "domain/ports/web-push.port";

describe("SendNotificationUsecase", () => {
    const createMockPushSubscriptionRepository = (): jest.Mocked<IPushSubscriptionRepository> => ({
        findByUserId: jest.fn(),
        findByEndpoint: jest.fn(),
        create: jest.fn(),
        deleteByEndpoint: jest.fn(),
        deleteByUserId: jest.fn(),
        findAll: jest.fn(),
        findByUserIds: jest.fn(),
    });

    const createMockNotificationRepository = (): jest.Mocked<INotificationRepository> => ({
        findById: jest.fn(),
        findByUserId: jest.fn(),
        findUnreadByUserId: jest.fn(),
        countUnreadByUserId: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        markAllAsReadByUserId: jest.fn(),
        deleteOlderThan: jest.fn(),
    });

    const createMockWebPushPort = (): jest.Mocked<IWebPushPort> => ({
        isEnabled: jest.fn(),
        sendNotification: jest.fn(),
        sendNotificationToMany: jest.fn(),
        getVapidPublicKey: jest.fn(),
    });

    let pushSubscriptionRepository: jest.Mocked<IPushSubscriptionRepository>;
    let notificationRepository: jest.Mocked<INotificationRepository>;
    let webPushPort: jest.Mocked<IWebPushPort>;
    let usecase: SendNotificationUsecase;

    beforeEach(() => {
        pushSubscriptionRepository = createMockPushSubscriptionRepository();
        notificationRepository = createMockNotificationRepository();
        webPushPort = createMockWebPushPort();
        webPushPort.isEnabled.mockReturnValue(false);
        usecase = new SendNotificationUsecase(
            pushSubscriptionRepository,
            notificationRepository,
            webPushPort,
        );
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    it("preserves in-app notification history and subscriptions when push is disabled", async () => {
        const savedNotification = NotificationEntity.create("user-1", "title", "body");
        notificationRepository.create.mockResolvedValue(savedNotification);

        await expect(
            usecase.execute("branch-1", {
                userId: "user-1",
                title: "title",
                body: "body",
            }),
        ).resolves.toBe(savedNotification);

        expect(pushSubscriptionRepository.findByUserId).not.toHaveBeenCalled();
        expect(pushSubscriptionRepository.deleteByEndpoint).not.toHaveBeenCalled();
        expect(webPushPort.sendNotificationToMany).not.toHaveBeenCalled();
    });

    it("does not enumerate or delete subscriptions for broadcasts when push is disabled", async () => {
        await expect(
            usecase.broadcast({ title: "title", body: "body" }),
        ).resolves.toEqual({ sent: 0, failed: 0 });

        expect(pushSubscriptionRepository.findAll).not.toHaveBeenCalled();
        expect(pushSubscriptionRepository.deleteByEndpoint).not.toHaveBeenCalled();
    });

    it("does not enumerate or delete subscriptions for targeted sends when push is disabled", async () => {
        await expect(
            usecase.sendToUsers({ userIds: ["user-1"], title: "title", body: "body" }),
        ).resolves.toEqual({ sent: 0, failed: 0 });

        expect(pushSubscriptionRepository.findByUserIds).not.toHaveBeenCalled();
        expect(pushSubscriptionRepository.deleteByEndpoint).not.toHaveBeenCalled();
    });
});
