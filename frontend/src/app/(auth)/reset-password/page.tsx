"use client";

import { Suspense } from "react";

import { ResetPasswordPageDesktop } from "@/features/auth/reset-password/desktop/reset-password-page-desktop";
import { ResetPasswordPageMobile } from "@/features/auth/reset-password/mobile/reset-password-page-mobile";
import { useAuthShellVariant } from "@/features/auth/shared/use-auth-shell-variant";

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={<ResetPasswordLoading />}>
      <ResetPasswordContent />
    </Suspense>
  );
}

function ResetPasswordContent() {
  const shellVariant = useAuthShellVariant({ deferUntilMounted: true });

  if (!shellVariant) {
    return <ResetPasswordLoading />;
  }

  return shellVariant === "mobile" ? <ResetPasswordPageMobile /> : <ResetPasswordPageDesktop />;
}

function ResetPasswordLoading() {
  return <div data-component="desktop_auth_reset-password_loading" className="min-h-screen" />;
}
