import { PushSubscriptionEntity } from "../entities/push-subscription.entity";

/**
 * Web Push Port
 *
 * Port (인터페이스) for Web Push notification delivery.
 * 실제 구현체는 infrastructure 레이어의 adapter에서 제공.
 */
export interface IWebPushPort {
    /**
     * Whether push delivery is currently enabled and configured.
     */
    isEnabled(): boolean;

    /**
     * Send push notification to a single subscription
     * @returns true if sent successfully, false if subscription is invalid/expired
     */
    sendNotification(
        subscription: PushSubscriptionEntity,
        payload: string,
    ): Promise<boolean>;

    /**
     * Send push notification to multiple subscriptions
     * @returns Map of endpoint -> success/failure
     */
    sendNotificationToMany(
        subscriptions: PushSubscriptionEntity[],
        payload: string,
    ): Promise<Map<string, boolean>>;

    /**
     * Get VAPID public key (needed by frontend for subscription)
     */
    getVapidPublicKey(): string;
}

export const WEB_PUSH_PORT = 'WEB_PUSH_PORT';
