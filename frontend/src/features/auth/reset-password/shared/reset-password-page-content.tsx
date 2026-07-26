"use client";

import { AlertTriangle, CheckCircle } from "lucide-react";

import { AuthInlineLink } from "@/components/auth/auth-inline-link";
import { FormField } from "@/components/auth/form-field";
import { PasswordRequirements } from "@/components/auth/password-requirements";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { MobileInputField } from "@/features/auth/shared/mobile/mobile-input-field";
import { AuthSurface, type AuthSurfaceVariant } from "@/features/auth/shared/ui/auth-surface";
import { cn } from "@/lib/utils";
import { useResetPasswordPageController } from "@/features/auth/reset-password/shared/use-reset-password-page-controller";

interface ResetPasswordPageContentProps {
  variant: AuthSurfaceVariant;
}

export function ResetPasswordPageContent({ variant }: ResetPasswordPageContentProps) {
  const {
    status,
    formData,
    error,
    fieldErrors,
    isLoading,
    passwordStrength,
    cardTitle,
    cardSubtitle,
    handleChange,
    handleSubmit,
    clearError,
    goToLogin,
    goToForgotPassword,
  } = useResetPasswordPageController();

  const actionButtonClassName = cn("w-full", variant === "mobile" && "rounded-2xl");

  return (
    <AuthSurface
      variant={variant}
      data-component="desktop_auth_reset-password"
      dataComponents={{
        container: "desktop_auth_reset-password",
        card: "desktop_auth_reset-password_card",
        header: "desktop_auth_reset-password_header",
        title: "desktop_auth_reset-password_title",
        subtitle: "desktop_auth_reset-password_subtitle",
        content: "desktop_auth_reset-password_content",
      }}
      title={cardTitle}
      subtitle={cardSubtitle}
      contentClassName="flex flex-col gap-6"
      mobileWrapperClassName="px-4 py-6"
    >
      {status === "invalid" ? (
        <div data-component="desktop_auth_reset-password_invalid" className="flex flex-col items-center gap-6 text-center">
          <div data-component="desktop_auth_reset-password_invalid_icon" className="rounded-full bg-destructive/10 p-3">
            <AlertTriangle className="h-12 w-12 text-destructive" />
          </div>
          <p className="text-muted-foreground">
            비밀번호 재설정 링크가 유효하지 않습니다.
            <br />
            이메일의 링크를 다시 확인해 주세요.
          </p>
          <Button
            data-component="desktop_auth_reset-password_invalid_retry-btn"
            variant="positive"
            size="lg"
            className={actionButtonClassName}
            onClick={goToForgotPassword}
          >
            비밀번호 재설정 다시 요청
          </Button>
          <AuthInlineLink
            dataComponent="desktop_auth_reset-password_invalid_login-link"
            href="/login"
            linkLabel="로그인 페이지로 돌아가기"
          />
        </div>
      ) : status === "success" ? (
        <div data-component="desktop_auth_reset-password_success" className="flex flex-col items-center gap-6 text-center">
          <div data-component="desktop_auth_reset-password_success_icon" className="rounded-full bg-success/10 p-3">
            <CheckCircle className="h-12 w-12 text-success" />
          </div>
          <p className="text-muted-foreground">새 비밀번호로 로그인할 수 있습니다.</p>
          <Button
            data-component="desktop_auth_reset-password_success_login-btn"
            variant="positive"
            size="lg"
            className={actionButtonClassName}
            onClick={goToLogin}
          >
            로그인하기
          </Button>
        </div>
      ) : (
        <>
          {error ? (
            <Alert variant="destructive" onClose={clearError}>
              {error}
            </Alert>
          ) : null}

          <form onSubmit={handleSubmit} data-component="desktop_auth_reset-password_form" className="flex flex-col gap-4">
            {variant === "mobile" ? (
              <MobileInputField
                title="새 비밀번호"
                message={fieldErrors.newPassword}
                messageTone="error"
                messageId={fieldErrors.newPassword ? "reset-password-new-error" : undefined}
                className="gap-2"
                labelClassName="text-sm"
                inputProps={{
                  id: "reset-password-new",
                  type: "password",
                  value: formData.newPassword ?? "",
                  onChange: handleChange("newPassword"),
                  disabled: isLoading,
                  autoComplete: "new-password",
                  autoFocus: true,
                  "aria-invalid": !!fieldErrors.newPassword,
                  "aria-describedby": fieldErrors.newPassword ? "reset-password-new-error" : undefined,
                }}
              />
            ) : (
              <FormField
                label="새 비밀번호"
                type="password"
                value={formData.newPassword}
                onChange={handleChange("newPassword")}
                error={fieldErrors.newPassword}
                disabled={isLoading}
                autoComplete="new-password"
                autoFocus
                data-component="desktop_auth_reset-password_form_new-field"
              />
            )}

            {formData.newPassword ? (
              <PasswordRequirements
                requirements={passwordStrength.requirements}
                className="animate-fade-in"
              />
            ) : null}

            {variant === "mobile" ? (
              <MobileInputField
                title="비밀번호 확인"
                message={fieldErrors.confirmPassword}
                messageTone="error"
                messageId={fieldErrors.confirmPassword ? "reset-password-confirm-error" : undefined}
                className="gap-2"
                labelClassName="text-sm"
                inputProps={{
                  id: "reset-password-confirm",
                  type: "password",
                  value: formData.confirmPassword ?? "",
                  onChange: handleChange("confirmPassword"),
                  disabled: isLoading,
                  autoComplete: "new-password",
                  "aria-invalid": !!fieldErrors.confirmPassword,
                  "aria-describedby": fieldErrors.confirmPassword ? "reset-password-confirm-error" : undefined,
                }}
              />
            ) : (
              <FormField
                label="비밀번호 확인"
                type="password"
                value={formData.confirmPassword}
                onChange={handleChange("confirmPassword")}
                error={fieldErrors.confirmPassword}
                disabled={isLoading}
                autoComplete="new-password"
                data-component="desktop_auth_reset-password_form_confirm-field"
              />
            )}

            <Button
              data-component="desktop_auth_reset-password_form_submit-btn"
              type="submit"
              variant="positive"
              size="lg"
              className={actionButtonClassName}
              disabled={isLoading}
            >
              {isLoading ? <Spinner size="sm" /> : "비밀번호 변경"}
            </Button>
          </form>

          <AuthInlineLink
            dataComponent="desktop_auth_reset-password_login-link"
            href="/login"
            linkLabel="로그인 페이지로 돌아가기"
          />
        </>
      )}
    </AuthSurface>
  );
}
