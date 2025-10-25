import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { PresentationModule } from './presentation/presentation.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['apps/api/.env', '.env'],
    }),
    PresentationModule,
  ],
})
export class AppModule {}
