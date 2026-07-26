"use client";

import { useLocale } from "@/providers/LocaleProvider";
import { t } from "@/lib/i18n/translations";
import { AuthInlineLink } from "@/components/auth/auth-inline-link";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { useLoginPageController } from "@/features/auth/login/shared/use-login-page-controller";
import { MobileAlertCard } from "@/features/auth/shared/mobile/mobile-alert-card";
import { MobileAuthCardContainer } from "@/features/auth/shared/mobile/mobile-auth-card-container";
import { MobileInput } from "@/features/auth/shared/mobile/mobile-input";
import { MobileInputField } from "@/features/auth/shared/mobile/mobile-input-field";
import { MobileOAuthButtons } from "@/features/auth/login/mobile/mobile-oauth-buttons";

export function LoginPageMobile() {
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
    kakaoLoginUrl,
    setAutoLogin,
    setRememberId,
    handleChange,
    handleSubmit,
    handleResendVerification,
  } = useLoginPageController();

  const kakaoButton = {
    title: t(locale, "login.kakao-login"),
    onClick: () => {
      window.location.href = kakaoLoginUrl;
    },
    disabled: isLoading,
  };

  return (
    <div data-component="desktop_auth_login_main" className="flex h-full items-center justify-center">
      <MobileAuthCardContainer
        data-component="desktop_auth_login"
        dataComponents={{
          container: "desktop_auth_login_container",
          card: "desktop_auth_login_card",
          header: "desktop_auth_login_header",
          title: "desktop_auth_login_title",
          subtitle: "desktop_auth_login_subtitle",
          content: "desktop_auth_login_content",
        }}
        className="max-w-[400px] border bg-card text-card-foreground shadow-lg"
        contentClassName="flex flex-col gap-6"
        title={t(locale, "login.title")}
        subtitle={t(locale, "login.subtitle")}
      >
        {serverError ? (
          <MobileAlertCard
            variant="destructive"
            data-component="desktop_auth_login_error"
            message={serverError}
            actionLabel={emailVerificationRequired ? (isResendingVerification ? "재발송 중..." : "인증 이메일 재발송") : undefined}
            actionOnClick={emailVerificationRequired ? handleResendVerification : undefined}
          />
        ) : null}

        <form data-component="desktop_auth_login_form" onSubmit={handleSubmit} className="flex flex-col gap-4">
          <MobileInputField
            title="이메일"
            message={errors.email}
            messageTone="error"
            messageId={errors.email ? "login-email-error" : undefined}
            className="gap-2"
            labelClassName="text-sm"
            inputClassName={errors.email ? "border-destructive focus:border-destructive" : undefined}
            inputProps={{
              id: "login-email",
              type: "email",
              value: formData.email,
              onChange: handleChange("email"),
              disabled: isLoading,
              autoComplete: "email",
              "aria-invalid": !!errors.email,
              "aria-describedby": errors.email ? "login-email-error" : undefined,
            }}
            renderInput={(resolvedInputProps) => (
              <MobileInput
                {...resolvedInputProps}
                data-component="desktop_auth_login_form_auth-login-email-field"
              />
            )}
          />

          <MobileInputField
            title="비밀번호"
            message={errors.password}
            messageTone="error"
            messageId={errors.password ? "login-password-error" : undefined}
            className="gap-2"
            labelClassName="text-sm"
            inputClassName={errors.password ? "border-destructive focus:border-destructive" : undefined}
            inputProps={{
              id: "login-password",
              type: "password",
              value: formData.password,
              onChange: handleChange("password"),
              disabled: isLoading,
              autoComplete: "current-password",
              "aria-invalid": !!errors.password,
              "aria-describedby": errors.password ? "login-password-error" : undefined,
            }}
            renderInput={(resolvedInputProps) => (
              <MobileInput
                {...resolvedInputProps}
                data-component="desktop_auth_login_form_auth-login-password-field"
              />
            )}
          />

          <div data-component="desktop_auth_login_form_checkboxes" className="flex items-center gap-6">
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
            className="w-full rounded-2xl"
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
            <span className="bg-white px-2 text-muted-foreground">또는</span>
          </div>
        </div>

        <MobileOAuthButtons kakaoButton={kakaoButton} />

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
      </MobileAuthCardContainer>
    </div>
  );
}
