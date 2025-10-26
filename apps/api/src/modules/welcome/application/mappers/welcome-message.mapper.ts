import type { WelcomeMessage } from '../../domain/entities/welcome-message.entity';
import type { GetWelcomeMessageResponse } from '../dto/get-welcome-message.response';

export class WelcomeMessageMapper {
  static toResponse(entity: WelcomeMessage): GetWelcomeMessageResponse {
    const snapshot = entity.toSnapshot();

    return {
      title: snapshot.title,
      description: snapshot.description,
      links: snapshot.links.map((link) => ({ ...link })),
    };
  }
}
