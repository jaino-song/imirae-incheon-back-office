import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import * as webpush from "web-push";
import { IWebPushPort } from "domain/ports/web-push.port";
import { PushSubscriptionEntity } from "domain/entities/push-subscription.entity";
import { isPwaNotificationsEnabled } from "application/constants/notification";

/**
 * Web Push Adapter
 *
 * web-push 라이브러리를 사용한 IWebPushPort 구현체.
 * VAPID 키로 서버 인증, 브라우저 Push Service에 알림 전송.
 */
@Injectable()
export class WebPushAdapter implements IWebPushPort {
    private readonly logger = new Logger(WebPushAdapter.name);
    private readonly vapidPublicKey: string;
    private readonly vapidPrivateKey: string;
    private readonly isConfigured: boolean;

    constructor(private configService: ConfigService) {
        this.vapidPublicKey = this.configService.get<string>('VAPID_PUBLIC_KEY') || '';
        this.vapidPrivateKey = this.configService.get<string>('VAPID_PRIVATE_KEY') || '';

        this.isConfigured = isPwaNotificationsEnabled()
            && Boolean(this.vapidPublicKey && this.vapidPrivateKey);

        if (!this.isConfigured) {
            this.logger.warn(
                isPwaNotificationsEnabled()
                    ? 'VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY not configured. Web push will be disabled.'
                    : 'PWA notifications are disabled. Set PWA_NOTIFICATIONS_ENABLED=true to enable them.',
            );
            return;
        }

        const vapidEmail = this.configService.get<string>('VAPID_EMAIL') || 'admin@example.com';

        // VAPID 설정 초기화
        webpush.setVapidDetails(
            `mailto:${vapidEmail}`,
            this.vapidPublicKey,
            this.vapidPrivateKey,
        );

        this.logger.log('Web Push adapter initialized with VAPID credentials');
    }

    async sendNotification(
        subscription: PushSubscriptionEntity,
        payload: string,
    ): Promise<boolean> {
        if (!this.isConfigured) {
            return false;
        }

        const maxRetries = 2;

        for (let attempt = 0; attempt <= maxRetries; attempt++) {
            try {
                await webpush.sendNotification(
                    subscription.toWebPushSubscription(),
                    payload,
                    {
                        TTL: 60 * 60 * 24,
                        urgency: 'normal',
                    },
                );
                this.logger.debug(`Push notification sent to endpoint: ${subscription.endpoint.substring(0, 50)}...`);
                return true;
            } catch (error: unknown) {
                const webPushError = error as { statusCode?: number; body?: string };

                // Permanent failures - don't retry
                if (webPushError.statusCode === 410 || webPushError.statusCode === 404) {
                    this.logger.warn(`Subscription expired or invalid: ${subscription.endpoint.substring(0, 50)}...`);
                    return false;
                }

                // Retryable error
                if (attempt < maxRetries) {
                    const delay = (attempt + 1) * 1000; // 1s, 2s linear backoff
                    this.logger.warn(`Push failed (attempt ${attempt + 1}/${maxRetries + 1}), retrying in ${delay}ms...`);
                    await new Promise(resolve => setTimeout(resolve, delay));
                    continue;
                }

                this.logger.error(`Failed to send push notification after ${maxRetries + 1} attempts: ${webPushError.body || webPushError}`);
                return false;
            }
        }

        return false;
    }

    async sendNotificationToMany(
        subscriptions: PushSubscriptionEntity[],
        payload: string,
    ): Promise<Map<string, boolean>> {
        const results = new Map<string, boolean>();

        if (!this.isConfigured) {
            subscriptions.forEach((subscription) => {
                results.set(subscription.endpoint, false);
            });
            return results;
        }

        // 병렬로 전송하되 동시 연결 수 제한 (10개씩)
        const batchSize = 10;
        for (let i = 0; i < subscriptions.length; i += batchSize) {
            const batch = subscriptions.slice(i, i + batchSize);
            const batchResults = await Promise.all(
                batch.map(async (sub) => {
                    const success = await this.sendNotification(sub, payload);
                    return { endpoint: sub.endpoint, success };
                }),
            );
            batchResults.forEach(({ endpoint, success }) => {
                results.set(endpoint, success);
            });
        }

        const successCount = Array.from(results.values()).filter(Boolean).length;
        this.logger.log(`Sent notifications: ${successCount}/${subscriptions.length} successful`);

        return results;
    }

    getVapidPublicKey(): string {
        return this.isConfigured ? this.vapidPublicKey : '';
    }
}
