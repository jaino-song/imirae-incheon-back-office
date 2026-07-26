"use client";

import { useRouter, useSearchParams } from "next/navigation";

import { NotificationOneButtonModal } from "@/components/app/ui/NotificationOneButtonModal";
import { getAuthErrorDialog } from "@/lib/auth/auth-errors";

export function LoginAuthErrorModal() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const dialog = getAuthErrorDialog(searchParams.get("authError"));

  if (!dialog) return null;

  const dismiss = () => router.replace("/login");

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
      data-component="mobile_auth_login_error-modal"
    />
  );
}
