import { Module } from '@nestjs/common';

import { WelcomeApplicationModule } from '../application/welcome-application.module';
import { WelcomeController } from './http/welcome.controller';

@Module({
  imports: [WelcomeApplicationModule],
  controllers: [WelcomeController],
})
export class WelcomePresentationModule {}
