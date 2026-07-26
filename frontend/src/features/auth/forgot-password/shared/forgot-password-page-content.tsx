"use client";

import { CheckCircle } from "lucide-react";

import { AuthInlineLink } from "@/components/auth/auth-inline-link";
import { FormField } from "@/components/auth/form-field";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { MobileInput } from "@/features/auth/shared/mobile/mobile-input";
import { MobileInputField } from "@/features/auth/shared/mobile/mobile-input-field";
import { AuthSurface, type AuthSurfaceVariant } from "@/features/auth/shared/ui/auth-surface";
import { cn } from "@/lib/utils";
import { useForgotPasswordPageController } from "@/features/auth/forgot-password/shared/use-forgot-password-page-controller";

interface ForgotPasswordPageContentProps {
  variant: AuthSurfaceVariant;
}

export function ForgotPasswordPageContent({ variant }: ForgotPasswordPageContentProps) {
  const {
    email,
    error,
    isLoading,
    isSuccess,
    cardTitle,
    cardSubtitle,
    handleEmailChange,
    handleSubmit,
    clearError,
    goToLogin,
  } = useForgotPasswordPageController();

  const actionButtonClassName = cn("w-full", variant === "mobile" && "rounded-2xl");

  return (
    <AuthSurface
      variant={variant}
      data-component="desktop_auth_forgot-password"
      dataComponents={{
        container: "desktop_auth_forgot-password",
        card: "desktop_auth_forgot-password_card",
        header: "desktop_auth_forgot-password_header",
        title: "desktop_auth_forgot-password_title",
        subtitle: "desktop_auth_forgot-password_subtitle",
        content: "desktop_auth_forgot-password_content",
      }}
      title={cardTitle}
      subtitle={cardSubtitle}
      contentClassName="flex flex-col gap-6"
      mobileWrapperClassName="px-4 py-6"
    >
      {isSuccess ? (
        <div data-component="desktop_auth_forgot-password_success" className="flex flex-col items-center gap-6 text-center">
          <div data-component="desktop_auth_forgot-password_success_icon" className="rounded-full bg-success/10 p-3">
            <CheckCircle className="h-12 w-12 text-success" />
          </div>
          <div data-component="desktop_auth_forgot-password_success_message" className="flex flex-col text-center text-muted-foreground">
            <div data-component="desktop_auth_forgot-password_success_message_lines" className="flex flex-col">
              <p>
                <strong className="text-foreground">{email}</strong>로
              </p>
              <p>비밀번호 재설정 링크가 전송되었습니다.</p>
            </div>
          </div>
          <p className="text-center text-muted-foreground">이메일을 확인하여 비밀번호를 재설정해 주세요.</p>
          <Alert variant="info" className="w-full text-left">
            이메일이 도착하지 않았다면 스팸 폴더를 확인해 주세요.
          </Alert>
          <Button
            data-component="desktop_auth_forgot-password_success_login-btn"
            variant="positive"
            size="lg"
            className={actionButtonClassName}
            onClick={goToLogin}
          >
            로그인 페이지로 돌아가기
          </Button>
        </div>
      ) : (
        <>
          {error ? (
            <Alert variant="destructive" onClose={clearError}>
              {error}
            </Alert>
          ) : null}

          <form onSubmit={handleSubmit} data-component="desktop_auth_forgot-password_form" className="flex flex-col gap-4">
            {variant === "mobile" ? (
              <MobileInputField
                title="이메일"
                className="gap-2"
                labelClassName="text-sm"
                inputProps={{
                  id: "forgot-password-email",
                  type: "email",
                  value: email,
                  onChange: handleEmailChange,
                  disabled: isLoading,
                  autoComplete: "email",
                  autoFocus: true,
                }}
                renderInput={(resolvedInputProps) => (
                  <MobileInput
                    {...resolvedInputProps}
                    data-component="desktop_auth_forgot-password_form_email-field"
                  />
                )}
              />
            ) : (
              <FormField
                label="이메일"
                type="email"
                value={email}
                onChange={handleEmailChange}
                disabled={isLoading}
                autoComplete="email"
                autoFocus
                data-component="desktop_auth_forgot-password_form_email-field"
              />
            )}

            <Button
              data-component="desktop_auth_forgot-password_form_submit-btn"
              type="submit"
              variant="positive"
              size="lg"
              className={actionButtonClassName}
              disabled={isLoading || !email.trim()}
            >
              {isLoading ? <Spinner size="sm" /> : "비밀번호 재설정 링크 전송"}
            </Button>
          </form>

          <AuthInlineLink
            dataComponent="desktop_auth_forgot-password_login-link"
            href="/login"
            prefixText="비밀번호가 기억나셨나요?"
            linkLabel="로그인"
          />
        </>
      )}
    </AuthSurface>
  );
}
