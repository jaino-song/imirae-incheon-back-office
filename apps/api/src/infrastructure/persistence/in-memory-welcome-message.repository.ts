import { Injectable } from '@nestjs/common';

import { defaultWelcomeMessage } from '@shared-types';

import { WelcomeMessage } from '@api/core/domain/entities/welcome-message.entity';
import { WelcomeMessageRepository } from '@api/core/application/ports/welcome-message.repository';

@Injectable()
export class InMemoryWelcomeMessageRepository implements WelcomeMessageRepository {
  async getWelcomeMessage(): Promise<WelcomeMessage> {
    return new WelcomeMessage({
      title: defaultWelcomeMessage.title,
      description: defaultWelcomeMessage.description,
      links: defaultWelcomeMessage.links.map((link) => ({ ...link })),
    });
  }
}
