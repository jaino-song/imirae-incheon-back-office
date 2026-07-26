"use client";

import { AlertTriangle, CheckCircle } from "lucide-react";

import { FormField } from "@/components/auth/form-field";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { MobileInput } from "@/features/auth/shared/mobile/mobile-input";
import { MobileInputField } from "@/features/auth/shared/mobile/mobile-input-field";
import { AuthSurface, type AuthSurfaceVariant } from "@/features/auth/shared/ui/auth-surface";
import { cn } from "@/lib/utils";
import { useVerifyEmailPageController } from "@/features/auth/verify-email/shared/use-verify-email-page-controller";

interface VerifyEmailPageContentProps {
  variant: AuthSurfaceVariant;
}

export function VerifyEmailPageContent({ variant }: VerifyEmailPageContentProps) {
  const {
    status,
    message,
    resendEmail,
    resendLoading,
    resendMessage,
    handleResendChange,
    handleResendSubmit,
    goToLogin,
  } = useVerifyEmailPageController();

  const actionButtonClassName = cn("w-full", variant === "mobile" && "rounded-2xl");

  const cardTitle =
    status === "loading"
      ? "이메일 인증"
      : status === "success"
        ? "인증 완료!"
        : status === "error"
          ? "인증 실패"
          : "인증 토큰 없음";

  const cardSubtitle =
    status === "loading"
      ? "인증 상태를 확인하고 있습니다."
      : undefined;

  const showResendForm = status === "error" || status === "no-token";

  return (
    <AuthSurface
      variant={variant}
      data-component="desktop_auth_verify-email"
      dataComponents={{
        container: "desktop_auth_verify-email",
        card: "desktop_auth_verify-email_card",
        header: "desktop_auth_verify-email_header",
        title: "desktop_auth_verify-email_title",
        subtitle: "desktop_auth_verify-email_subtitle",
        content: "desktop_auth_verify-email_content",
      }}
      title={cardTitle}
      subtitle={cardSubtitle}
      contentClassName="flex flex-col gap-6"
      mobileWrapperClassName="px-4 py-6"
    >
      {status === "loading" ? (
        <div data-component="desktop_auth_verify-email_loading" className="flex flex-col items-center gap-4 py-2 text-center">
          <Spinner size="lg" className="text-primary" />
          <p className="text-muted-foreground">이메일 인증 중...</p>
        </div>
      ) : status === "success" ? (
        <div data-component="desktop_auth_verify-email_success" className="flex flex-col items-center gap-4 text-center">
          <div data-component="desktop_auth_verify-email_success_icon" className="rounded-full bg-success/10 p-3">
            <CheckCircle className="h-12 w-12 text-success" />
          </div>
          <p className="text-muted-foreground">{message}</p>
          <Button
            data-component="desktop_auth_verify-email_success_login-btn"
            variant="positive"
            size="lg"
            className={actionButtonClassName}
            onClick={goToLogin}
          >
            로그인하기
          </Button>
        </div>
      ) : (
        <div
          data-component={status === "error" ? "desktop_auth_verify-email_error" : "desktop_auth_verify-email_no-token"}
          className="flex flex-col items-center gap-4 text-center"
        >
          <div
            data-component={status === "error" ? "desktop_auth_verify-email_error-icon" : "desktop_auth_verify-email_no-token-icon"}
            className={cn(
              "rounded-full p-3",
              status === "error" ? "bg-destructive/10" : "bg-warning/10",
            )}
          >
            <AlertTriangle className={cn("h-12 w-12", status === "error" ? "text-destructive" : "text-warning")} />
          </div>
          <p className="text-muted-foreground">
            {status === "error" ? message : "이메일에서 인증 링크를 클릭해 주세요."}
          </p>

          {showResendForm ? (
            <>
              <Alert variant="info" className="w-full text-left">
                {status === "error"
                  ? "인증 링크가 만료되었거나 이미 사용된 경우, 아래에서 재발송을 요청할 수 있습니다."
                  : "인증 이메일을 받지 못하셨나요? 아래에서 재발송을 요청할 수 있습니다."}
              </Alert>

              <form onSubmit={handleResendSubmit} data-component="desktop_auth_verify-email_resend-form" className="flex w-full flex-col gap-3">
                {variant === "mobile" ? (
                  <MobileInputField
                    title="이메일 주소"
                    className="gap-2"
                    labelClassName="text-sm"
                    inputProps={{
                      id: "verify-email-resend",
                      type: "email",
                      value: resendEmail,
                      onChange: handleResendChange,
                      disabled: resendLoading,
                    }}
                    renderInput={(resolvedInputProps) => (
                      <MobileInput
                        {...resolvedInputProps}
                        data-component="desktop_auth_verify-email_resend-form_field"
                      />
                    )}
                  />
                ) : (
                  <FormField
                    label="이메일 주소"
                    type="email"
                    value={resendEmail}
                    onChange={handleResendChange}
                    disabled={resendLoading}
                    data-component="desktop_auth_verify-email_resend-form_field"
                  />
                )}

                {resendMessage ? (
                  <Alert variant={resendMessage.type === "success" ? "success" : "destructive"}>
                    {resendMessage.text}
                  </Alert>
                ) : null}

                <Button
                  data-component="desktop_auth_verify-email_resend-form_btn"
                  type="submit"
                  variant="positive-outline"
                  size="lg"
                  className={actionButtonClassName}
                  disabled={resendLoading || !resendEmail.trim()}
                >
                  {resendLoading ? <Spinner size="sm" /> : "인증 이메일 재발송"}
                </Button>
              </form>
            </>
          ) : null}

          <Button
            data-component="desktop_auth_verify-email_login-btn"
            variant="link"
            onClick={goToLogin}
          >
            로그인 페이지로 돌아가기
          </Button>
        </div>
      )}
    </AuthSurface>
  );
}
