import { SendNotificationUsecase } from "application/usecases/notification/send-notification.usecase";
import { NotificationEntity } from "domain/entities/notification.entity";
import { INotificationRepository } from "domain/repositories/notification.repository.interface";
import { IPushSubscriptionRepository } from "domain/repositories/push-subscription.repository.interface";
import { IWebPushPort } from "domain/ports/web-push.port";
import { MarkNotificationReadUsecase } from "application/usecases/notification/mark-notification-read.usecase";
import { PushSubscriptionEntity } from "domain/entities/push-subscription.entity";

describe("SendNotificationUsecase", () => {
    const createMockPushSubscriptionRepository = (): jest.Mocked<IPushSubscriptionRepository> => ({
        findByUserId: jest.fn(),
        findByEndpoint: jest.fn(),
        create: jest.fn(),
        upsert: jest.fn(),
        deleteByEndpoint: jest.fn(),
        deleteByEndpointForUser: jest.fn(),
        deleteByEndpointIfMatches: jest.fn(),
        deleteByUserId: jest.fn(),
        findAll: jest.fn(),
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
        expect(pushSubscriptionRepository.deleteByEndpointIfMatches).not.toHaveBeenCalled();
        expect(webPushPort.sendNotificationToMany).not.toHaveBeenCalled();
        expect(notificationRepository.updateData).toHaveBeenCalledTimes(1);
    });

    it("does not enumerate or delete subscriptions for broadcasts when push is disabled", async () => {
        await expect(
            usecase.broadcast({ title: "title", body: "body" }),
        ).resolves.toEqual({ sent: 0, failed: 0 });

        expect(pushSubscriptionRepository.findAll).not.toHaveBeenCalled();
        expect(pushSubscriptionRepository.deleteByEndpointIfMatches).not.toHaveBeenCalled();
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

    it("persists complete partial delivery counts and removes only failed subscriptions", async () => {
        webPushPort.isEnabled.mockReturnValue(true);
        const savedNotification = NotificationEntity.create("user-1", "title", "body");
        notificationRepository.create.mockResolvedValue(savedNotification);
        pushSubscriptionRepository.findByUserId.mockResolvedValue([
            PushSubscriptionEntity.reconstitute(1, "user-1", "endpoint-success", "p256dh-1", "auth-1", null, new Date()),
            PushSubscriptionEntity.reconstitute(2, "user-1", "endpoint-failed", "p256dh-2", "auth-2", null, new Date()),
            PushSubscriptionEntity.reconstitute(3, "user-1", "endpoint-success-2", "p256dh-3", "auth-3", null, new Date()),
        ]);
        webPushPort.sendNotificationToMany.mockResolvedValue(new Map([
            ["endpoint-success", true],
            ["endpoint-failed", false],
            ["endpoint-success-2", true],
        ]));

        const outcome = await usecase.executeWithOutcome("branch-1", {
            userId: "user-1",
            title: "title",
            body: "body",
        });

        expect(outcome).toEqual(expect.objectContaining({
            status: "partial",
            subscriptions: 3,
            delivered: 2,
            failed: 1,
        }));
        expect(notificationRepository.updateData).toHaveBeenCalledWith("branch-1", savedNotification.id, expect.objectContaining({
            providerOutcome: { status: "partial", subscriptions: 3, delivered: 2, failed: 1 },
        }));
        expect(pushSubscriptionRepository.deleteByEndpointIfMatches).toHaveBeenCalledTimes(1);
        expect(pushSubscriptionRepository.deleteByEndpointIfMatches).toHaveBeenCalledWith(
            expect.objectContaining({
                id: 2,
                userId: "user-1",
                endpoint: "endpoint-failed",
                p256dhKey: "p256dh-2",
                authKey: "auth-2",
            }),
        );
    });

    it.each([
        { label: "full success", results: [["endpoint-1", true] as const, ["endpoint-2", true] as const], status: "delivered", delivered: 2, failed: 0 },
        { label: "full failure", results: [["endpoint-1", false] as const, ["endpoint-2", false] as const], status: "failed", delivered: 0, failed: 2 },
    ])("preserves $label delivery semantics", async ({ results, status, delivered, failed }) => {
        webPushPort.isEnabled.mockReturnValue(true);
        const savedNotification = NotificationEntity.create("user-1", "title", "body");
        notificationRepository.create.mockResolvedValue(savedNotification);
        pushSubscriptionRepository.findByUserId.mockResolvedValue([
            PushSubscriptionEntity.reconstitute(1, "user-1", "endpoint-1", "p256dh-1", "auth-1", null, new Date()),
            PushSubscriptionEntity.reconstitute(2, "user-1", "endpoint-2", "p256dh-2", "auth-2", null, new Date()),
        ]);
        webPushPort.sendNotificationToMany.mockResolvedValue(new Map(results));

        const outcome = await usecase.executeWithOutcome("branch-1", {
            userId: "user-1",
            title: "title",
            body: "body",
        });

        expect(outcome).toEqual(expect.objectContaining({ status, subscriptions: 2, delivered, failed }));
        expect(notificationRepository.updateData).toHaveBeenCalledWith("branch-1", savedNotification.id, expect.objectContaining({
            providerOutcome: { status, subscriptions: 2, delivered, failed },
        }));
    });

    it("uses the broadcast send snapshot for failed subscription cleanup", async () => {
        webPushPort.isEnabled.mockReturnValue(true);
        const subscription = PushSubscriptionEntity.reconstitute(
            9,
            "user-9",
            "endpoint-broadcast",
            "p256dh-9",
            "auth-9",
            null,
            new Date(),
        );
        pushSubscriptionRepository.findAll.mockResolvedValue([subscription]);
        webPushPort.sendNotificationToMany.mockResolvedValue(new Map([
            [subscription.endpoint, false],
        ]));

        await expect(usecase.broadcast({ title: "title", body: "body" })).resolves.toEqual({
            sent: 0,
            failed: 1,
        });

        expect(pushSubscriptionRepository.deleteByEndpointIfMatches).toHaveBeenCalledWith(subscription);
        expect(pushSubscriptionRepository.deleteByEndpoint).not.toHaveBeenCalled();
    });
});
