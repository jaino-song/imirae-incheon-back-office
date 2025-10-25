import type { WelcomeMessage } from '../entities/welcome-message.entity';

export interface WelcomeMessageRepository {
  findCurrent(): Promise<WelcomeMessage>;
}

export const WELCOME_MESSAGE_REPOSITORY = Symbol('WELCOME_MESSAGE_REPOSITORY');
