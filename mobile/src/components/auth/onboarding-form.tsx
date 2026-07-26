"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown } from "lucide-react";
import { authBirthDateSchema, authPhoneSchema, REGISTERABLE_ROLE_OPTIONS } from "@babyjamjam/shared";
import { z } from "zod";

import { completeKakaoOnboarding } from "@/app/(shell)/(auth)/kakao/onboarding/actions";
import "@/components/app/mobile-redesign/redesign.css";

const ONBOARDING_FORM_SOURCE_COMPONENT = "OnboardingForm";

/**
 * Canonical data-component base for the /kakao/onboarding route. OnboardingForm
 * is rendered only by `app/(shell)/(auth)/kakao/onboarding/page.tsx`, so the
 * route base lives here instead of being threaded through a prop.
 */
const KAKAO_ONBOARDING_BASE = "mobile_auth_kakao-onboarding";

const schema = z.object({
  phone: authPhoneSchema,
  birthDate: authBirthDateSchema,
  role: z.enum(["admin", "manager", "user"], { message: "역할을 선택해주세요." }),
});

type FormData = z.infer<typeof schema>;

interface OnboardingFormProps {
  email?: string;
  name?: string;
  phone?: string;
  birthDate?: string;
  role?: FormData["role"];
}

export function OnboardingForm(props: OnboardingFormProps) {
  const router = useRouter();
  const [form, setForm] = useState<Partial<FormData>>({
    phone: props.phone ?? "",
    birthDate: props.birthDate ?? "",
    role: props.role,
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const update = (field: keyof FormData) => (event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    setForm((current) => ({ ...current, [field]: event.target.value }));
    setErrors((current) => ({ ...current, [field]: "" }));
    setServerError(null);
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const result = schema.safeParse(form);
    if (!result.success) {
      const next: Record<string, string> = {};
      result.error.issues.forEach((issue) => {
        const field = String(issue.path[0]);
        if (!next[field]) next[field] = issue.message;
      });
      setErrors(next);
      return;
    }

    setIsLoading(true);
    const response = await completeKakaoOnboarding(result.data);
    setIsLoading(false);
    if (!response.success) {
      setServerError(response.error || "계정 정보를 저장하지 못했습니다.");
      return;
    }
    router.replace("/login?authError=PENDING_APPROVAL");
  };

  return (
    <div
      className="auth-page"
      data-component={KAKAO_ONBOARDING_BASE}
      data-source-component={ONBOARDING_FORM_SOURCE_COMPONENT}
    >
      <div className="auth-brand">
        <div className="auth-title">카카오 가입 마무리</div>
        <div className="auth-sub">로그인에 필요한 추가 정보를 입력해 주세요.</div>
      </div>
      {serverError && <div className="auth-server-error" role="alert">{serverError}</div>}
      <form className="auth-form" onSubmit={submit}>
        <input className="auth-input" value={props.email ?? ""} disabled aria-label="이메일" />
        <input className="auth-input" value={props.name ?? ""} disabled aria-label="이름" />
        <div className="auth-input-group">
          <label className="auth-label" htmlFor="onboarding-phone">전화번호</label>
          <input id="onboarding-phone" className="auth-input" value={form.phone ?? ""} onChange={update("phone")} placeholder="010-1234-5678" />
          {errors.phone && <div className="auth-helper error">{errors.phone}</div>}
        </div>
        <div className="auth-input-group">
          <label className="auth-label" htmlFor="onboarding-birth-date">생년월일</label>
          <input id="onboarding-birth-date" className="auth-input" value={form.birthDate ?? ""} onChange={update("birthDate")} placeholder="1990-01-01" />
          {errors.birthDate && <div className="auth-helper error">{errors.birthDate}</div>}
        </div>
        <div className="auth-input-group">
          <label className="auth-label" htmlFor="onboarding-role">요청 권한</label>
          <div className="auth-select-wrap">
            <select id="onboarding-role" className="auth-select" value={form.role ?? ""} onChange={update("role")}>
              <option value="">요청할 권한을 선택해주세요</option>
              {REGISTERABLE_ROLE_OPTIONS.map((role) => <option key={role.value} value={role.value}>{role.label}</option>)}
            </select>
            <ChevronDown className="auth-select-chev" size={16} aria-hidden="true" />
          </div>
          {errors.role && <div className="auth-helper error">{errors.role}</div>}
        </div>
        <button className="auth-btn" type="submit" disabled={isLoading}>{isLoading ? "저장 중…" : "가입 완료"}</button>
      </form>
    </div>
  );
}
