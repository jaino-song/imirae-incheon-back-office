import { Controller, Get } from '@nestjs/common';

import { GetWelcomeMessageUseCase } from '@api/core/application/use-cases/get-welcome-message.use-case';

import { WelcomeMessageResponseDto } from '../dto/welcome-message.response';

@Controller()
export class WelcomeController {
  constructor(private readonly getWelcomeMessageUseCase: GetWelcomeMessageUseCase) {}

  @Get()
  async getWelcome(): Promise<WelcomeMessageResponseDto> {
    const welcomeMessage = await this.getWelcomeMessageUseCase.execute();
    return WelcomeMessageResponseDto.fromEntity(welcomeMessage);
  }
}
