import { PushSubscriptionEntity } from "domain/entities/push-subscription.entity";
import { IPushSubscriptionRepository } from "domain/repositories/push-subscription.repository.interface";
import { SubscribePushUsecase } from "application/usecases/notification/subscribe-push.usecase";

describe("SubscribePushUsecase", () => {
    it("atomically rebinds an existing browser endpoint to the authenticated user", async () => {
        const endpoint = "https://push.example/shared-endpoint";
        const owners = new Map([[endpoint, "user-a"]]);
        const repository: jest.Mocked<IPushSubscriptionRepository> = {
            findByUserId: jest.fn(),
            findByEndpoint: jest.fn(),
            create: jest.fn(),
            upsert: jest.fn(async (subscription) => {
                owners.set(subscription.endpoint, subscription.userId);
                return subscription;
            }),
            deleteByEndpoint: jest.fn(),
            deleteByEndpointForUser: jest.fn(),
            deleteByEndpointIfMatches: jest.fn(),
            deleteByUserId: jest.fn(),
            findAll: jest.fn(),
        };
        const usecase = new SubscribePushUsecase(repository);

        const result = await usecase.execute(
            "user-b",
            endpoint,
            "p256dh-b",
            "auth-b",
            "test-agent",
        );

        expect(result).toBeInstanceOf(PushSubscriptionEntity);
        expect(result).toMatchObject({
            userId: "user-b",
            endpoint: "https://push.example/shared-endpoint",
            p256dhKey: "p256dh-b",
            authKey: "auth-b",
            userAgent: "test-agent",
        });
        expect(owners.get(endpoint)).toBe("user-b");
        expect(repository.upsert).toHaveBeenCalledWith(expect.objectContaining({
            userId: "user-b",
            endpoint: "https://push.example/shared-endpoint",
        }));
        expect(repository.findByEndpoint).not.toHaveBeenCalled();
        expect(repository.create).not.toHaveBeenCalled();
    });

    it("keeps concurrent account replacement requests on one deterministic endpoint row", async () => {
        const owners = new Map<string, string>();
        const repository: jest.Mocked<IPushSubscriptionRepository> = {
            findByUserId: jest.fn(),
            findByEndpoint: jest.fn(),
            create: jest.fn(),
            upsert: jest.fn(async (subscription) => {
                owners.set(subscription.endpoint, subscription.userId);
                return subscription;
            }),
            deleteByEndpoint: jest.fn(),
            deleteByEndpointForUser: jest.fn(),
            deleteByEndpointIfMatches: jest.fn(),
            deleteByUserId: jest.fn(),
            findAll: jest.fn(),
        };
        const usecase = new SubscribePushUsecase(repository);
        const endpoint = "https://push.example/concurrent-endpoint";

        await Promise.all([
            usecase.execute("user-a", endpoint, "p256dh-a", "auth-a"),
            usecase.execute("user-b", endpoint, "p256dh-b", "auth-b"),
        ]);

        expect(repository.upsert).toHaveBeenCalledTimes(2);
        expect(owners.get(endpoint)).toBe("user-b");
        expect(repository.create).not.toHaveBeenCalled();
    });
});
