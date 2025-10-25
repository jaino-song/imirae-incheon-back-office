import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { WelcomeModule } from './modules/welcome/welcome.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['apps/api/.env', '.env'],
    }),
    WelcomeModule,
  ],
})
export class AppModule {}
