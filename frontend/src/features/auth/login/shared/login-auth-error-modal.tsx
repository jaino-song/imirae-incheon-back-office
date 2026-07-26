"use client";

import { useRouter, useSearchParams } from "next/navigation";

import { NotificationOneButtonModal } from "@/components/app/ui/NotificationOneButtonModal";
import { getAuthErrorDialog } from "@/lib/auth/auth-errors";
import { AUTH_ROUTES } from "@/lib/auth/routes";

export function LoginAuthErrorModal() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const dialog = getAuthErrorDialog(searchParams.get("authError"));

  const dismiss = () => {
    router.replace(AUTH_ROUTES.login);
  };

  if (!dialog) return null;

  return (
    <NotificationOneButtonModal
      open
      onOpenChange={(open) => {
        if (!open) dismiss();
      }}
      title={dialog.title}
      description={dialog.description}
      isDescriptionVisuallyHidden={false}
      onAcknowledge={dismiss}
      dataComponent="desktop_auth_login_error-modal"
    />
  );
}
