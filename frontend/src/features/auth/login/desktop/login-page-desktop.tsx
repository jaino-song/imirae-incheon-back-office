"use client";

import { AuthInlineLink } from "@/components/auth/auth-inline-link";
import { AuthPanel } from "@/components/auth/auth-panel";
import { FormField } from "@/components/auth/form-field";
import { OAuthButtons } from "@/components/auth/oauth-buttons";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { useLocale } from "@/providers/LocaleProvider";
import { t } from "@/lib/i18n/translations";
import { useLoginPageController } from "@/features/auth/login/shared/use-login-page-controller";

export function LoginPageDesktop() {
  const locale = useLocale();
  const {
    autoLogin,
    rememberId,
    formData,
    errors,
    serverError,
    isLoading,
    emailVerificationRequired,
    isResendingVerification,
    setAutoLogin,
    setRememberId,
    handleChange,
    handleSubmit,
    handleResendVerification,
    clearServerError,
  } = useLoginPageController();

  return (
    <AuthPanel
      data-component="desktop_auth_login"
      dataComponents={{
        container: "desktop_auth_login_container",
        card: "desktop_auth_login_card",
        header: "desktop_auth_login_header",
        title: "desktop_auth_login_title",
        subtitle: "desktop_auth_login_subtitle",
        content: "desktop_auth_login_content",
      }}
      contentClassName="flex flex-col gap-6"
      title={t(locale, "login.title")}
      subtitle={t(locale, "login.subtitle")}
    >
      {serverError ? (
        <Alert
          variant="destructive"
          onClose={clearServerError}
        >
          <div data-component="desktop_auth_login_error-message">
            {serverError}
            {emailVerificationRequired ? (
              <div data-component="desktop_auth_login_error-message_verify-email" className="mt-2">
                {isResendingVerification ? (
                  "재전송 중..."
                ) : (
                  <>
                    이메일이 오지 않았다면{" "}
                    <button
                      type="button"
                      data-component="desktop_auth_login_error-message_verify-email_resend-verification-link"
                      onClick={handleResendVerification}
                      className="text-destructive underline hover:no-underline"
                    >
                      재전송
                    </button>
                    을 눌러주세요.
                  </>
                )}
              </div>
            ) : null}
          </div>
        </Alert>
      ) : null}

      <form data-component="desktop_auth_login_form" onSubmit={handleSubmit} className="space-y-4">
        <FormField
          id="login-email"
          data-component="desktop_auth_login_form_auth-login-email-field"
          label="이메일"
          type="email"
          value={formData.email}
          onChange={handleChange("email")}
          error={errors.email}
          disabled={isLoading}
          autoComplete="email"
        />

        <FormField
          id="login-password"
          data-component="desktop_auth_login_form_auth-login-password-field"
          label="비밀번호"
          type="password"
          value={formData.password}
          onChange={handleChange("password")}
          error={errors.password}
          disabled={isLoading}
          autoComplete="current-password"
        />

        <div data-component="desktop_auth_login_form_checkboxes" className="flex items-center gap-6 pt-1">
          <div data-component="desktop_auth_login_form_checkboxes_checkbox-remember-id" className="flex items-center gap-2">
            <Checkbox
              id="login-remember-id"
              checked={rememberId}
              onCheckedChange={(checked) => setRememberId(checked === true)}
              disabled={isLoading}
            />
            <Label htmlFor="login-remember-id" className="text-sm text-muted-foreground select-none">
              아이디 저장
            </Label>
          </div>

          <div data-component="desktop_auth_login_form_checkboxes_checkbox-auto-login" className="flex items-center gap-2">
            <Checkbox
              id="login-auto-login"
              checked={autoLogin}
              onCheckedChange={(checked) => setAutoLogin(checked === true)}
              disabled={isLoading}
            />
            <Label htmlFor="login-auto-login" className="text-sm text-muted-foreground select-none">
              자동 로그인
            </Label>
          </div>
        </div>

        <Button
          data-component="desktop_auth_login_form_submit-button"
          type="submit"
          variant="positive"
          size="lg"
          className="w-full"
          disabled={isLoading}
        >
          {isLoading ? <Spinner size="sm" /> : "로그인"}
        </Button>
      </form>

      <div data-component="desktop_auth_login_divider" className="relative">
        <div data-component="desktop_auth_login_divider_line" className="absolute inset-0 flex items-center">
          <span className="w-full border-t border-border" />
        </div>
        <div data-component="desktop_auth_login_divider_text" className="relative flex justify-center text-xs uppercase">
          <span className="bg-card px-2 text-muted-foreground">또는</span>
        </div>
      </div>

      <OAuthButtons disabled={isLoading} />

      <AuthInlineLink
        dataComponent="desktop_auth_login_forgot"
        href="/forgot-password"
        prefixText="비밀번호를 잊으셨나요?"
        linkLabel="비밀번호 찾기"
      />

      <AuthInlineLink
        dataComponent="desktop_auth_login_register-link"
        href="/register"
        prefixText="계정이 없으신가요?"
        linkLabel="회원가입"
      />
    </AuthPanel>
  );
}
