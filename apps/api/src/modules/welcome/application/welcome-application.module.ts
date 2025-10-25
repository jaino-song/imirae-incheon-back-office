import { Module } from '@nestjs/common';

import { WelcomeInfrastructureModule } from '../infrastructure/welcome-infrastructure.module';
import { GetWelcomeMessageUseCase } from './use-cases/get-welcome-message.use-case';

@Module({
  imports: [WelcomeInfrastructureModule],
  providers: [GetWelcomeMessageUseCase],
  exports: [GetWelcomeMessageUseCase],
})
export class WelcomeApplicationModule {}
