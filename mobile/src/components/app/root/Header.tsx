"use client";

import { useState } from "react";
import { Menu, LogIn } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Sheet, SheetContent, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { NavBar } from "../nav-bar/nav-bar";
import { t } from "@/lib/i18n/translations";
import { useLocale } from "@/providers/LocaleProvider";
import { useGetAuthUser, AuthUser } from "@/hooks/useGetAuthUser";
import { NotificationBell } from "../notifications";

interface HeaderProps {
  // 서버에서 prefetch된 사용자 데이터 (duplicate fetch 방지)
  initialUser?: AuthUser | null;
}

export const Header = ({ initialUser }: HeaderProps) => {
  const locale = useLocale();
  const [isNavOpen, setIsNavOpen] = useState(false);

  const handleNavOpen = () => {
    setIsNavOpen(true);
  };

  const handleNavClose = () => {
    setIsNavOpen(false);
  };

  // initialUser가 있으면 즉시 사용, 없으면 client-side fetch
  const { data: user, isLoading } = useGetAuthUser({ initialData: initialUser });
  const isE2EAuth = typeof window !== 'undefined'
    && (window as Window & { __E2E_AUTH__?: boolean }).__E2E_AUTH__;

  const shouldShowNotifications = Boolean(user) || isE2EAuth;

  // Get user initials for avatar fallback
  const getUserInitials = (name?: string | null): string => {
    if (!name) return 'U';
    const parts = name.split(' ');
    if (parts.length === 1) return parts[0].charAt(0).toUpperCase();
    return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
  };

  return (
    <>
      {/* Navbar Sheet (mobile drawer) */}
      <Sheet open={isNavOpen} onOpenChange={setIsNavOpen}>
        <SheetContent side="left" className="w-[280px] sm:w-[320px] p-0 bg-sidebar text-sidebar-foreground border-sidebar-border">
          <SheetTitle className="sr-only">Navigation Menu</SheetTitle>
          <SheetDescription className="sr-only">Main navigation links for the application</SheetDescription>
          <NavBar onClose={handleNavClose} />
        </SheetContent>
      </Sheet>

      {/* Header */}
      <header
        data-component="mobile_shell_app-header_bar"
        className="sticky top-0 z-50 w-full border-b bg-white shadow-[0_4px_24px_hsla(214,50%,20%,0.06)] rounded-b-2xl sm:rounded-none"
      >
        <div className="flex h-16 sm:h-18 items-center gap-3 px-4">
          {/* Menu Icon */}
          <Button
            variant="ghost"
            size="icon"
            onClick={handleNavOpen}
            aria-label="open navigation"
            className="shrink-0"
          >
            <Menu className="h-5 w-5" />
          </Button>

          {/* Company Name */}
          <div className="flex-1 min-w-0">
            <h1 className="text-base sm:text-lg font-semibold truncate">
              {t(locale, "header.companyName")}
            </h1>
            <p className="text-xs sm:text-sm text-muted-foreground truncate">
              {t(locale, "header.companySubtitle")}
            </p>
          </div>

          {/* Notifications */}
          {shouldShowNotifications && (
            <NotificationBell data-component="mobile_shell_app-header_bar_notification-bell" className="rounded-full p-2 hover:bg-gray-100 transition-all duration-200 ease-in-out" />
          )}

          {/* User Profile */}
          <Button
            variant="ghost"
            size="icon"
            aria-label={user ? "user profile" : "login"}
            disabled={!initialUser && isLoading}
            className="shrink-0 transition-transform duration-200 hover:scale-110 active:scale-95"
          >
            {!initialUser && isLoading ? (
              <Avatar className="h-10 w-10">
                <AvatarFallback className="animate-pulse bg-muted" />
              </Avatar>
            ) : user ? (
              <Avatar className="h-10 w-10">
                <AvatarImage src={user?.profileImage || ''} alt={user?.name || 'User'} />
                <AvatarFallback className="bg-primary text-primary-foreground text-sm">{getUserInitials(user?.name)}</AvatarFallback>
              </Avatar>
            ) : (
              <LogIn className="h-5 w-5" />
            )}
          </Button>
        </div>
      </header>
    </>
  );
}
