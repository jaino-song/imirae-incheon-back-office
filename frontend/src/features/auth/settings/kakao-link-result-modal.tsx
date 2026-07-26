"use client";

import { useRouter, useSearchParams } from "next/navigation";

import { NotificationOneButtonModal } from "@/components/app/ui/NotificationOneButtonModal";
import { getAuthErrorDialog } from "@/lib/auth/auth-errors";

export function KakaoLinkResultModal() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const isLinked = searchParams.get("kakaoLinked") === "true";
  const errorDialog = getAuthErrorDialog(searchParams.get("authError"));
  const dialog = isLinked
    ? {
        title: "카카오 계정이 연결되었습니다.",
        description: "이제 카카오 계정으로도 로그인할 수 있습니다.",
      }
    : errorDialog;

  if (!dialog) return null;

  const dismiss = () => router.replace("/settings");

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
      dataComponent="desktop_settings_sections_kakao-link-result-modal"
    />
  );
}
