import { Module } from '@nestjs/common';

import { ApplicationModule } from '@api/core/application/application.module';

import { WelcomeController } from './http/controllers/welcome.controller';

@Module({
  imports: [ApplicationModule],
  controllers: [WelcomeController],
})
export class PresentationModule {}
