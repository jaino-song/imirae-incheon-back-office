import { Injectable, Inject } from "@nestjs/common";
import {
    IPushSubscriptionRepository,
    PUSH_SUBSCRIPTION_REPOSITORY,
} from "domain/repositories/push-subscription.repository.interface";
import { PushSubscriptionEntity } from "domain/entities/push-subscription.entity";

/**
 * Subscribe Push Use Case
 *
 * 브라우저에서 받은 PushSubscription 정보를 저장.
 * endpoint는 전역적으로 유일하며, 인증된 현재 사용자의 소유로
 * 원자적으로 생성 또는 재바인딩한다.
 */
@Injectable()
export class SubscribePushUsecase {
    constructor(
        @Inject(PUSH_SUBSCRIPTION_REPOSITORY)
        private pushSubscriptionRepository: IPushSubscriptionRepository,
    ) {}

    async execute(
        userId: string,
        endpoint: string,
        p256dhKey: string,
        authKey: string,
        userAgent?: string,
    ): Promise<PushSubscriptionEntity> {
        const subscription = PushSubscriptionEntity.create(
            userId,
            endpoint,
            p256dhKey,
            authKey,
            userAgent,
        );

        return this.pushSubscriptionRepository.upsert(subscription);
    }
}
