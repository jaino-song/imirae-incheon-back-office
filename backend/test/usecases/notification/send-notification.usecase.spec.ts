import { SendNotificationUsecase } from "application/usecases/notification/send-notification.usecase";
import { NotificationEntity } from "domain/entities/notification.entity";
import { INotificationRepository } from "domain/repositories/notification.repository.interface";
import { IPushSubscriptionRepository } from "domain/repositories/push-subscription.repository.interface";
import { IWebPushPort } from "domain/ports/web-push.port";
import { MarkNotificationReadUsecase } from "application/usecases/notification/mark-notification-read.usecase";

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
        updateData: jest.fn(),
        updateReadAt: jest.fn(),
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
        notificationRepository.updateData.mockImplementation(async (_branchId, id, data) =>
            NotificationEntity.reconstitute(id, "user-1", "title", "body", data, new Date(), null));
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
        ).resolves.toEqual(expect.objectContaining({
            userId: "user-1",
            data: expect.objectContaining({
                providerOutcome: { status: "disabled", subscriptions: 0, delivered: 0, failed: 0 },
            }),
        }));

        expect(pushSubscriptionRepository.findByUserId).not.toHaveBeenCalled();
        expect(pushSubscriptionRepository.deleteByEndpoint).not.toHaveBeenCalled();
        expect(webPushPort.sendNotificationToMany).not.toHaveBeenCalled();
        expect(notificationRepository.updateData).toHaveBeenCalledTimes(1);
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

    it("keeps a concurrent mark-read write when provider outcome persistence is deferred", async () => {
        const state = {
            data: { initial: true } as Record<string, unknown> | null,
            readAt: null as Date | null,
        };
        const savedNotification = NotificationEntity.reconstitute(
            7, "user-1", "title", "body", state.data, new Date("2026-08-04T00:00:00.000Z"), null,
        );
        notificationRepository.create.mockResolvedValue(savedNotification);

        let providerUpdateStarted!: () => void;
        const providerStarted = new Promise<void>((resolve) => { providerUpdateStarted = resolve; });
        let releaseProviderUpdate!: () => void;
        const providerUpdateReleased = new Promise<void>((resolve) => { releaseProviderUpdate = resolve; });
        notificationRepository.updateData.mockImplementation(async (_branchId, id, data) => {
            providerUpdateStarted();
            await providerUpdateReleased;
            state.data = data;
            return NotificationEntity.reconstitute(id, "user-1", "title", "body", state.data, savedNotification.sentAt, state.readAt);
        });
        notificationRepository.findById.mockResolvedValue(savedNotification);
        notificationRepository.updateReadAt.mockImplementation(async (_branchId, id, readAt) => {
            state.readAt = readAt;
            return NotificationEntity.reconstitute(id, "user-1", "title", "body", state.data, savedNotification.sentAt, state.readAt);
        });

        const markRead = new MarkNotificationReadUsecase(notificationRepository);
        const providerPromise = usecase.execute("branch-1", {
            userId: "user-1",
            title: "title",
            body: "body",
        });
        await providerStarted;
        await markRead.execute("branch-1", 7, "user-1");
        releaseProviderUpdate();
        await providerPromise;

        expect(state.data).toEqual(expect.objectContaining({
            initial: true,
            providerOutcome: expect.objectContaining({ status: "disabled" }),
        }));
        expect(state.readAt).toEqual(expect.any(Date));
    });
});
