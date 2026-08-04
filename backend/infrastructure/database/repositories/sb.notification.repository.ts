import { Injectable } from "@nestjs/common";
import { INotificationRepository } from "domain/repositories/notification.repository.interface";
import { NotificationEntity } from "domain/entities/notification.entity";
import { PrismaService } from "../prisma.service";
import { NotificationMapper } from "../mapper/notification.mapper";

@Injectable()
export class SbNotificationRepository implements INotificationRepository {
    constructor(private prismaService: PrismaService) {}

    async findById(branchid: string, id: number): Promise<NotificationEntity | null> {
        const row = await this.prismaService.notification.findFirst({
            where: { id, branchId: branchid },
        });
        return row ? NotificationMapper.toDomain(row) : null;
    }

    async findByUserId(
        branchid: string,
        userId: string,
        options?: { limit?: number; offset?: number },
    ): Promise<NotificationEntity[]> {
        const rows = await this.prismaService.notification.findMany({
            where: { userId: userId, branchId: branchid },
            orderBy: { sentAt: 'desc' },
            take: options?.limit ?? 50,
            skip: options?.offset ?? 0,
        });
        return rows.map(NotificationMapper.toDomain);
    }

    async findUnreadByUserId(branchid: string, userId: string): Promise<NotificationEntity[]> {
        const rows = await this.prismaService.notification.findMany({
            where: {
                userId: userId,
                readAt: null,
                branchId: branchid,
            },
            orderBy: { sentAt: 'desc' },
        });
        return rows.map(NotificationMapper.toDomain);
    }

    async countUnreadByUserId(branchid: string, userId: string): Promise<number> {
        return this.prismaService.notification.count({
            where: {
                userId: userId,
                readAt: null,
                branchId: branchid,
            },
        });
    }

    async create(branchid: string, notification: NotificationEntity): Promise<NotificationEntity> {
        const created = await this.prismaService.notification.create({
            data: {
                ...NotificationMapper.toPrismaCreate(notification),
                branchId: branchid,
            },
        });
        return NotificationMapper.toDomain(created);
    }

    async updateData(
        branchid: string,
        id: number,
        data: Record<string, unknown> | null,
    ): Promise<NotificationEntity> {
        const result = await this.prismaService.notification.updateMany({
            where: { id, branchId: branchid },
            data: NotificationMapper.toPrismaDataUpdate(data),
        });
        if (result.count === 0) {
            throw new Error("Notification not found for branch");
        }
        const updated = await this.prismaService.notification.findFirst({
            where: { id, branchId: branchid },
        });
        if (!updated) {
            throw new Error("Notification not found after update");
        }
        return NotificationMapper.toDomain(updated);
    }

    async updateReadAt(
        branchid: string,
        id: number,
        readAt: Date | null,
    ): Promise<NotificationEntity> {
        const result = await this.prismaService.notification.updateMany({
            where: { id, branchId: branchid },
            data: NotificationMapper.toPrismaReadAtUpdate(readAt),
        });
        if (result.count === 0) {
            throw new Error("Notification not found for branch");
        }
        const updated = await this.prismaService.notification.findFirst({
            where: { id, branchId: branchid },
        });
        if (!updated) {
            throw new Error("Notification not found after update");
        }
        return NotificationMapper.toDomain(updated);
    }

    async markAllAsReadByUserId(branchid: string, userId: string): Promise<void> {
        await this.prismaService.notification.updateMany({
            where: {
                userId: userId,
                readAt: null,
                branchId: branchid,
            },
            data: {
                readAt: new Date(),
            },
        });
    }

    async deleteOlderThan(branchid: string, date: Date): Promise<number> {
        const result = await this.prismaService.notification.deleteMany({
            where: {
                sentAt: { lt: date },
                branchId: branchid,
            },
        });
        return result.count;
    }
}
