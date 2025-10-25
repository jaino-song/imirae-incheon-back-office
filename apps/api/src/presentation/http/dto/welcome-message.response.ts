import type { WelcomeLink, WelcomeMessage as WelcomeMessageDTO } from '@shared-types';

import { WelcomeMessage } from '@api/core/domain/entities/welcome-message.entity';

export class WelcomeMessageResponseDto implements WelcomeMessageDTO {
  title: string;
  description: string;
  links: WelcomeLink[];

  private constructor(init: WelcomeMessageResponseDto) {
    this.title = init.title;
    this.description = init.description;
    this.links = init.links.map((link) => ({ ...link }));
  }

  static fromEntity(entity: WelcomeMessage): WelcomeMessageResponseDto {
    const plain = entity.toObject();

    return new WelcomeMessageResponseDto({
      title: plain.title,
      description: plain.description,
      links: plain.links,
    });
  }
}
