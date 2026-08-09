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

    async deleteByEndpoint(endpoint: string): Promise<void> {
        await this.prismaService.push_subscription.delete({
            where: { endpoint },
        }).catch(() => {
            // Ignore if not found
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
