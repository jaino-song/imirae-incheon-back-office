import type { Metadata, Viewport } from "next";
import "./globals.css";
import { QueryProvider } from "@/providers/QueryProvider";
import localFont from "next/font/local";
import { LocaleProvider } from "@/providers/LocaleProvider";
import { getLocale } from "./actions/locale";
import { Toaster } from "@/components/ui/toaster";

const Pretendard = localFont({
  src: "./fonts/Pretendard.woff2",
  variable: "--font-pretendard",
  display: "swap",
});

export const metadata: Metadata = {
  title: "아가잼잼 관리자",
  description: "아가잼잼 관리자",
  manifest: "/manifest.json",
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "32x32" },
      { url: "/icon.svg", type: "image/svg+xml" },
    ],
    apple: "/apple-touch-icon.png",
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "아가잼잼",
  },
  formatDetection: {
    telephone: false,
  },
};

export const viewport: Viewport = {
  themeColor: "#12366a",
  width: "device-width",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const locale = await getLocale();

  return (
    <html lang={locale}>
      <body className={`${Pretendard.variable} antialiased min-h-screen`} suppressHydrationWarning>
        <div data-component="desktop_shell_root">
          <div data-component="desktop_shell_root_providers">
            <QueryProvider>
              <LocaleProvider locale={locale}>
                {children}
                <Toaster />
              </LocaleProvider>
            </QueryProvider>
          </div>
        </div>
      </body>
    </html>
  );
}
