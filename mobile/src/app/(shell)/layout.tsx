import type { Metadata, Viewport } from "next";
import "../globals.css";
import { QueryProvider } from "@/providers/QueryProvider";
import localFont from "next/font/local";
import { LocaleProvider } from "@/providers/LocaleProvider";
import { getLocale } from "../actions/locale";
import { getCurrentUser } from "@/lib/auth/cookies";
import { UserProvider } from "@/providers/UserProvider";
import { NotificationPermissionPrompt } from "@/components/app/notification-permission-prompt";
import { Toaster } from "@/components/ui/toaster";
import { ContractsPrefetchCoordinator } from "@/components/app/root/contracts-prefetch-coordinator";
import { MobileBottomNav } from "@/components/app/root/mobile-bottom-nav";
import { V3Sidebar } from "@/components/app/v3/V3Sidebar";
import { V3MobileHeader } from "@/components/app/v3/V3MobileHeader";
import { V3MainContent } from "@/components/app/v3/V3MainContent";
import { FloatingQuickActions } from "@/components/app/v3/FloatingQuickActions";

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
  const user = await getCurrentUser();

  return (
    <html lang={locale}>
      <body className={`${Pretendard.variable} antialiased min-h-screen bg-v3-dim-white`}>
        <div
          data-component="app-root"
          data-slot="app-root"
          className="relative h-[100dvh] w-[100vw] max-w-none overflow-hidden [--mobile-shell-max-height:100dvh]"
        >
          <div
            data-component="mobile_shell_app-shell"
            data-slot="app-shell"
            className="relative h-full min-h-0 w-full overflow-hidden"
          >
            <QueryProvider>
              <LocaleProvider locale={locale}>
                <UserProvider user={user}>
                  <div
                    data-component="app-providers"
                    data-slot="app-content"
                    className="relative h-full min-h-0 w-full overflow-hidden"
                  >
                    <ContractsPrefetchCoordinator />
                    <NotificationPermissionPrompt />
                    <V3Sidebar />
                    <V3MobileHeader />
                    <V3MainContent>
                      {children}
                    </V3MainContent>
                    <FloatingQuickActions />
                    <Toaster />
                    <MobileBottomNav />
                  </div>
                </UserProvider>
              </LocaleProvider>
            </QueryProvider>
          </div>
        </div>
      </body>
    </html>
  );
}
