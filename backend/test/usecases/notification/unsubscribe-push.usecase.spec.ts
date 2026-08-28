import { IPushSubscriptionRepository } from "domain/repositories/push-subscription.repository.interface";
import { UnsubscribePushUsecase } from "application/usecases/notification/unsubscribe-push.usecase";

describe("UnsubscribePushUsecase", () => {
    it("deletes an endpoint only for the authenticated owner", async () => {
        const endpoint = "https://push.example/shared-endpoint";
        const owners = new Map([[endpoint, "user-b"]]);
        const repository: jest.Mocked<IPushSubscriptionRepository> = {
            findByUserId: jest.fn(),
            findByEndpoint: jest.fn(),
            create: jest.fn(),
            upsert: jest.fn(),
            deleteByEndpoint: jest.fn(),
            deleteByEndpointForUser: jest.fn(async (requestedEndpoint, userId) => {
                if (owners.get(requestedEndpoint) === userId) {
                    owners.delete(requestedEndpoint);
                }
            }),
            deleteByUserId: jest.fn(),
            findAll: jest.fn(),
        };
        const usecase = new UnsubscribePushUsecase(repository);

        await usecase.execute("user-b", endpoint);

        expect(repository.deleteByEndpointForUser).toHaveBeenCalledWith(
            endpoint,
            "user-b",
        );
        expect(repository.deleteByEndpoint).not.toHaveBeenCalled();
        expect(owners.has(endpoint)).toBe(false);
    });

    it("does not expose or delete another user's endpoint", async () => {
        const endpoint = "https://push.example/owned-by-victim";
        const owners = new Map([[endpoint, "victim"]]);
        const repository: jest.Mocked<IPushSubscriptionRepository> = {
            findByUserId: jest.fn(),
            findByEndpoint: jest.fn(),
            create: jest.fn(),
            upsert: jest.fn(),
            deleteByEndpoint: jest.fn(),
            deleteByEndpointForUser: jest.fn(async (requestedEndpoint, userId) => {
                if (owners.get(requestedEndpoint) === userId) {
                    owners.delete(requestedEndpoint);
                }
            }),
            deleteByUserId: jest.fn(),
            findAll: jest.fn(),
        };
        const usecase = new UnsubscribePushUsecase(repository);

        await usecase.execute("attacker", endpoint);

        expect(repository.deleteByEndpointForUser).toHaveBeenCalledWith(
            endpoint,
            "attacker",
        );
        expect(repository.findByEndpoint).not.toHaveBeenCalled();
        expect(owners.get(endpoint)).toBe("victim");
    });
});
