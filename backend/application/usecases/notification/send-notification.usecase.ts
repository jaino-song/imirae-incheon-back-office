import { Injectable, Inject, Logger } from "@nestjs/common";
import {
    IPushSubscriptionRepository,
    PUSH_SUBSCRIPTION_REPOSITORY,
} from "domain/repositories/push-subscription.repository.interface";
import {
    INotificationRepository,
    NOTIFICATION_REPOSITORY,
} from "domain/repositories/notification.repository.interface";
import { IWebPushPort, WEB_PUSH_PORT } from "domain/ports/web-push.port";
import { NotificationEntity } from "domain/entities/notification.entity";

export interface SendNotificationParams {
    userId: string;
    title: string;
    body: string;
    data?: Record<string, unknown>;
}

export interface SendBroadcastParams {
    title: string;
    body: string;
    data?: Record<string, unknown>;
}

export interface SendToUsersParams {
    userIds: string[];
    title: string;
    body: string;
    data?: Record<string, unknown>;
}

/**
 * Send Notification Use Case
 *
 * 특정 사용자 또는 전체 사용자에게 알림 전송.
 * 알림 이력 저장 + 실제 Push 전송.
 */
@Injectable()
export class SendNotificationUsecase {
    private readonly logger = new Logger(SendNotificationUsecase.name);

    constructor(
        @Inject(PUSH_SUBSCRIPTION_REPOSITORY)
        private pushSubscriptionRepository: IPushSubscriptionRepository,
        @Inject(NOTIFICATION_REPOSITORY)
        private notificationRepository: INotificationRepository,
        @Inject(WEB_PUSH_PORT)
        private webPushPort: IWebPushPort,
    ) {}

    /**
     * Send notification to a specific user
     */
    async execute(
        branchid: string,
        params: SendNotificationParams
    ): Promise<NotificationEntity> {
        const { userId, title, body, data } = params;

        // 알림 이력 저장
        const notification = NotificationEntity.create(userId, title, body, data);
        const savedNotification = await this.notificationRepository.create(
            branchid,
            notification
        );

        if (!this.webPushPort.isEnabled()) {
            return savedNotification;
        }

        // 사용자의 모든 구독 가져오기
        const subscriptions = await this.pushSubscriptionRepository.findByUserId(userId);

        if (subscriptions.length === 0) {
            this.logger.warn(`No push subscriptions found for user: ${userId}`);
            return savedNotification;
        }

        // Push 알림 전송
        const payload = savedNotification.toWebPushPayload();
        const results = await this.webPushPort.sendNotificationToMany(subscriptions, payload);

        // 실패한 구독 정리 (expired/invalid)
        for (const [endpoint, success] of results) {
            if (!success) {
                await this.pushSubscriptionRepository.deleteByEndpoint(endpoint);
                this.logger.log(`Removed invalid subscription: ${endpoint.substring(0, 50)}...`);
            }
        }

        return savedNotification;
    }

    /**
     * Send notification to all users (broadcast)
     */
    async broadcast(params: SendBroadcastParams): Promise<{ sent: number; failed: number }> {
        const { title, body, data } = params;

        if (!this.webPushPort.isEnabled()) {
            return { sent: 0, failed: 0 };
        }

        // 모든 구독 가져오기
        const subscriptions = await this.pushSubscriptionRepository.findAll();

        if (subscriptions.length === 0) {
            this.logger.warn('No push subscriptions found for broadcast');
            return { sent: 0, failed: 0 };
        }

        // 알림 페이로드 생성
        const payload = JSON.stringify({
            title,
            body,
            icon: '/icon-192.png',
            badge: '/badge-72.png',
            data,
        });

        // Push 알림 전송
        const results = await this.webPushPort.sendNotificationToMany(subscriptions, payload);

        // 실패한 구독 정리
        let sent = 0;
        let failed = 0;
        for (const [endpoint, success] of results) {
            if (success) {
                sent++;
            } else {
                failed++;
                await this.pushSubscriptionRepository.deleteByEndpoint(endpoint);
            }
        }

        return { sent, failed };
    }

    async sendToUsers(params: SendToUsersParams): Promise<{ sent: number; failed: number }> {
        const { userIds, title, body, data } = params;

        if (!this.webPushPort.isEnabled()) {
            return { sent: 0, failed: 0 };
        }

        if (userIds.length === 0) {
            this.logger.warn('No user IDs provided for notification');
            return { sent: 0, failed: 0 };
        }

        const subscriptions = await this.pushSubscriptionRepository.findByUserIds(userIds);

        if (subscriptions.length === 0) {
            this.logger.warn(`No push subscriptions found for users: ${userIds.join(', ')}`);
            return { sent: 0, failed: 0 };
        }

        const payload = JSON.stringify({
            title,
            body,
            icon: '/icon-192.png',
            badge: '/badge-72.png',
            data,
        });

        const results = await this.webPushPort.sendNotificationToMany(subscriptions, payload);

        let sent = 0;
        let failed = 0;
        for (const [endpoint, success] of results) {
            if (success) {
                sent++;
            } else {
                failed++;
                await this.pushSubscriptionRepository.deleteByEndpoint(endpoint);
            }
        }

        this.logger.log(`Sent notifications to ${sent} subscriptions (${failed} failed) for ${userIds.length} users`);
        return { sent, failed };
    }
}
