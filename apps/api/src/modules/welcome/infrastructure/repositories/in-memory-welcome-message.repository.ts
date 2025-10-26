import { Injectable } from '@nestjs/common';

import { defaultWelcomeMessage } from '@shared-types';

import { WelcomeMessage } from '../../domain/entities/welcome-message.entity';
import { WelcomeMessageRepository } from '../../domain/repositories/welcome-message.repository';

@Injectable()
export class InMemoryWelcomeMessageRepository implements WelcomeMessageRepository {
  async findCurrent(): Promise<WelcomeMessage> {
    return WelcomeMessage.create({
      title: defaultWelcomeMessage.title,
      description: defaultWelcomeMessage.description,
      links: defaultWelcomeMessage.links.map((link) => ({ ...link })),
    });
  }
}
