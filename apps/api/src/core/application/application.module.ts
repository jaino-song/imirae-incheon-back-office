import { Module } from '@nestjs/common';

import { InfrastructureModule } from '@api/infrastructure/infrastructure.module';
import { GetWelcomeMessageUseCase } from './use-cases/get-welcome-message.use-case';

@Module({
  imports: [InfrastructureModule],
  providers: [GetWelcomeMessageUseCase],
  exports: [GetWelcomeMessageUseCase],
})
export class ApplicationModule {}
