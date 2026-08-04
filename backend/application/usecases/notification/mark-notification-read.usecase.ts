import { Injectable, Inject, NotFoundException } from "@nestjs/common";
import {
    INotificationRepository,
    NOTIFICATION_REPOSITORY,
} from "domain/repositories/notification.repository.interface";
import { NotificationEntity } from "domain/entities/notification.entity";

/**
 * Mark Notification Read Use Case
 *
 * 알림을 읽음 처리.
 */
@Injectable()
export class MarkNotificationReadUsecase {
    constructor(
        @Inject(NOTIFICATION_REPOSITORY)
        private notificationRepository: INotificationRepository,
    ) {}

    async execute(
        branchid: string,
        notificationId: number,
        userId: string
    ): Promise<NotificationEntity> {
        const notification = await this.notificationRepository.findById(branchid, notificationId);

        if (!notification) {
            throw new NotFoundException(`Notification not found: ${notificationId}`);
        }

        // 본인의 알림인지 확인
        if (notification.userId !== userId) {
            throw new NotFoundException(`Notification not found: ${notificationId}`);
        }

        if (notification.readAt) return notification;
        return this.notificationRepository.updateReadAt(branchid, notificationId, new Date());
    }

    async markAllAsRead(branchid: string, userId: string): Promise<void> {
        await this.notificationRepository.markAllAsReadByUserId(branchid, userId);
    }
}
