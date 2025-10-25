export interface WelcomeLinkProps {
  label: string;
  href: string;
}

export interface WelcomeMessageProps {
  title: string;
  description: string;
  links: WelcomeLinkProps[];
}

export class WelcomeMessage {
  constructor(private readonly props: WelcomeMessageProps) {}

  get title(): string {
    return this.props.title;
  }

  get description(): string {
    return this.props.description;
  }

  get links(): WelcomeLinkProps[] {
    return this.props.links.map((link) => ({ ...link }));
  }

  toObject(): WelcomeMessageProps {
    return {
      title: this.title,
      description: this.description,
      links: this.links,
    };
  }
}
