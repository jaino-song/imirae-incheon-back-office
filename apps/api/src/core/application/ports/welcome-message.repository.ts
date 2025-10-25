import type { WelcomeMessage } from '@api/core/domain/entities/welcome-message.entity';

export const WELCOME_MESSAGE_REPOSITORY = Symbol('WELCOME_MESSAGE_REPOSITORY');

export interface WelcomeMessageRepository {
  getWelcomeMessage(): Promise<WelcomeMessage>;
}
