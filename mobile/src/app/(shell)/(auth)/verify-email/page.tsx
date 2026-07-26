"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { CheckCircle, AlertTriangle, Loader2 } from "lucide-react";
import { authApi } from "@/services/api";
import { AuthCard } from "@/components/auth/auth-card";
import { FormField } from "@/components/auth/form-field";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { Spinner } from "@/components/ui/spinner";
import { safeStorageGetItem, safeStorageSetItem } from "@/lib/safe-storage";

/** Canonical data-component base for the /verify-email route. */
const VERIFY_EMAIL_BASE = "mobile_auth_verify-email";

export default function VerifyEmailPage() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const token = searchParams.get("token");

    const [status, setStatus] = useState<"loading" | "success" | "error" | "no-token">(
        token ? "loading" : "no-token"
    );
    const [message, setMessage] = useState<string>("");
    const [resendEmail, setResendEmail] = useState("");
    const [resendLoading, setResendLoading] = useState(false);
    const [resendMessage, setResendMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

    useEffect(() => {
        const queryEmail = searchParams.get("email")?.trim() || "";
        const savedEmail = safeStorageGetItem("local", "auth:verificationEmail")?.trim() || "";
        const initialEmail = queryEmail || savedEmail;
        if (initialEmail) {
            setResendEmail(initialEmail);
        }
    }, [searchParams]);

    useEffect(() => {
        if (!token) return;

        const verifyEmail = async () => {
            try {
                const response = await authApi.verifyEmail(token);

                if (response.success) {
                    setStatus("success");
                    setMessage(response.message || "이메일 인증이 완료되었습니다.");
                } else {
                    setStatus("error");
                    setMessage(response.message || "이메일 인증에 실패했습니다.");
                }
            } catch (err) {
                console.error("Email verification error:", err);
                setStatus("error");
                setMessage("네트워크 오류가 발생했습니다. 다시 시도해 주세요.");
            }
        };

        verifyEmail();
    }, [token]);

    const handleResend = async (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        if (!resendEmail.trim()) return;

        setResendLoading(true);
        setResendMessage(null);

        try {
            const response = await authApi.resendVerification(resendEmail);
            if (response.success) {
                safeStorageSetItem("local", "auth:verificationEmail", resendEmail.trim());
            }
            setResendMessage({
                type: response.success ? "success" : "error",
                text: response.message || (response.success ? "인증 이메일이 재발송되었습니다." : "재발송에 실패했습니다."),
            });
        } catch (err) {
            console.error("Resend verification error:", err);
            setResendMessage({
                type: "error",
                text: "네트워크 오류가 발생했습니다.",
            });
        } finally {
            setResendLoading(false);
        }
    };

    // Loading State
    if (status === "loading") {
        return (
            <AuthCard data-component={VERIFY_EMAIL_BASE} disableAnimation>
                <div data-component={`${VERIFY_EMAIL_BASE}_loading`} className="flex flex-col items-center gap-4 text-center">
                    <Loader2 className="h-12 w-12 text-primary animate-spin" />
                    <p className="text-muted-foreground">이메일 인증 중...</p>
                </div>
            </AuthCard>
        );
    }

    // Success State
    if (status === "success") {
        return (
            <AuthCard data-component={VERIFY_EMAIL_BASE}>
                <div data-component={`${VERIFY_EMAIL_BASE}_success`} className="flex flex-col items-center gap-4 text-center">
                    <div data-component={`${VERIFY_EMAIL_BASE}_success_icon`} className="rounded-full bg-success/10 p-3">
                        <CheckCircle className="h-12 w-12 text-success" />
                    </div>
                    <h2 className="text-2xl font-bold">인증 완료!</h2>
                    <p className="text-muted-foreground">{message}</p>
                    <Button
                        data-component={`${VERIFY_EMAIL_BASE}_success_login-button`}
                        size="lg"
                        className="w-full"
                        onClick={() => router.push("/login")}
                    >
                        로그인하기
                    </Button>
                </div>
            </AuthCard>
        );
    }

    // Error State
    if (status === "error") {
        return (
            <AuthCard data-component={VERIFY_EMAIL_BASE}>
                <div data-component={`${VERIFY_EMAIL_BASE}_error`} className="flex flex-col items-center gap-4 text-center">
                    <div data-component={`${VERIFY_EMAIL_BASE}_error_icon`} className="rounded-full bg-destructive/10 p-3">
                        <AlertTriangle className="h-12 w-12 text-destructive" />
                    </div>
                    <h2 className="text-2xl font-bold">인증 실패</h2>
                    <p className="text-muted-foreground">{message}</p>
                    <Alert variant="info" className="w-full text-left">
                        인증 링크가 만료되었거나 이미 사용된 경우, 아래에서 재발송을 요청할 수 있습니다.
                    </Alert>

                    <form onSubmit={handleResend} data-component={`${VERIFY_EMAIL_BASE}_error_resend-form`} className="w-full flex flex-col gap-3">
                        <FormField
                            label="이메일 주소"
                            type="email"
                            value={resendEmail}
                            onChange={(e) => setResendEmail(e.target.value)}
                            disabled={resendLoading}
                            data-component={`${VERIFY_EMAIL_BASE}_error_resend-form_email-field`}
                        />
                        {resendMessage && (
                            <Alert
                                variant={resendMessage.type === "success" ? "success" : "destructive"}
                            >
                                {resendMessage.text}
                            </Alert>
                        )}
                        <Button
                            data-component={`${VERIFY_EMAIL_BASE}_error_resend-form_submit-button`}
                            type="submit"
                            variant="outline"
                            size="lg"
                            className="w-full"
                            disabled={resendLoading || !resendEmail.trim()}
                        >
                            {resendLoading ? <Spinner size="sm" /> : "인증 이메일 재발송"}
                        </Button>
                    </form>

                    <Button
                        data-component={`${VERIFY_EMAIL_BASE}_error_login-button`}
                        variant="ghost"
                        onClick={() => router.push("/login")}
                    >
                        로그인 페이지로 돌아가기
                    </Button>
                </div>
            </AuthCard>
        );
    }

    // No Token State
    return (
        <AuthCard data-component={VERIFY_EMAIL_BASE}>
            <div data-component={`${VERIFY_EMAIL_BASE}_no-token`} className="flex flex-col items-center gap-4 text-center">
                <div data-component={`${VERIFY_EMAIL_BASE}_no-token_icon`} className="rounded-full bg-warning/10 p-3">
                    <AlertTriangle className="h-12 w-12 text-warning" />
                </div>
                <h2 className="text-2xl font-bold">인증 링크 정보 없음</h2>
                <p className="text-muted-foreground">
                    로그인 화면에서 인증 이메일을 재발송하거나 아래에서 바로 요청할 수 있습니다.
                </p>

                <form onSubmit={handleResend} data-component={`${VERIFY_EMAIL_BASE}_no-token_resend-form`} className="w-full flex flex-col gap-3">
                    <FormField
                        label="이메일 주소"
                        type="email"
                        value={resendEmail}
                        onChange={(e) => setResendEmail(e.target.value)}
                        disabled={resendLoading}
                        data-component={`${VERIFY_EMAIL_BASE}_no-token_resend-form_email-field`}
                    />
                    {resendMessage && (
                        <Alert
                            variant={resendMessage.type === "success" ? "success" : "destructive"}
                        >
                            {resendMessage.text}
                        </Alert>
                    )}
                    <Button
                        data-component={`${VERIFY_EMAIL_BASE}_no-token_resend-form_submit-button`}
                        type="submit"
                        variant="outline"
                        size="lg"
                        className="w-full"
                        disabled={resendLoading || !resendEmail.trim()}
                    >
                        {resendLoading ? <Spinner size="sm" /> : "인증 이메일 재발송"}
                    </Button>
                </form>

                <Button
                    data-component={`${VERIFY_EMAIL_BASE}_no-token_login-button`}
                    variant="ghost"
                    onClick={() => router.push("/login")}
                >
                    로그인 페이지로 돌아가기
                </Button>
            </div>
        </AuthCard>
    );
}
