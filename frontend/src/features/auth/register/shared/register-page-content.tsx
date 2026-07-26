"use client";

import * as React from "react";
import { motion } from "framer-motion";
import { Check, CheckCircle, Link2 } from "lucide-react";

import { AuthInlineLink } from "@/components/auth/auth-inline-link";
import { FormField } from "@/components/auth/form-field";
import { PasswordRequirements } from "@/components/auth/password-requirements";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { AuthSurface, type AuthSurfaceVariant } from "@/features/auth/shared/ui/auth-surface";
import { cn } from "@/lib/utils";
import {
  type RegisterStep,
  REGISTER_STEP_TOTAL,
  useRegisterPageController,
} from "@/features/auth/register/shared/use-register-page-controller";

const REGISTER_CARD_CLASS_NAME = "gap-5 !p-5 sm:!p-6 [&_[data-component='auth-register-title']]:!text-[1.72rem] md:[&_[data-component='auth-register-title']]:!text-[1.5rem] [&_[data-component='auth-register-subtitle']]:!max-w-[30ch] [&_[data-component='auth-register-subtitle']]:!text-[0.82rem] md:[&_[data-component='auth-register-subtitle']]:!text-[0.76rem]";
const REGISTER_PRIMARY_BUTTON_CLASS_NAME = "h-10 gap-1.5 px-5 text-[0.72rem] font-bold md:text-[0.77rem]";
const REGISTER_SECONDARY_BUTTON_CLASS_NAME = "h-10 gap-1.5 px-5 text-[0.72rem] font-semibold md:text-[0.77rem]";
const REGISTER_PASSWORD_REQUIREMENTS_CLASS_NAME = "justify-center [&_li]:text-[0.78rem] [&_svg]:h-3.5 [&_svg]:w-3.5";
const REGISTER_SUBTITLE = "필수 정보를 단계별로 입력해 주세요.";
const PHONE_DUPLICATE_CHECK_PENDING_MESSAGE = "연락처 중복 확인 중입니다. 잠시만 기다려주세요.";
const PHONE_DUPLICATE_CHECK_FAILED_MESSAGE = "문제가 발생했어요. 새로고침 해주세요.";
const PHONE_DUPLICATE_AVAILABLE_MESSAGE = "등록 가능한 번호입니다.";
const PHONE_DUPLICATE_ERROR_MESSAGE = "이미 존재하는 사용자 입니다.";
const REGISTER_STEP_TRANSITION = {
  duration: 0.18,
  ease: [0.22, 1, 0.36, 1] as const,
};

interface RegisterPageContentProps {
  variant: AuthSurfaceVariant;
}

function AnimatedHeight({
  children,
  className,
  dataComponent,
}: {
  children: React.ReactNode;
  className?: string;
  dataComponent?: string;
}) {
  const innerRef = React.useRef<HTMLDivElement>(null);
  const [height, setHeight] = React.useState<number | null>(null);
  const frameRef = React.useRef<number | null>(null);

  React.useLayoutEffect(() => {
    const node = innerRef.current;
    if (!node) {
      return;
    }

    const updateHeight = () => {
      if (frameRef.current !== null) {
        cancelAnimationFrame(frameRef.current);
      }

      frameRef.current = requestAnimationFrame(() => {
        setHeight(node.getBoundingClientRect().height);
        frameRef.current = null;
      });
    };

    updateHeight();

    if (typeof ResizeObserver === "undefined") {
      return;
    }

    const observer = new ResizeObserver(() => {
      updateHeight();
    });

    observer.observe(node);

    return () => {
      if (frameRef.current !== null) {
        cancelAnimationFrame(frameRef.current);
      }
      observer.disconnect();
    };
  }, []);

  return (
    <div
      data-component={dataComponent}
      className={cn(
        "overflow-hidden transition-[height] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none",
        className,
      )}
      style={height === null ? undefined : { height }}
    >
      <div ref={innerRef}>{children}</div>
    </div>
  );
}

function DesktopRegisterStepIndicator({ currentStep }: { currentStep: RegisterStep }) {
  return (
    <div
      data-component="desktop_auth_register_stepper-desktop"
      className="flex min-h-[2.4rem] items-center justify-center gap-0 overflow-visible py-1"
    >
      {Array.from({ length: REGISTER_STEP_TOTAL }, (_, idx) => {
        const step = idx + 1;
        const isCompleted = idx < currentStep;
        const isCurrent = idx === currentStep;

        return (
          <div key={step} data-component="desktop_auth_register_stepper-desktop_item" className="contents">
            <div
              data-component="desktop_auth_register_stepper-desktop_item_step"
              className={cn("flex items-center overflow-visible py-0.5", isCurrent && "text-v3-primary", isCompleted && "text-v3-dark")}
            >
              <div
                data-component="desktop_auth_register_stepper-desktop_item_step_circle"
                className={cn(
                  "flex h-7 w-7 items-center justify-center rounded-full text-[0.68rem] font-bold transition-all duration-300 will-change-transform",
                  isCompleted && "bg-v3-primary text-white shadow-[0_2px_8px_hsla(214,100%,34%,0.2)]",
                  isCurrent && "scale-110 bg-v3-primary text-white shadow-[0_2px_12px_hsla(214,100%,34%,0.3)]",
                  !isCompleted && !isCurrent && "border-2 border-v3-border bg-v3-dim-white text-v3-text-muted",
                )}
              >
                {isCompleted ? <Check className="h-3.5 w-3.5" strokeWidth={3} /> : step}
              </div>
            </div>

            {idx < REGISTER_STEP_TOTAL - 1 ? (
              <div
                data-component="desktop_auth_register_stepper-desktop_item_connector"
                className={cn(
                  "mx-1.5 h-0.5 w-10 rounded-full",
                  idx < currentStep ? "bg-v3-primary" : "bg-v3-border",
                )}
              />
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

function MobileRegisterStepIndicator({ currentStep }: { currentStep: RegisterStep }) {
  const progress = ((currentStep + 1) / REGISTER_STEP_TOTAL) * 100;

  return (
    <div data-component="desktop_auth_register_stepper-mobile">
      <div data-component="desktop_auth_register_stepper-mobile_header" className="mb-2 flex items-center justify-end">
        <span className="text-[0.64rem] font-semibold text-v3-text-muted">
          {currentStep + 1} / {REGISTER_STEP_TOTAL} 단계
        </span>
      </div>
      <div data-component="desktop_auth_register_stepper-mobile_track" className="h-1.5 w-full overflow-hidden rounded-full bg-v3-border">
        <div
          data-component="desktop_auth_register_stepper-mobile_track_progress"
          className="h-full rounded-full bg-gradient-to-r from-v3-primary to-blue-500 transition-all duration-400"
          style={{
            width: `${progress}%`,
            transitionTimingFunction: "cubic-bezier(0.34, 1.56, 0.64, 1)",
          }}
        />
      </div>
    </div>
  );
}

function RegisterStepFields({
  currentStep,
  formData,
  errors,
  emailLinkableMessage,
  isLoading,
  passwordStrength,
  handleChange,
  handleEmailBlur,
  handlePhoneChange,
  handleBirthDateChange,
  hasPhoneDuplicateCheckFailed,
  isCheckingPhoneDuplicate,
  isPhoneCheckReady,
  isPhoneDuplicate,
  lastCheckedPhoneDigits,
}: Pick<
  ReturnType<typeof useRegisterPageController>,
  | "currentStep"
  | "formData"
  | "errors"
  | "emailLinkableMessage"
  | "isLoading"
  | "passwordStrength"
  | "hasPhoneDuplicateCheckFailed"
  | "isCheckingPhoneDuplicate"
  | "isPhoneCheckReady"
  | "isPhoneDuplicate"
  | "lastCheckedPhoneDigits"
  | "handleChange"
  | "handleEmailBlur"
  | "handlePhoneChange"
  | "handleBirthDateChange"
>) {
  const phoneDigits = (formData.phone ?? "").replace(/\D/g, "");
  const phoneInlineMessage =
    phoneDigits.length === 11
      ? isPhoneCheckReady
        ? PHONE_DUPLICATE_AVAILABLE_MESSAGE
        : isCheckingPhoneDuplicate
          ? PHONE_DUPLICATE_CHECK_PENDING_MESSAGE
          : hasPhoneDuplicateCheckFailed
            ? PHONE_DUPLICATE_CHECK_FAILED_MESSAGE
            : lastCheckedPhoneDigits !== phoneDigits
              ? PHONE_DUPLICATE_CHECK_PENDING_MESSAGE
              : isPhoneDuplicate
                ? PHONE_DUPLICATE_ERROR_MESSAGE
                : null
      : null;
  const hasPhoneStatusError =
    phoneDigits.length === 11 &&
    (hasPhoneDuplicateCheckFailed ||
      (lastCheckedPhoneDigits === phoneDigits && isPhoneDuplicate));
  const phoneFieldError = errors.phone ??
    (hasPhoneStatusError ? phoneInlineMessage ?? undefined : undefined);

  return (
    <div data-component="desktop_auth_register_step-fields" className="flex flex-col gap-[14px]">
      {currentStep === 0 ? (
        <>
          <FormField
            label="이메일"
            type="email"
            value={formData.email}
            onChange={handleChange("email")}
            onBlur={handleEmailBlur}
            error={errors.email}
            labelTrailing={emailLinkableMessage ? (
              <span className="inline-flex items-center text-right text-[0.68rem] font-semibold leading-none text-v3-primary">
                {emailLinkableMessage}
              </span>
            ) : undefined}
            errorDisplay="inline"
            disabled={isLoading}
            autoComplete="email"
            data-component="desktop_auth_register_step-fields_email-field"
          />

          <FormField
            label="이름"
            type="text"
            value={formData.name}
            onChange={handleChange("name")}
            error={errors.name}
            errorDisplay="inline"
            disabled={isLoading}
            autoComplete="name"
            data-component="desktop_auth_register_step-fields_name-field"
          />

          <FormField
            label="비밀번호"
            type="password"
            value={formData.password}
            onChange={handleChange("password")}
            error={errors.password}
            errorDisplay="inline"
            disabled={isLoading}
            autoComplete="new-password"
            data-component="desktop_auth_register_step-fields_password-field"
          />

          <div
            data-component="desktop_auth_register_step-fields_password-requirements-wrap"
            className={cn(
              "grid overflow-hidden transition-[grid-template-rows,opacity,margin] duration-300 ease-out",
              formData.password ? "mt-0 grid-rows-[1fr] opacity-100" : "mt-[-6px] grid-rows-[0fr] opacity-0",
            )}
          >
            <div data-component="desktop_auth_register_step-fields_password-requirements-wrap_inner" className="overflow-hidden">
              <PasswordRequirements
                requirements={passwordStrength.requirements}
                orientation="horizontal"
                className={REGISTER_PASSWORD_REQUIREMENTS_CLASS_NAME}
              />
            </div>
          </div>

          <FormField
            label="비밀번호 확인"
            type="password"
            value={formData.confirmPassword}
            onChange={handleChange("confirmPassword")}
            error={errors.confirmPassword}
            errorDisplay="inline"
            disabled={isLoading}
            autoComplete="new-password"
            data-component="desktop_auth_register_step-fields_confirm-field"
          />
        </>
      ) : (
        <>
          <FormField
            label="전화번호"
            type="tel"
            value={formData.phone}
            onChange={handlePhoneChange}
            error={phoneFieldError}
            labelTrailing={
              phoneInlineMessage && !phoneFieldError ? (
                <span
                  aria-live="polite"
                  className={cn(
                    "inline-flex min-h-[0.6875rem] items-center justify-end text-right text-[0.68rem] font-semibold leading-none",
                    isPhoneCheckReady ? "text-v3-green" : "text-v3-text-muted",
                  )}
                >
                  {phoneInlineMessage}
                </span>
              ) : undefined
            }
            errorDisplay="inline"
            disabled={isLoading}
            autoComplete="tel"
            inputMode="numeric"
            maxLength={13}
            placeholder="010-1234-5678"
            data-component="desktop_auth_register_step-fields_phone-field"
          />

          <FormField
            label="생년월일"
            type="text"
            value={formData.birthDate}
            onChange={handleBirthDateChange}
            error={errors.birthDate}
            errorDisplay="inline"
            disabled={isLoading}
            autoComplete="bday"
            inputMode="numeric"
            maxLength={10}
            placeholder="1990-01-01"
            data-component="desktop_auth_register_step-fields_birthdate-field"
          />
        </>
      )}
    </div>
  );
}

export function RegisterPageContent({ variant }: RegisterPageContentProps) {
  const controller = useRegisterPageController();
  const {
    serverError,
    isLoading,
    isSuccess,
    accountsLinked,
    currentStep,
    handleSubmit,
    handlePreviousStep,
    clearServerError,
    goToLogin,
    isCurrentStepActionDisabled,
  } = controller;

  const primaryButtonClassName = cn(
    REGISTER_PRIMARY_BUTTON_CLASS_NAME,
    variant === "mobile" && "rounded-2xl",
  );
  const secondaryButtonClassName = cn(
    REGISTER_SECONDARY_BUTTON_CLASS_NAME,
    variant === "mobile" && "rounded-2xl",
  );
  const desktopStepNavigationWidthClassName =
    variant === "desktop" ? "w-1/4" : undefined;

  return (
    <AuthSurface
      variant={variant}
      data-component="desktop_auth_register"
      dataComponents={{
        container: "desktop_auth_register_container",
        card: "desktop_auth_register_card",
        header: "desktop_auth_register_header",
        title: "desktop_auth_register_title",
        subtitle: "desktop_auth_register_subtitle",
        content: "desktop_auth_register_content",
      }}
      title={isSuccess ? (accountsLinked ? "계정이 연결되었습니다!" : "회원가입 완료!") : "회원가입"}
      subtitle={
        isSuccess
          ? accountsLinked
            ? "이메일 인증 후 로그인을 진행해 주세요."
            : "오너 승인 후 로그인할 수 있어요."
          : REGISTER_SUBTITLE
      }
      className={REGISTER_CARD_CLASS_NAME}
      contentClassName="gap-0"
      mobileWrapperClassName="px-4 py-6"
    >
      <AnimatedHeight dataComponent="desktop_auth_register_body-viewport">
        <div
          data-component="desktop_auth_register_body"
          className={cn(
            "flex flex-col",
            isSuccess ? "items-center gap-6 text-center" : "gap-[18px]",
          )}
        >
          {isSuccess ? (
            <>
              {accountsLinked ? (
                <>
                  <div data-component="desktop_auth_register_body_success-icon" className="rounded-full bg-primary/10 p-3">
                    <Link2 className="h-12 w-12 text-primary" />
                  </div>
                  <p data-component="desktop_auth_register_body_success-message" className="text-muted-foreground">
                    기존 카카오 계정에 비밀번호가 추가되었습니다.
                    <br />
                    이메일을 확인하여 계정을 활성화하면
                    <br />
                    카카오와 이메일 모두로 로그인할 수 있습니다.
                  </p>
                </>
              ) : (
                <>
                  <div data-component="desktop_auth_register_body_success-icon" className="rounded-full bg-success/10 p-3">
                    <CheckCircle className="h-12 w-12 text-success" />
                  </div>
                  <p data-component="desktop_auth_register_body_success-message" className="text-muted-foreground">
                    인증 이메일이 발송되었습니다.
                    <br />
                    이메일 인증을 완료해 주세요.
                    <br />
                    오너 승인이 완료되면 로그인할 수 있어요.
                  </p>
                </>
              )}

              <Button
                data-component="desktop_auth_register_body_success-login-btn"
                variant="positive"
                size="md"
                className={cn("w-full", primaryButtonClassName)}
                onClick={goToLogin}
              >
                로그인 페이지로 이동
              </Button>
            </>
          ) : (
            <>
              {variant === "desktop" ? (
                <DesktopRegisterStepIndicator currentStep={currentStep} />
              ) : (
                <MobileRegisterStepIndicator currentStep={currentStep} />
              )}

              {serverError ? (
                <div data-component="desktop_auth_register_body_alert">
                  <Alert variant="destructive" onClose={clearServerError}>
                    {serverError}
                  </Alert>
                </div>
              ) : null}

            <form
              onSubmit={handleSubmit}
              data-component="desktop_auth_register_body_form"
              className="flex flex-col gap-[18px] [&_label]:text-[0.82rem] [&_p]:leading-[1.45]"
            >
              <motion.div
                key={currentStep}
                data-component={`auth-register-step-${currentStep + 1}`}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={REGISTER_STEP_TRANSITION}
              >
                <RegisterStepFields {...controller} />
              </motion.div>

                <div
                  data-component="desktop_auth_register_body_form_actions"
                  className="mt-1 flex items-center justify-between border-t border-v3-border pt-3"
                >
                <Button
                  data-component="desktop_auth_register_body_form_actions_prev-btn"
                  type="button"
                  variant="neutral"
                  size="sm"
                className={cn(
                  secondaryButtonClassName,
                  currentStep < REGISTER_STEP_TOTAL - 1 && desktopStepNavigationWidthClassName,
                )}
                    onClick={currentStep === 0 ? goToLogin : handlePreviousStep}
                    disabled={isLoading}
                  >
                    {currentStep === 0 ? "취소" : "이전"}
                  </Button>

                <Button
                  data-component={currentStep < REGISTER_STEP_TOTAL - 1 ? "desktop_auth_register_body_form_actions_next-btn" : "desktop_auth_register_body_form_actions_submit-btn"}
                  type="submit"
                  variant="positive"
                  size="sm"
                className={cn(
                  primaryButtonClassName,
                  currentStep < REGISTER_STEP_TOTAL - 1
                    ? desktopStepNavigationWidthClassName ?? "w-auto"
                        : "flex-1 md:min-w-[132px] md:flex-none",
                    )}
                    disabled={isLoading || isCurrentStepActionDisabled}
                  >
                    {currentStep < REGISTER_STEP_TOTAL - 1 ? (
                      "다음"
                    ) : isLoading ? (
                      <Spinner size="sm" />
                    ) : (
                      "회원가입"
                    )}
                  </Button>
                </div>
            </form>

              <AuthInlineLink
                dataComponent="desktop_auth_register_body_login-link"
                href="/login"
                prefixText="이미 계정이 있으신가요?"
                linkLabel="로그인"
                paragraphClassName="text-[0.82rem]"
                linkClassName="text-[0.82rem]"
              />
            </>
          )}
        </div>
      </AnimatedHeight>
    </AuthSurface>
  );
}
