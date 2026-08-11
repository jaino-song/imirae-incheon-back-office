import type { ReactNode } from "react";

import type { Locale } from "@/app/actions/locale";
import { ContractsPrefetchCoordinator } from "@/components/app/root/contracts-prefetch-coordinator";
import { FloatingQuickActions } from "@/components/app/v3/FloatingQuickActions";
import { MobileBottomNav } from "@/components/app/root/mobile-bottom-nav";
import { NotificationPermissionPrompt } from "@/components/app/notification-permission-prompt";
import { V3MainContent } from "@/components/app/v3/V3MainContent";
import { V3MobileHeader } from "@/components/app/v3/V3MobileHeader";
import { V3Sidebar } from "@/components/app/v3/V3Sidebar";
import { Toaster } from "@/components/ui/toaster";
import { getCurrentUser } from "@/lib/auth/cookies";
import { LocaleProvider } from "@/providers/LocaleProvider";
import { QueryProvider } from "@/providers/QueryProvider";
import { UserProvider } from "@/providers/UserProvider";

interface MobileShellProvidersProps {
  children: ReactNode;
  locale: Locale;
  userPromise: ReturnType<typeof getCurrentUser>;
}

export async function MobileShellProviders({
  children,
  locale,
  userPromise,
}: MobileShellProvidersProps) {
  const user = await userPromise;

  return (
    <QueryProvider>
      <LocaleProvider locale={locale}>
        <UserProvider user={user}>
          <div
            data-component="mobile_shell_root_app-shell_providers"
            data-slot="app-content"
            className="relative h-full min-h-0 w-full overflow-hidden"
          >
            <ContractsPrefetchCoordinator />
            <NotificationPermissionPrompt />
            <V3Sidebar data-component="mobile_shell_sidebar" />
            <V3MobileHeader data-component="mobile_shell_header" />
            <V3MainContent data-component="mobile_shell_main-content">{children}</V3MainContent>
            <FloatingQuickActions />
            <Toaster />
            <MobileBottomNav />
          </div>
        </UserProvider>
      </LocaleProvider>
    </QueryProvider>
  );
}
