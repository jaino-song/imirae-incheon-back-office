import { Module } from '@nestjs/common';

import { WelcomePresentationModule } from './presentation/welcome-presentation.module';

@Module({
  imports: [WelcomePresentationModule],
})
export class WelcomeModule {}
