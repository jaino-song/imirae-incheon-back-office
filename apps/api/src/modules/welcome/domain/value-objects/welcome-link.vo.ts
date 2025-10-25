export interface WelcomeLinkProps {
  label: string;
  href: string;
}

export class WelcomeLink {
  private constructor(private readonly props: WelcomeLinkProps) {}

  static create({ label, href }: WelcomeLinkProps): WelcomeLink {
    const trimmedLabel = label.trim();
    const trimmedHref = href.trim();

    if (!trimmedLabel) {
      throw new Error('WelcomeLink.label cannot be empty');
    }

    if (!trimmedHref) {
      throw new Error('WelcomeLink.href cannot be empty');
    }

    return new WelcomeLink({ label: trimmedLabel, href: trimmedHref });
  }

  get label(): string {
    return this.props.label;
  }

  get href(): string {
    return this.props.href;
  }

  toObject(): WelcomeLinkProps {
    return { label: this.label, href: this.href };
  }
}
