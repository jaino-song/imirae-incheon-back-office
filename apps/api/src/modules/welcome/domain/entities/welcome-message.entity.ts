import { WelcomeLink, type WelcomeLinkProps } from '../value-objects/welcome-link.vo';

export interface WelcomeMessageSnapshot {
  title: string;
  description: string;
  links: WelcomeLinkProps[];
}

interface WelcomeMessageProps {
  title: string;
  description: string;
  links: WelcomeLink[];
}

interface WelcomeMessageCreateProps {
  title: string;
  description: string;
  links: WelcomeLinkProps[];
}

export class WelcomeMessage {
  private constructor(private readonly props: WelcomeMessageProps) {}

  static create({ title, description, links }: WelcomeMessageCreateProps): WelcomeMessage {
    const normalizedTitle = title.trim();
    const normalizedDescription = description.trim();

    if (!normalizedTitle) {
      throw new Error('WelcomeMessage.title cannot be empty');
    }

    if (!normalizedDescription) {
      throw new Error('WelcomeMessage.description cannot be empty');
    }

    if (!links.length) {
      throw new Error('WelcomeMessage.links cannot be empty');
    }

    return new WelcomeMessage({
      title: normalizedTitle,
      description: normalizedDescription,
      links: links.map((link) => WelcomeLink.create(link)),
    });
  }

  get title(): string {
    return this.props.title;
  }

  get description(): string {
    return this.props.description;
  }

  get links(): WelcomeLink[] {
    return this.props.links.map((link) => WelcomeLink.create(link.toObject()));
  }

  toSnapshot(): WelcomeMessageSnapshot {
    return {
      title: this.title,
      description: this.description,
      links: this.props.links.map((link) => link.toObject()),
    };
  }
}
