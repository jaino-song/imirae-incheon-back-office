"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ChevronRight } from "lucide-react";
import { AuthPanel } from "@/components/auth/auth-panel";
import { FormField } from "@/components/auth/form-field";
import { SelectField } from "@/components/auth/select-field";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { Spinner } from "@/components/ui/spinner";
import { REGISTERABLE_ROLE_OPTIONS } from "@/lib/constants/roles";
import { kakaoOnboardingSchema, type KakaoOnboardingFormData } from "@/lib/validations/auth";
import { completeKakaoOnboarding } from "./actions";

const PANEL_CLASS_NAME = "gap-5 !p-5 sm:!p-6 [&_[data-component='auth-kakao-onboarding-title']]:!text-[1.72rem] md:[&_[data-component='auth-kakao-onboarding-title']]:!text-[1.5rem] [&_[data-component='auth-kakao-onboarding-subtitle']]:!max-w-[34ch] [&_[data-component='auth-kakao-onboarding-subtitle']]:!text-[0.82rem] md:[&_[data-component='auth-kakao-onboarding-subtitle']]:!text-[0.76rem]";
const PRIMARY_BUTTON_CLASS_NAME = "h-10 px-5 gap-1.5 text-[0.72rem] md:text-[0.77rem] font-bold";

interface OnboardingFormProps {
    email?: string;
    name?: string;
    profileImage?: string;
    phone?: string;
    birthDate?: string;
    role?: KakaoOnboardingFormData["role"];
    title?: string;
    subtitle?: string;
}

function formatBirthDateInput(value: string) {
    const digits = value.replace(/\D/g, "").slice(0, 8);

    if (digits.length <= 4) {
        return digits;
    }

    if (digits.length <= 6) {
        return `${digits.slice(0, 4)}-${digits.slice(4)}`;
    }

    return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6)}`;
}

function formatPhoneInput(value: string) {
    const digits = value.replace(/\D/g, "").slice(0, 11);

    if (digits.length === 0) {
        return "";
    }

    if (digits[0] !== "0") {
        return "";
    }

    if (digits.length === 1) {
        return "0";
    }

    if (digits[1] !== "1") {
        return "0";
    }

    if (digits.length <= 3) {
        return digits;
    }

    if (digits.length <= 7) {
        return `${digits.slice(0, 3)}-${digits.slice(3)}`;
    }

    return `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7)}`;
}

export function OnboardingForm({
    email,
    name,
    phone,
    birthDate,
    role,
    title = "카카오 가입 마무리",
    subtitle = "카카오에서 받은 계정 정보는 그대로 사용하고, 추가 정보만 입력해 주세요.",
}: OnboardingFormProps) {
    const router = useRouter();
    const [formData, setFormData] = useState<Partial<KakaoOnboardingFormData>>({
        phone: phone ?? "",
        birthDate: birthDate ?? "",
        role: role ?? undefined,
    });
    const [errors, setErrors] = useState<Record<string, string>>({});
    const [serverError, setServerError] = useState<string | null>(null);
    const [isPending, startTransition] = useTransition();

    const isDisabled = useMemo(() => {
        const result = kakaoOnboardingSchema.safeParse(formData);
        return !result.success || isPending;
    }, [formData, isPending]);

    const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        setServerError(null);

        const result = kakaoOnboardingSchema.safeParse(formData);
        if (!result.success) {
            const nextErrors: Record<string, string> = {};
            result.error.issues.forEach((issue) => {
                const field = issue.path[0];
                if (typeof field === "string" && !nextErrors[field]) {
                    nextErrors[field] = issue.message;
                }
            });
            setErrors(nextErrors);
            return;
        }

        startTransition(async () => {
            const response = await completeKakaoOnboarding(result.data);
            if (!response.success) {
                setServerError(response.error || "계정 정보를 저장하지 못했습니다.");
                return;
            }

            router.replace("/login?authError=PENDING_APPROVAL");
        });
    };

    const handleFieldChange = (field: keyof KakaoOnboardingFormData) => (event: React.ChangeEvent<HTMLInputElement>) => {
        const value = field === "phone"
            ? formatPhoneInput(event.target.value)
            : field === "birthDate"
                ? formatBirthDateInput(event.target.value)
                : event.target.value;

        setFormData((prev) => ({ ...prev, [field]: value }));
        setErrors((prev) => {
            const next = { ...prev };
            delete next[field];
            return next;
        });
        setServerError(null);
    };

    const handleSelectChange = (field: keyof KakaoOnboardingFormData) => (value: string) => {
        setFormData((prev) => ({ ...prev, [field]: value }));
        setErrors((prev) => {
            const next = { ...prev };
            delete next[field];
            return next;
        });
        setServerError(null);
    };

    return (
        <AuthPanel
            data-component="desktop_auth_kakao-onboarding"
            dataComponents={{
                container: "desktop_auth_kakao-onboarding_container",
                card: "desktop_auth_kakao-onboarding_card",
                header: "desktop_auth_kakao-onboarding_header",
                title: "desktop_auth_kakao-onboarding_title",
                subtitle: "desktop_auth_kakao-onboarding_subtitle",
                content: "desktop_auth_kakao-onboarding_content",
            }}
            title={title}
            subtitle={subtitle}
            className={PANEL_CLASS_NAME}
            contentClassName="gap-[18px]"
        >
            {serverError && (
                <div data-component="desktop_auth_kakao-onboarding_alert">
                    <Alert variant="destructive" onClose={() => setServerError(null)}>
                        {serverError}
                    </Alert>
                </div>
            )}

            <form onSubmit={handleSubmit} className="flex flex-col gap-[14px]" data-component="desktop_auth_kakao-onboarding_form">
                <FormField
                    label="이메일"
                    type="email"
                    value={email ?? ""}
                    readOnly
                    disabled
                    className="bg-v3-dim-white/80"
                    data-component="desktop_auth_kakao-onboarding_form_email-field"
                />
                <FormField
                    label="이름"
                    type="text"
                    value={name ?? ""}
                    readOnly
                    disabled
                    className="bg-v3-dim-white/80"
                    data-component="desktop_auth_kakao-onboarding_form_name-field"
                />
                <FormField
                    label="전화번호"
                    type="tel"
                    value={formData.phone}
                    onChange={handleFieldChange("phone")}
                    error={errors.phone}
                    inputMode="numeric"
                    maxLength={13}
                    placeholder="010-1234-5678"
                    disabled={isPending}
                    data-component="desktop_auth_kakao-onboarding_form_phone-field"
                />
                <FormField
                    label="생년월일"
                    type="text"
                    value={formData.birthDate}
                    onChange={handleFieldChange("birthDate")}
                    error={errors.birthDate}
                    inputMode="numeric"
                    maxLength={10}
                    placeholder="1990-01-01"
                    disabled={isPending}
                    data-component="desktop_auth_kakao-onboarding_form_birthdate-field"
                />
                <SelectField
                    label="요청 권한"
                    value={formData.role}
                    onValueChange={handleSelectChange("role")}
                    options={REGISTERABLE_ROLE_OPTIONS}
                    placeholder="요청할 권한을 선택해주세요"
                    error={errors.role}
                    disabled={isPending}
                    data-component="desktop_auth_kakao-onboarding_form_role-field"
                />

                <Button
                    type="submit"
                    variant="positive"
                    size="md"
                    className={PRIMARY_BUTTON_CLASS_NAME}
                    disabled={isDisabled}
                    data-component="desktop_auth_kakao-onboarding_form_submit-btn"
                >
                    {isPending ? <Spinner size="sm" /> : (
                        <>
                            가입 완료
                            <ChevronRight className="w-4 h-4" />
                        </>
                    )}
                </Button>
            </form>
        </AuthPanel>
    );
}
