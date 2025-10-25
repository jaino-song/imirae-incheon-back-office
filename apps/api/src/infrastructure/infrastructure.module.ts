import { Module } from '@nestjs/common';

import { WELCOME_MESSAGE_REPOSITORY } from '@api/core/application/ports/welcome-message.repository';

import { InMemoryWelcomeMessageRepository } from './persistence/in-memory-welcome-message.repository';

const infrastructureProviders = [
  {
    provide: WELCOME_MESSAGE_REPOSITORY,
    useClass: InMemoryWelcomeMessageRepository,
  },
];

@Module({
  providers: [...infrastructureProviders],
  exports: [...infrastructureProviders],
})
export class InfrastructureModule {}
