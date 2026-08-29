import { Injectable } from "@nestjs/common";
import { IPushSubscriptionRepository } from "domain/repositories/push-subscription.repository.interface";
import { PushSubscriptionEntity } from "domain/entities/push-subscription.entity";
import { PrismaService } from "../prisma.service";
import { PushSubscriptionMapper } from "../mapper/push-subscription.mapper";

@Injectable()
export class SbPushSubscriptionRepository implements IPushSubscriptionRepository {
    constructor(private prismaService: PrismaService) {}

    async findByUserId(userId: string): Promise<PushSubscriptionEntity[]> {
        const rows = await this.prismaService.push_subscription.findMany({
            where: { userId: userId },
            orderBy: { createdAt: 'desc' },
        });
        return rows.map(PushSubscriptionMapper.toDomain);
    }

    async findByEndpoint(endpoint: string): Promise<PushSubscriptionEntity | null> {
        const row = await this.prismaService.push_subscription.findUnique({
            where: { endpoint },
        });
        return row ? PushSubscriptionMapper.toDomain(row) : null;
    }

    async create(subscription: PushSubscriptionEntity): Promise<PushSubscriptionEntity> {
        const created = await this.prismaService.push_subscription.create({
            data: PushSubscriptionMapper.toPrismaCreate(subscription),
        });
        return PushSubscriptionMapper.toDomain(created);
    }

    async upsert(subscription: PushSubscriptionEntity): Promise<PushSubscriptionEntity> {
        const data = PushSubscriptionMapper.toPrismaCreate(subscription);
        const saved = await this.prismaService.push_subscription.upsert({
            where: { endpoint: subscription.endpoint },
            update: {
                userId: data.userId,
                p256dhKey: data.p256dhKey,
                authKey: data.authKey,
                userAgent: data.userAgent,
            },
            create: data,
        });
        return PushSubscriptionMapper.toDomain(saved);
    }

    async deleteByEndpoint(endpoint: string): Promise<void> {
        await this.prismaService.push_subscription.delete({
            where: { endpoint },
        }).catch(() => {
            // Ignore if not found
        });
    }

    async deleteByEndpointForUser(endpoint: string, userId: string): Promise<void> {
        // A mismatched endpoint is deliberately a no-op. This prevents an
        // authenticated user from deleting another user's subscription or
        // learning whether the endpoint exists.
        await this.prismaService.push_subscription.deleteMany({
            where: { endpoint, userId },
        });
    }

    async deleteByEndpointIfMatches(
        subscription: Pick<PushSubscriptionEntity, "id" | "userId" | "endpoint" | "p256dhKey" | "authKey">,
    ): Promise<void> {
        // Failed delivery results can arrive after an endpoint has been
        // rebound.  Keep cleanup conditional on the complete send snapshot so
        // a stale result cannot delete the replacement subscription.
        await this.prismaService.push_subscription.deleteMany({
            where: {
                id: subscription.id,
                endpoint: subscription.endpoint,
                userId: subscription.userId,
                p256dhKey: subscription.p256dhKey,
                authKey: subscription.authKey,
            },
        });
    }

    async deleteByUserId(userId: string): Promise<void> {
        await this.prismaService.push_subscription.deleteMany({
            where: { userId: userId },
        });
    }

    async findAll(): Promise<PushSubscriptionEntity[]> {
        const rows = await this.prismaService.push_subscription.findMany({
            orderBy: { createdAt: 'desc' },
        });
        return rows.map(PushSubscriptionMapper.toDomain);
    }

}
