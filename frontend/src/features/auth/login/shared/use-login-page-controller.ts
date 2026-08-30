"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { resendVerificationEmail } from "@/features/auth/shared/auth-api";
import { useNavigationPending } from "@/lib/hooks/use-navigation-pending";
import { loginSchema, type LoginFormData } from "@/lib/validations/auth";
import { safeStorageGetItem, safeStorageRemoveItem, safeStorageSetItem } from "@/lib/safe-storage";
import { resetAuthorityState } from "@/lib/auth/authority-state";
import { loginWithEmail } from "@/app/(auth)/login/actions";

export function useLoginPageController() {
  const router = useRouter();
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
  const { isPending: isLoginPending, beginNavigation } = useNavigationPending(isLoading);

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

  const handleChange = (field: keyof LoginFormData) => (event: React.ChangeEvent<HTMLInputElement>) => {
    const value = event.target.value;

    setFormData((prev) => ({ ...prev, [field]: value }));
    if (errors[field]) {
      setErrors((prev) => {
        const nextErrors = { ...prev };
        delete nextErrors[field];
        return nextErrors;
      });
    }
    setServerError(null);
    setEmailVerificationRequired(false);
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setServerError(null);
    setErrors({});
    setEmailVerificationRequired(false);

    const result = loginSchema.safeParse(formData);
    if (!result.success) {
      const fieldErrors: Record<string, string> = {};
      result.error.issues.forEach((issue) => {
        const field = issue.path[0] as string;
        if (!fieldErrors[field]) {
          fieldErrors[field] = issue.message;
        }
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

      // A successful login can replace the current browser identity. Clear
      // before the request so an existing user cannot remain visible while the
      // new session is being established; failed login attempts are safe too.
      await resetAuthorityState();
      const response = await loginWithEmail(result.data.email, result.data.password, autoLogin);

      if (response.success) {
        if (response.onboardingRequired) {
          beginNavigation();
          router.replace(response.onboardingRoute || "/onboarding");
          return;
        }

        beginNavigation();
        if (response.requiresBranchSelection) {
          router.replace("/select-branch");
        } else {
          router.replace("/dashboard");
        }
        return;
      }

      if (response.authErrorCode) {
        router.replace(`/login?authError=${encodeURIComponent(response.authErrorCode)}`);
        return;
      }

      setServerError(response.error || "로그인에 실패했습니다.");
      if (response.emailVerificationRequired) {
        safeStorageSetItem("local", "auth:verificationEmail", result.data.email);
        setEmailVerificationRequired(true);
      }
    } catch (error) {
      console.error("Login error:", error);
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
      if (!targetEmail) {
        setServerError("인증 메일을 보낼 이메일을 먼저 입력해 주세요.");
      }
      return;
    }

    setIsResendingVerification(true);
    try {
      const response = await resendVerificationEmail(targetEmail);
      if (response.success) {
        safeStorageSetItem("local", "auth:verificationEmail", targetEmail);
      }
      setServerError(
        response.message || (response.success
          ? "인증 이메일을 재발송했습니다. 메일함을 확인해 주세요."
          : "인증 이메일 재발송에 실패했습니다."),
      );
    } catch {
      setServerError("네트워크 오류가 발생했습니다. 다시 시도해 주세요.");
    } finally {
      setIsResendingVerification(false);
    }
  };

  const kakaoLoginUrl = useMemo(() => "/api/auth/kakao", []);
  const googleLoginUrl = useMemo(() => "/api/auth/google", []);

  return {
    autoLogin,
    rememberId,
    formData,
    errors,
    serverError,
    isLoading: isLoginPending,
    emailVerificationRequired,
    isResendingVerification,
    kakaoLoginUrl,
    googleLoginUrl,
    setAutoLogin,
    setRememberId,
    handleChange,
    handleSubmit,
    handleResendVerification,
    clearServerError: () => {
      setServerError(null);
      setEmailVerificationRequired(false);
    },
  };
}
