export interface WelcomeLink {
  label: string;
  href: string;
}

export interface WelcomeMessage {
  title: string;
  description: string;
  links: WelcomeLink[];
}

export const defaultWelcomeMessage: WelcomeMessage = {
  title: 'To get started, edit the page.tsx file.',
  description:
    'Looking for a starting point or more instructions? Explore the resources below to continue building.',
  links: [
    {
      label: 'Templates',
      href: 'https://vercel.com/templates?framework=next.js&utm_source=create-next-app&utm_medium=appdir-template-tw&utm_campaign=create-next-app',
    },
    {
      label: 'Learning',
      href: 'https://nextjs.org/learn?utm_source=create-next-app&utm_medium=appdir-template-tw&utm_campaign=create-next-app',
    },
  ],
};
