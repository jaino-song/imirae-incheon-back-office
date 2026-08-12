import type { Metadata, Viewport } from "next";
import { Suspense } from "react";
import "../globals.css";
import localFont from "next/font/local";
import { getLocale } from "../actions/locale";
import { getCurrentUser } from "@/lib/auth/cookies";
import { MobileShellProviders } from "@/components/app/root/mobile-shell-providers";
import { PwaLaunchScreen } from "@/components/app/root/pwa-launch-screen";
import { IOS_STARTUP_IMAGES } from "@/lib/pwa/ios-startup-images";

const Pretendard = localFont({
  src: "../fonts/Pretendard.woff2",
  variable: "--font-pretendard",
  display: "swap",
});

export const metadata: Metadata = {
  title: "아가잼잼 관리자",
  description: "아가잼잼 관리자",
  manifest: "/manifest.json",
  icons: {
    icon: "/icon.svg",
    apple: "/apple-touch-icon.png",
    other: [...IOS_STARTUP_IMAGES],
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
  const userPromise = getCurrentUser();

  return (
    <html lang={locale}>
      <body className={`${Pretendard.variable} antialiased min-h-screen bg-v3-dim-white`}>
        {/*
          `mobile-app-root` is a styling hook paired with data-slot="app-root" so
          globals.css's shell-geometry guard keeps its (0,2,2) specificity over
          redesign.css's (0,2,0) phone-frame rules. Do not drop it.
        */}
        <div
          data-component="mobile_shell_root"
          data-slot="app-root"
          className="mobile-app-root relative h-[100dvh] w-[100vw] max-w-none overflow-hidden [--mobile-shell-max-height:100dvh]"
        >
          <div
            data-component="mobile_shell_root_app-shell"
            data-slot="app-shell"
            className="relative h-full min-h-0 w-full overflow-hidden"
          >
            <Suspense
              fallback={<PwaLaunchScreen data-component="mobile_shell_root_auth-loading" />}
            >
              <MobileShellProviders locale={locale} userPromise={userPromise}>
                {children}
              </MobileShellProviders>
            </Suspense>
          </div>
        </div>
      </body>
    </html>
  );
}
