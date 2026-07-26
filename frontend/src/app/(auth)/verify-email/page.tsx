"use client";

import { Suspense } from "react";

import { VerifyEmailPageDesktop } from "@/features/auth/verify-email/desktop/verify-email-page-desktop";
import { VerifyEmailPageMobile } from "@/features/auth/verify-email/mobile/verify-email-page-mobile";
import { useAuthShellVariant } from "@/features/auth/shared/use-auth-shell-variant";

export default function VerifyEmailPage() {
  return (
    <Suspense fallback={<VerifyEmailLoading />}>
      <VerifyEmailContent />
    </Suspense>
  );
}

function VerifyEmailContent() {
  const shellVariant = useAuthShellVariant({ deferUntilMounted: true });

  if (!shellVariant) {
    return <VerifyEmailLoading />;
  }

  return shellVariant === "mobile" ? <VerifyEmailPageMobile /> : <VerifyEmailPageDesktop />;
}

function VerifyEmailLoading() {
  return <div data-component="desktop_auth_verify-email_loading" className="min-h-screen" />;
}
