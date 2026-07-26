"use client";

import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { AuthSurface, type AuthSurfaceVariant } from "@/features/auth/shared/ui/auth-surface";
import { useCallbackPageController } from "@/features/auth/callback/shared/use-callback-page-controller";

interface CallbackPageContentProps {
  variant: AuthSurfaceVariant;
}

export function CallbackPageContent({ variant }: CallbackPageContentProps) {
  const { error, status, goToLogin } = useCallbackPageController();

  return (
    <AuthSurface
      variant={variant}
      data-component="desktop_auth_callback"
      dataComponents={{
        container: "desktop_auth_callback",
        card: "desktop_auth_callback_card",
        header: "desktop_auth_callback_header",
        title: "desktop_auth_callback_title",
        subtitle: "desktop_auth_callback_subtitle",
        content: "desktop_auth_callback_content",
      }}
      title={status === "error" ? "로그인 실패" : "로그인 중..."}
      subtitle={status === "error" ? undefined : "인증 정보를 확인하고 있습니다."}
      contentClassName="flex flex-col items-center gap-4 text-center"
      mobileWrapperClassName="px-4 py-6"
    >
      {status === "error" ? (
        <>
          <p className="text-destructive">{error}</p>
          <Button
            data-component="desktop_auth_callback_login-btn"
            variant="link"
            onClick={goToLogin}
          >
            로그인 페이지로 돌아가기
          </Button>
        </>
      ) : (
        <>
          <Spinner size="lg" />
          <p className="text-foreground">로그인 중...</p>
        </>
      )}
    </AuthSurface>
  );
}
