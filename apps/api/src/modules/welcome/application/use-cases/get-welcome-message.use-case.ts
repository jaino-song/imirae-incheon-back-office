import { Inject, Injectable } from '@nestjs/common';

import {
  WELCOME_MESSAGE_REPOSITORY,
  type WelcomeMessageRepository,
} from '../../domain/repositories/welcome-message.repository';
import type { GetWelcomeMessageResponse } from '../dto/get-welcome-message.response';
import { WelcomeMessageMapper } from '../mappers/welcome-message.mapper';

@Injectable()
export class GetWelcomeMessageUseCase {
  constructor(
    @Inject(WELCOME_MESSAGE_REPOSITORY)
    private readonly welcomeMessageRepository: WelcomeMessageRepository,
  ) {}

  async execute(): Promise<GetWelcomeMessageResponse> {
    const message = await this.welcomeMessageRepository.findCurrent();
    return WelcomeMessageMapper.toResponse(message);
  }
}
