import { Injectable } from "@nestjs/common";

import {
    EformsignWebhookEventRow,
    EformsignWebhookOutcomeTally,
    IEformsignWebhookEventRepository,
} from "domain/repositories/eformsign-webhook-event.repository.interface";
import { PrismaService } from "infrastructure/database/prisma.service";

@Injectable()
export class SbEformsignWebhookEventRepository implements IEformsignWebhookEventRepository {
    constructor(private readonly prisma: PrismaService) {}

    async append(row: EformsignWebhookEventRow): Promise<void> {
        await this.prisma.eformsign_webhook_event.create({ data: row });
    }

    async countByOutcomeSince(since: Date): Promise<EformsignWebhookOutcomeTally[]> {
        const grouped = await this.prisma.eformsign_webhook_event.groupBy({
            by: ["outcome"],
            where: { createdAt: { gte: since } },
            _count: { _all: true },
        });
        return grouped.map((group) => ({
            outcome: group.outcome,
            count: group._count._all,
        }));
    }

    async deleteOlderThan(cutoff: Date): Promise<number> {
        const { count } = await this.prisma.eformsign_webhook_event.deleteMany({
            where: { createdAt: { lt: cutoff } },
        });
        return count;
    }
}
