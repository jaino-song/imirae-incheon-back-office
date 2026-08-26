"use client";

import { Suspense, useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { loginSchema, type LoginFormData } from "@/lib/validations/auth";
import { useNavigationPending } from "@/hooks/use-navigation-pending";
import { loginWithEmail } from "./actions";
import { authApi } from "@/services/api";
import { resetAuthorityState } from "@/lib/auth/authority-state";
import { safeStorageGetItem, safeStorageRemoveItem, safeStorageSetItem } from "@/lib/safe-storage";
import "@/components/app/mobile-redesign/redesign.css";
import { LoginAuthErrorModal } from "@/components/auth/login-auth-error-modal";

/** Canonical data-component base for the /login route. */
const LOGIN_BASE = "mobile_auth_login";

const LoginPage = () => {
  const router = useRouter();
  const { isNavigationPending, startNavigation } = useNavigationPending();

  const [autoLogin, setAutoLogin] = useState(false);
  const [rememberId, setRememberId] = useState(false);
  const [formData, setFormData] = useState<Partial<LoginFormData>>({
    email: "",
    password: "",
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [emailVerificationRequired, setEmailVerificationRequired] = useState(false);
  const [isResendingVerification, setIsResendingVerification] = useState(false);

  useEffect(() => {
    const savedAutoLogin = safeStorageGetItem("local", "login:autoLogin") === "true";
    const savedRememberId = safeStorageGetItem("local", "login:rememberId") === "true";
    const savedEmail = safeStorageGetItem("local", "login:savedEmail") || "";

    setAutoLogin(savedAutoLogin);
    setRememberId(savedRememberId);

    if (savedRememberId && savedEmail) {
      setFormData((prev) => ({ ...prev, email: savedEmail }));
    }
  }, []);

  const handleChange = (field: keyof LoginFormData) => (e: React.ChangeEvent<HTMLInputElement>) => {
    setFormData((prev) => ({ ...prev, [field]: e.target.value }));
    if (errors[field]) {
      setErrors((prev) => {
        const next = { ...prev };
        delete next[field];
        return next;
      });
    }
    setServerError(null);
    setEmailVerificationRequired(false);
  };

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setServerError(null);
    setErrors({});
    setEmailVerificationRequired(false);

    const result = loginSchema.safeParse(formData);
    if (!result.success) {
      const fieldErrors: Record<string, string> = {};
      result.error.issues.forEach((issue) => {
        const field = issue.path[0] as string;
        if (!fieldErrors[field]) fieldErrors[field] = issue.message;
      });
      setErrors(fieldErrors);
      return;
    }

    setIsLoading(true);

    try {
      safeStorageSetItem("local", "login:autoLogin", autoLogin ? "true" : "false");
      safeStorageSetItem("local", "login:rememberId", rememberId ? "true" : "false");
      if (rememberId) {
        safeStorageSetItem("local", "login:savedEmail", result.data.email);
      } else {
        safeStorageRemoveItem("local", "login:savedEmail");
      }

      await resetAuthorityState();
      const response = await loginWithEmail(result.data.email, result.data.password, autoLogin);

      if (response.success) {
        startNavigation();
        // Every navigation below crosses an identity boundary (new
        // account/branch session). The shared (shell) layout would not
        // re-render its server-rendered UserProvider on a soft navigation, so
        // reload the document instead.
        if (response.onboardingRequired) {
          window.location.replace(response.onboardingRoute || "/onboarding");
          return;
        }
        if (response.requiresBranchSelection) {
          window.location.replace("/select-branch");
        } else {
          window.location.replace("/dashboard");
        }
      } else {
        if (response.authErrorCode) {
          router.replace(`/login?authError=${encodeURIComponent(response.authErrorCode)}`);
          return;
        }
        setServerError(response.error || "로그인에 실패했습니다.");
        if (response.emailVerificationRequired) {
          if (result.data.email) {
            safeStorageSetItem("local", "auth:verificationEmail", result.data.email);
          }
          setEmailVerificationRequired(true);
        }
      }
    } catch (err) {
      console.error("Login error:", err);
      setServerError("네트워크 오류가 발생했습니다. 다시 시도해 주세요.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleResendVerification = async () => {
    const inputEmail = typeof formData.email === "string" ? formData.email.trim() : "";
    const savedEmail = safeStorageGetItem("local", "auth:verificationEmail")?.trim() || "";
    const targetEmail = inputEmail || savedEmail;

    if (!targetEmail || isResendingVerification) {
      if (!targetEmail) setServerError("인증 메일을 보낼 이메일을 먼저 입력해 주세요.");
      return;
    }

    setIsResendingVerification(true);
    try {
      const response = await authApi.resendVerification(targetEmail);
      if (response.success) {
        safeStorageSetItem("local", "auth:verificationEmail", targetEmail);
        setServerError(response.message || "인증 이메일을 재발송했습니다. 메일함을 확인해 주세요.");
      } else {
        setServerError(response.message || "인증 이메일 재발송에 실패했습니다.");
      }
    } catch {
      setServerError("네트워크 오류가 발생했습니다. 다시 시도해 주세요.");
    } finally {
      setIsResendingVerification(false);
    }
  };

  const handleKakao = () => {
    authApi.kakaoLogin();
  };

  const isBusy = isLoading || isNavigationPending;

  return (
    <div className="auth-page" data-component={LOGIN_BASE} data-slot="auth-login-page">
      <Suspense fallback={null}>
        <LoginAuthErrorModal />
      </Suspense>
      <div className="auth-brand">
        <div className="auth-logo">
          <Image src="/assets/logo.svg" alt="아가잼잼 로고" width={80} height={80} priority />
        </div>
        <div className="auth-title">아가잼잼 어드민</div>
        <div className="auth-sub">지점 운영을 더 똑똑하게</div>
      </div>

      {serverError && (
        <div className="auth-server-error" role="alert" data-component={`${LOGIN_BASE}_server-error`}>
          {serverError}
          {emailVerificationRequired && (
            <button
              type="button"
              className="auth-resend-link"
              onClick={handleResendVerification}
              disabled={isResendingVerification}
              data-component={`${LOGIN_BASE}_server-error_verify-email-link`}
            >
              {isResendingVerification ? "재발송 중…" : "인증 이메일 재발송"}
            </button>
          )}
        </div>
      )}

      <form className="auth-form" onSubmit={handleSubmit} data-component={`${LOGIN_BASE}_form`}>
        <input
          className={`auth-input ${errors.email ? "error" : ""}`}
          type="email"
          placeholder="이메일"
          autoComplete="email"
          value={formData.email ?? ""}
          onChange={handleChange("email")}
          disabled={isBusy}
          aria-invalid={!!errors.email}
        />
        {errors.email && <div className="auth-input-error">{errors.email}</div>}
        <input
          className={`auth-input ${errors.password ? "error" : ""}`}
          type="password"
          placeholder="비밀번호"
          autoComplete="current-password"
          value={formData.password ?? ""}
          onChange={handleChange("password")}
          disabled={isBusy}
          aria-invalid={!!errors.password}
        />
        {errors.password && <div className="auth-input-error">{errors.password}</div>}

        <div className="auth-options">
          <label className="auth-check" htmlFor="login-remember-id">
            <input
              id="login-remember-id"
              type="checkbox"
              checked={rememberId}
              onChange={(e) => setRememberId(e.target.checked)}
              disabled={isBusy}
            />
            <span>아이디 저장</span>
          </label>
          <label className="auth-check" htmlFor="login-auto-login">
            <input
              id="login-auto-login"
              type="checkbox"
              checked={autoLogin}
              onChange={(e) => setAutoLogin(e.target.checked)}
              disabled={isBusy}
            />
            <span>자동 로그인</span>
          </label>
        </div>

        <button
          type="submit"
          className="auth-btn"
          disabled={isBusy}
          data-component={`${LOGIN_BASE}_form_submit-button`}
        >
          {isBusy ? "로그인 중…" : "로그인"}
        </button>
      </form>

      <div className="auth-divider">또는</div>

      <button
        type="button"
        className="auth-oauth"
        onClick={handleKakao}
        disabled={isBusy}
        data-component={`${LOGIN_BASE}_kakao-button`}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="rgba(0,0,0,0.85)">
          <path d="M12 3C6.5 3 2 6.5 2 11c0 2.8 1.8 5.3 4.5 6.7L5.4 21l3.5-2.3c1 .2 2 .3 3.1.3 5.5 0 10-3.5 10-8s-4.5-8-10-8z" />
        </svg>
        카카오로 시작하기
      </button>

      <div className="auth-links">
        <Link href="/forgot-password" data-component={`${LOGIN_BASE}_forgot-password-link`}>
          비밀번호 찾기
        </Link>
        <Link href="/register" data-component={`${LOGIN_BASE}_register-link`}>
          회원가입
        </Link>
      </div>

      <div className="auth-footer">
        가입 시 <Link href="/terms">이용약관</Link>과 <Link href="/privacy">개인정보처리방침</Link>에 동의합니다.
      </div>
    </div>
  );
};

export default LoginPage;
