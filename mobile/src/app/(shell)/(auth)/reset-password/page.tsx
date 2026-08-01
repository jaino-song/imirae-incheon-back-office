"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { CheckCircle, AlertTriangle } from "lucide-react";
import { getResetPasswordErrorMessage } from "@babyjamjam/shared";
import { authApi } from "@/services/api";
import { resetPasswordSchema, checkPasswordStrength, type ResetPasswordFormData } from "@/lib/validations/auth";
import { CardContainer } from "@/components/auth/card-container";
import { AuthInlineLink } from "@/components/auth/auth-inline-link";
import { FormField } from "@/components/auth/form-field";
import { PasswordRequirements } from "@/components/auth/password-requirements";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { Spinner } from "@/components/ui/spinner";

/**
 * Canonical data-component base for the /reset-password route. CardContainer
 * derives its own `_card` / `_card_content` levels from this base, so children
 * rendered into the card body hang off RESET_PASSWORD_CARD_CONTENT.
 */
const RESET_PASSWORD_BASE = "mobile_auth_reset-password";
const RESET_PASSWORD_CARD_CONTENT = `${RESET_PASSWORD_BASE}_card_content`;

export default function ResetPasswordPage() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const token = searchParams.get("token");

    const [formData, setFormData] = useState<Partial<ResetPasswordFormData>>({
        newPassword: "",
        confirmPassword: "",
    });
    const [error, setError] = useState<string | null>(null);
    const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
    const [isLoading, setIsLoading] = useState(false);
    const [isSuccess, setIsSuccess] = useState(false);

    const passwordStrength = checkPasswordStrength(formData.newPassword || "");

    const handleChange = (field: keyof ResetPasswordFormData) => (e: React.ChangeEvent<HTMLInputElement>) => {
        setFormData((prev) => ({ ...prev, [field]: e.target.value }));
        if (fieldErrors[field]) {
            setFieldErrors((prev) => {
                const newErrors = { ...prev };
                delete newErrors[field];
                return newErrors;
            });
        }
        setError(null);
    };

    const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        setError(null);
        setFieldErrors({});

        if (!token) {
            setError("유효하지 않은 비밀번호 재설정 링크입니다.");
            return;
        }

        // Validate with Zod
        const result = resetPasswordSchema.safeParse(formData);
        if (!result.success) {
            const errors: Record<string, string> = {};
            result.error.issues.forEach((issue) => {
                const field = issue.path[0] as string;
                if (!errors[field]) {
                    errors[field] = issue.message;
                }
            });
            setFieldErrors(errors);
            return;
        }

        setIsLoading(true);

        try {
            const response = await authApi.resetPassword(token, result.data.newPassword);

            if (response.success) {
                setIsSuccess(true);
            } else {
                setError(response.message || "비밀번호 재설정에 실패했습니다.");
            }
        } catch (err) {
            console.error("Reset password error:", err);
            const errorData = err && typeof err === "object" && "response" in err
                ? (err as { response?: { data?: { code?: unknown } } }).response?.data
                : undefined;
            setError(
                getResetPasswordErrorMessage(errorData?.code)
                ?? "네트워크 오류가 발생했습니다. 다시 시도해 주세요.",
            );
        } finally {
            setIsLoading(false);
        }
    };

    // No token provided
    if (!token) {
        return (
            <CardContainer
                data-component={RESET_PASSWORD_BASE}
                data-slot="auth-reset-password-page"
                className="max-w-[400px] border bg-card text-card-foreground shadow-lg"
            >
                <div data-component={`${RESET_PASSWORD_CARD_CONTENT}_invalid`} className="flex flex-col items-center gap-4 text-center">
                    <div data-component={`${RESET_PASSWORD_CARD_CONTENT}_invalid_icon`} className="rounded-full bg-destructive/10 p-3">
                        <AlertTriangle className="h-12 w-12 text-destructive" />
                    </div>
                    <h2 className="text-2xl font-bold">유효하지 않은 링크</h2>
                    <p className="text-muted-foreground">
                        비밀번호 재설정 링크가 유효하지 않습니다.
                        <br />
                        이메일의 링크를 다시 확인해 주세요.
                    </p>
                    <Button
                        data-component={`${RESET_PASSWORD_CARD_CONTENT}_invalid_retry-button`}
                        size="lg"
                        className="w-full rounded-2xl"
                        onClick={() => router.push("/forgot-password")}
                    >
                        비밀번호 재설정 다시 요청
                    </Button>
                    <AuthInlineLink
                        dataComponent={`${RESET_PASSWORD_CARD_CONTENT}_invalid_login-link`}
                        href="/login"
                        linkLabel="로그인 페이지로 돌아가기"
                    />
                </div>
            </CardContainer>
        );
    }

    // Success State
    if (isSuccess) {
        return (
            <CardContainer
                data-component={RESET_PASSWORD_BASE}
                data-slot="auth-reset-password-page"
                className="max-w-[400px] border bg-card text-card-foreground shadow-lg"
            >
                <div data-component={`${RESET_PASSWORD_CARD_CONTENT}_success`} className="flex flex-col items-center gap-4 text-center">
                    <div data-component={`${RESET_PASSWORD_CARD_CONTENT}_success_icon`} className="rounded-full bg-success/10 p-3">
                        <CheckCircle className="h-12 w-12 text-success" />
                    </div>
                    <h2 className="text-2xl font-bold">비밀번호 변경 완료!</h2>
                    <p className="text-muted-foreground">
                        새 비밀번호로 로그인할 수 있습니다.
                    </p>
                    <Button
                        data-component={`${RESET_PASSWORD_CARD_CONTENT}_success_login-button`}
                        size="lg"
                        className="w-full rounded-2xl"
                        onClick={() => router.push("/login")}
                    >
                        로그인하기
                    </Button>
                </div>
            </CardContainer>
        );
    }

    return (
        <CardContainer
            data-component={RESET_PASSWORD_BASE}
            data-slot="auth-reset-password-page"
            className="max-w-[400px] border bg-card text-card-foreground shadow-lg"
            contentClassName="flex flex-col gap-6"
            title="새 비밀번호 설정"
            subtitle="새로운 비밀번호를 입력해 주세요."
        >
            {error && (
                <Alert variant="destructive" onClose={() => setError(null)}>
                    {error}
                </Alert>
            )}

            <form onSubmit={handleSubmit} data-component={`${RESET_PASSWORD_CARD_CONTENT}_form`} className="flex flex-col gap-4">
                <FormField
                    label="새 비밀번호"
                    type="password"
                    value={formData.newPassword}
                    onChange={handleChange("newPassword")}
                    error={fieldErrors.newPassword}
                    disabled={isLoading}
                    autoComplete="new-password"
                    autoFocus
                    data-component={`${RESET_PASSWORD_CARD_CONTENT}_form_new-password-field`}
                />

                {/* Password Requirements */}
                {formData.newPassword && (
                    <PasswordRequirements
                        requirements={passwordStrength.requirements}
                        className="animate-fade-in"
                    />
                )}

                <FormField
                    label="비밀번호 확인"
                    type="password"
                    value={formData.confirmPassword}
                    onChange={handleChange("confirmPassword")}
                    error={fieldErrors.confirmPassword}
                    disabled={isLoading}
                    autoComplete="new-password"
                    data-component={`${RESET_PASSWORD_CARD_CONTENT}_form_confirm-password-field`}
                />

                <Button
                    data-component={`${RESET_PASSWORD_CARD_CONTENT}_form_submit-button`}
                    type="submit"
                    size="lg"
                    className="w-full rounded-2xl"
                    disabled={isLoading}
                >
                    {isLoading ? <Spinner size="sm" /> : "비밀번호 변경"}
                </Button>
            </form>

            <AuthInlineLink
                dataComponent={`${RESET_PASSWORD_CARD_CONTENT}_login-link`}
                href="/login"
                linkLabel="로그인 페이지로 돌아가기"
            />
        </CardContainer>
    );
}
