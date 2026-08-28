import { PushSubscriptionEntity } from "domain/entities/push-subscription.entity";
import { PrismaService } from "infrastructure/database/prisma.service";
import { SbPushSubscriptionRepository } from "infrastructure/database/repositories/sb.push-subscription.repository";

describe("SbPushSubscriptionRepository", () => {
    it("uses a single endpoint upsert to make account replacement atomic", async () => {
        const savedRow = {
            id: 7,
            userId: "user-b",
            endpoint: "https://push.example/shared-endpoint",
            p256dhKey: "p256dh-b",
            authKey: "auth-b",
            userAgent: "test-agent",
            createdAt: new Date("2026-08-29T00:00:00.000Z"),
        };
        const prisma = {
            push_subscription: {
                upsert: jest.fn().mockResolvedValue(savedRow),
            },
        };
        const repository = new SbPushSubscriptionRepository(prisma as unknown as PrismaService);
        const subscription = PushSubscriptionEntity.create(
            "user-b",
            savedRow.endpoint,
            savedRow.p256dhKey,
            savedRow.authKey,
            savedRow.userAgent,
        );

        await expect(repository.upsert(subscription)).resolves.toMatchObject({
            userId: "user-b",
            endpoint: savedRow.endpoint,
        });
        expect(prisma.push_subscription.upsert).toHaveBeenCalledWith({
            where: { endpoint: savedRow.endpoint },
            update: {
                userId: "user-b",
                p256dhKey: savedRow.p256dhKey,
                authKey: savedRow.authKey,
                userAgent: savedRow.userAgent,
            },
            create: {
                userId: "user-b",
                endpoint: savedRow.endpoint,
                p256dhKey: savedRow.p256dhKey,
                authKey: savedRow.authKey,
                userAgent: savedRow.userAgent,
            },
        });
    });

    it("scopes endpoint deletion to the authenticated owner", async () => {
        const prisma = {
            push_subscription: {
                deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
            },
        };
        const repository = new SbPushSubscriptionRepository(prisma as unknown as PrismaService);

        await repository.deleteByEndpointForUser(
            "https://push.example/victim-endpoint",
            "attacker",
        );

        expect(prisma.push_subscription.deleteMany).toHaveBeenCalledWith({
            where: {
                endpoint: "https://push.example/victim-endpoint",
                userId: "attacker",
            },
        });
    });
});
