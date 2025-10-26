import { Controller, Get } from '@nestjs/common';

import { GetWelcomeMessageUseCase } from '../../application/use-cases/get-welcome-message.use-case';
import type { GetWelcomeMessageResponse } from '../../application/dto/get-welcome-message.response';

@Controller()
export class WelcomeController {
  constructor(private readonly getWelcomeMessageUseCase: GetWelcomeMessageUseCase) {}

  @Get()
  getWelcome(): Promise<GetWelcomeMessageResponse> {
    return this.getWelcomeMessageUseCase.execute();
  }
}
