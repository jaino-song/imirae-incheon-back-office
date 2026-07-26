"use client";

import { Suspense } from "react";
import dynamic from "next/dynamic";

import { LoginAuthErrorModal } from "@/features/auth/login/shared/login-auth-error-modal";
import { useAuthShellVariant } from "@/features/auth/shared/use-auth-shell-variant";

function AuthLoginLoading() {
  return <div data-component="desktop_auth_login_loading" className="min-h-screen" />;
}

const LoginPageDesktop = dynamic(
  () => import("@/features/auth/login/desktop/login-page-desktop").then((mod) => mod.LoginPageDesktop),
  { ssr: false, loading: AuthLoginLoading },
);

const LoginPageMobile = dynamic(
  () => import("@/features/auth/login/mobile/login-page-mobile").then((mod) => mod.LoginPageMobile),
  { ssr: false, loading: AuthLoginLoading },
);

export default function LoginPage() {
  return (
    <Suspense fallback={<AuthLoginLoading />}>
      <LoginPageContent />
    </Suspense>
  );
}

function LoginPageContent() {
  const shellVariant = useAuthShellVariant({ deferUntilMounted: true });

  if (!shellVariant) {
    return <AuthLoginLoading />;
  }

  return (
    <>
      {shellVariant === "mobile" ? <LoginPageMobile /> : <LoginPageDesktop />}
      <LoginAuthErrorModal />
    </>
  );
}
