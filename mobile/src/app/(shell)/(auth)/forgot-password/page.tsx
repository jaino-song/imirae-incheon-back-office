"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check } from "lucide-react";

import { authApi } from "@/services/api";
import { forgotPasswordSchema } from "@/lib/validations/auth";
import "@/components/app/mobile-redesign/redesign.css";

/** Canonical data-component base for the /forgot-password route. */
const FORGOT_PASSWORD_BASE = "mobile_auth_forgot-password";

export default function ForgotPasswordPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setFieldError(null);
    setError(null);

    const result = forgotPasswordSchema.safeParse({ email });
    if (!result.success) {
      setFieldError(result.error.issues[0]?.message || "유효한 이메일을 입력해주세요.");
      return;
    }

    setIsLoading(true);
    try {
      const response = await authApi.forgotPassword(email);
      if (response.success) {
        setIsSuccess(true);
      } else {
        setError(response.message || "요청 처리에 실패했습니다. 다시 시도해 주세요.");
      }
    } catch (err) {
      console.error("Forgot password error:", err);
      setError("네트워크 오류가 발생했습니다. 다시 시도해 주세요.");
    } finally {
      setIsLoading(false);
    }
  };

  if (isSuccess) {
    return (
      <div className="auth-page" data-component={FORGOT_PASSWORD_BASE} data-slot="auth-forgot-password-page">
        <div className="auth-brand" data-component={`${FORGOT_PASSWORD_BASE}_brand`}>
          <div className="auth-logo" data-component={`${FORGOT_PASSWORD_BASE}_brand_logo`}>
            <Image src="/assets/logo.svg" alt="아가잼잼 로고" width={80} height={80} priority />
          </div>
          <div className="auth-title" data-component={`${FORGOT_PASSWORD_BASE}_brand_title`}>
            이메일 전송 완료
          </div>
          <div className="auth-sub-stack" data-component={`${FORGOT_PASSWORD_BASE}_brand_subtitle-stack`}>
            <div className="auth-sub sub-variant active" data-component={`${FORGOT_PASSWORD_BASE}_brand_subtitle-stack_subtitle`}>
              메일을 확인하여 비밀번호를 재설정해 주세요.
            </div>
          </div>
        </div>

        <div
          className="auth-step-view active"
          data-auth-step="2"
          data-component={`${FORGOT_PASSWORD_BASE}_success`}
        >
          <div className="auth-status" data-component={`${FORGOT_PASSWORD_BASE}_success_status`}>
            <div className="status-icon success" data-component={`${FORGOT_PASSWORD_BASE}_success_status_icon`}>
              <Check size={32} strokeWidth={2.5} />
            </div>
            <div className="status-message" data-component={`${FORGOT_PASSWORD_BASE}_success_status_message`}>
              <strong>{email}</strong>로
              <br />
              비밀번호 재설정 링크가 전송되었습니다.
            </div>
            <div className="status-message status-message-muted" data-component={`${FORGOT_PASSWORD_BASE}_success_status_submessage`}>
              이메일을 확인하여 비밀번호를 재설정해 주세요.
            </div>
            <div className="status-info" data-component={`${FORGOT_PASSWORD_BASE}_success_status_info`}>
              이메일이 도착하지 않았다면 스팸 폴더를 확인해 주세요.
            </div>
          </div>

          <div className="auth-form auth-success-actions" data-component={`${FORGOT_PASSWORD_BASE}_success_actions`}>
            <button
              type="button"
              className="auth-btn secondary"
              onClick={() => router.push("/login")}
              data-component={`${FORGOT_PASSWORD_BASE}_success_actions_login-button`}
            >
              로그인 페이지로 돌아가기
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="auth-page" data-component={FORGOT_PASSWORD_BASE} data-slot="auth-forgot-password-page">
      <div className="auth-brand" data-component={`${FORGOT_PASSWORD_BASE}_brand`}>
        <div className="auth-logo" data-component={`${FORGOT_PASSWORD_BASE}_brand_logo`}>
          <Image src="/assets/logo.svg" alt="아가잼잼 로고" width={80} height={80} priority />
        </div>
        <div className="auth-title" data-component={`${FORGOT_PASSWORD_BASE}_brand_title`}>
          비밀번호 찾기
        </div>
        <div className="auth-sub-stack" data-component={`${FORGOT_PASSWORD_BASE}_brand_subtitle-stack`}>
          <div className="auth-sub sub-variant active" data-component={`${FORGOT_PASSWORD_BASE}_brand_subtitle-stack_subtitle`}>
            가입하신 이메일 주소를 입력하시면
            <br />
            비밀번호 재설정 링크를 보내드립니다.
          </div>
        </div>
      </div>

      {error && (
        <div className="auth-server-error" role="alert" data-component={`${FORGOT_PASSWORD_BASE}_server-error`}>
          {error}
        </div>
      )}

      <form className="auth-form" onSubmit={handleSubmit} data-component={`${FORGOT_PASSWORD_BASE}_form`}>
        <div className="auth-input-group" data-component={`${FORGOT_PASSWORD_BASE}_form_email-field`}>
          <label className="auth-label" htmlFor="forgot-email">
            이메일
          </label>
          <input
            id="forgot-email"
            className={`auth-input ${fieldError ? "error" : ""}`}
            type="email"
            placeholder="example@email.com"
            autoComplete="email"
            autoFocus
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              if (fieldError) setFieldError(null);
            }}
            disabled={isLoading}
            aria-invalid={!!fieldError}
            aria-describedby={fieldError ? "forgot-email-error" : undefined}
          />
          {fieldError && (
            <div
              className="auth-helper error"
              id="forgot-email-error"
              data-component={`${FORGOT_PASSWORD_BASE}_form_email-field_error`}
            >
              {fieldError}
            </div>
          )}
        </div>

        <button
          type="submit"
          className="auth-btn"
          disabled={isLoading}
          data-component={`${FORGOT_PASSWORD_BASE}_form_submit-button`}
        >
          {isLoading ? "처리 중…" : "비밀번호 재설정 링크 전송"}
        </button>
      </form>

      <div className="auth-footer-link" data-component={`${FORGOT_PASSWORD_BASE}_footer-link`}>
        <span>비밀번호가 기억나셨나요?&nbsp;</span>
        <Link href="/login" data-component={`${FORGOT_PASSWORD_BASE}_footer-link_login-link`}>
          로그인
        </Link>
      </div>
    </div>
  );
}
