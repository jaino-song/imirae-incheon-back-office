import { Inject, Injectable } from '@nestjs/common';

import type { WelcomeMessage } from '@api/core/domain/entities/welcome-message.entity';

import {
  WELCOME_MESSAGE_REPOSITORY,
  type WelcomeMessageRepository,
} from '@api/core/application/ports/welcome-message.repository';

@Injectable()
export class GetWelcomeMessageUseCase {
  constructor(
    @Inject(WELCOME_MESSAGE_REPOSITORY)
    private readonly welcomeMessageRepository: WelcomeMessageRepository,
  ) {}

  execute(): Promise<WelcomeMessage> {
    return this.welcomeMessageRepository.getWelcomeMessage();
  }
}
