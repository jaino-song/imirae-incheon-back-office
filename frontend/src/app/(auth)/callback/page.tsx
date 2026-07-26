"use client";

import { Suspense } from "react";

import { CallbackPageDesktop } from "@/features/auth/callback/desktop/callback-page-desktop";
import { CallbackPageMobile } from "@/features/auth/callback/mobile/callback-page-mobile";
import { useAuthShellVariant } from "@/features/auth/shared/use-auth-shell-variant";

export default function AuthCallbackPage() {
  return (
    <Suspense fallback={<AuthCallbackLoading />}>
      <AuthCallbackContent />
    </Suspense>
  );
}

function AuthCallbackContent() {
  const shellVariant = useAuthShellVariant({ deferUntilMounted: true });

  if (!shellVariant) {
    return <AuthCallbackLoading />;
  }

  return shellVariant === "mobile" ? <CallbackPageMobile /> : <CallbackPageDesktop />;
}

function AuthCallbackLoading() {
  return <div data-component="desktop_auth_callback_loading" className="min-h-screen" />;
}
