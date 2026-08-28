import { PushSubscriptionEntity } from "../entities/push-subscription.entity";

export interface IPushSubscriptionRepository {
    /**
     * Find all subscriptions for a user
     */
    findByUserId(userId: string): Promise<PushSubscriptionEntity[]>;

    /**
     * Find subscription by endpoint (unique identifier from browser)
     */
    findByEndpoint(endpoint: string): Promise<PushSubscriptionEntity | null>;

    /**
     * Create a new push subscription
     */
    create(subscription: PushSubscriptionEntity): Promise<PushSubscriptionEntity>;

    /**
     * Atomically create or rebind an endpoint to the authenticated user.
     * The endpoint is globally unique, so ownership changes must be one
     * database operation instead of a find-then-create race.
     */
    upsert(subscription: PushSubscriptionEntity): Promise<PushSubscriptionEntity>;

    /**
     * Delete subscription by endpoint (when user unsubscribes)
     */
    deleteByEndpoint(endpoint: string): Promise<void>;

    /**
     * Delete an endpoint only when it belongs to the authenticated user.
     */
    deleteByEndpointForUser(endpoint: string, userId: string): Promise<void>;

    /**
     * Delete all subscriptions for a user
     */
    deleteByUserId(userId: string): Promise<void>;

    /**
     * Get all subscriptions (for broadcast notifications)
     */
    findAll(): Promise<PushSubscriptionEntity[]>;

}

export const PUSH_SUBSCRIPTION_REPOSITORY = 'PUSH_SUBSCRIPTION_REPOSITORY';
