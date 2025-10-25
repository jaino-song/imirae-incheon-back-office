import { Injectable } from '@nestjs/common';
import { defaultWelcomeMessage, type WelcomeMessage } from '@shared-types';

@Injectable()
export class AppService {
  getWelcomeMessage(): WelcomeMessage {
    return defaultWelcomeMessage;
  }
}
