import { redirect } from "next/navigation";

import { V3MainContent } from "@/components/app/v3/V3MainContent";
import { V3MobileHeader } from "@/components/app/v3/V3MobileHeader";
import { V3Sidebar } from "@/components/app/v3/V3Sidebar";
import { NotificationPermissionPrompt } from "@/components/app/notification-permission-prompt";
import { MobileBottomNav } from "@/components/app/root/mobile-bottom-nav";
import { getCurrentUser } from "@/lib/auth/cookies";
import { UserProvider } from "@/providers/UserProvider";

export default async function ProtectedLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const user = await getCurrentUser();

  if (!user) {
    redirect("/login");
  }

  return (
    <UserProvider user={user}>
      <NotificationPermissionPrompt />
      <V3Sidebar />
      <V3MobileHeader />
      <V3MainContent data-component="desktop_shell_main-content">{children}</V3MainContent>
      <MobileBottomNav />
    </UserProvider>
  );
}
