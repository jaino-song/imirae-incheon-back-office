"use client"

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Spinner } from "@/components/ui/spinner";
import { exchangeToken } from "./actions";
import { getSafeCallbackError } from "@/lib/auth/auth-errors";

/** Canonical data-component base for the /callback route. */
const CALLBACK_BASE = "mobile_auth_callback";

export default function AuthCallbackPage() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        const exchangeCodeForTokens = async () => {
            const oauthError = searchParams.get("error");
            const code = searchParams.get("code");

            console.log("[Auth Callback] Starting token exchange");
            console.log("[Auth Callback] Code present:", !!code);

            if (oauthError) {
                console.error("[Auth Callback] OAuth provider returned an error");
                setError(getSafeCallbackError(oauthError));
                return;
            }

            if (!code) {
                console.error("[Auth Callback] No code in URL");
                setError("Authorization Code Required");
                return;
            }

            try {
                console.log("[Auth Callback] Using server action for token exchange");

                // Use server action - bypasses Safari's client-side restrictions
                const result = await exchangeToken(code);

                if (!result.success) {
                    console.error("[Auth Callback] Token exchange failed:", result.error);
                    setError(result.error || "Authentication Failed");
                    return;
                }

                console.log("[Auth Callback] Token exchange successful");

                // Every navigation below crosses an identity boundary (new
                // account/branch session). The shared (shell) layout would not
                // re-render its server-rendered UserProvider on a soft navigation, so
                // reload the document instead.
                if (result.onboardingRequired) {
                    window.location.replace(result.onboardingRoute || "/kakao/onboarding");
                    return;
                }

                if (result.requiresBranchSelection) {
                    console.log("[Auth Callback] Multiple branches detected, redirecting to selection");
                    window.location.replace("/select-branch");
                } else {
                    console.log("[Auth Callback] Redirecting to dashboard");
                    window.location.replace("/dashboard");
                }
            }
            catch (err) {
                console.error("[Auth Callback] Token Exchange Error:", err);
                console.error("[Auth Callback] Error message:", err instanceof Error ? err.message : String(err));
                setError("네트워크 오류가 발생했습니다. 다시 시도해 주세요.");
            }
        }
        exchangeCodeForTokens();
    }, [searchParams]);

    if (error) {
        return (
            <div data-component={CALLBACK_BASE} className="flex min-h-[100dvh] flex-col items-center justify-center gap-4 px-6 text-center">
                <p className="text-destructive">{error}</p>
                <button
                    data-component={`${CALLBACK_BASE}_login-button`}
                    className="text-sm text-muted-foreground cursor-pointer hover:underline"
                    onClick={() => router.push("/login")}
                >
                    로그인 페이지로 돌아가기
                </button>
            </div>
        );
    }

    return (
        <div data-component={CALLBACK_BASE} className="flex min-h-[100dvh] flex-col items-center justify-center gap-4 px-6 text-center">
            <Spinner size="lg" />
            <p className="text-foreground">로그인 중...</p>
        </div>
    );
}
