import { Injectable, Inject } from "@nestjs/common";
import {
    IPushSubscriptionRepository,
    PUSH_SUBSCRIPTION_REPOSITORY,
} from "domain/repositories/push-subscription.repository.interface";

/**
 * Unsubscribe Push Use Case
 *
 * 브라우저에서 구독 해제 시 호출.
 * 현재 인증된 사용자가 소유한 endpoint만 삭제한다.
 */
@Injectable()
export class UnsubscribePushUsecase {
    constructor(
        @Inject(PUSH_SUBSCRIPTION_REPOSITORY)
        private pushSubscriptionRepository: IPushSubscriptionRepository,
    ) {}

    async execute(userId: string, endpoint: string): Promise<void> {
        await this.pushSubscriptionRepository.deleteByEndpointForUser(endpoint, userId);
    }
}
