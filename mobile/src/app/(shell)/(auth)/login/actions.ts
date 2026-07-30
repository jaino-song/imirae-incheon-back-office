"use server"

import { cookies } from "next/headers";
import { AxiosError } from "axios";
import { jwtDecode } from "jwt-decode";

import { serverAPIClient } from "@/lib/api/server";
import { getServerRuntimeConfig } from "@/lib/env";
import {
    ACCESS_TOKEN_MAX_AGE_SECONDS,
    decodeAccessBranchId,
    getRefreshSessionMaxAgeSeconds,
} from "@/lib/auth/session-policy";

interface TokenPayload {
    sub: string;
    role: string | null;
    type: "access" | "refresh";
}

interface APIErrorResponse {
    statusCode: number;
    message: string;
    error: string;
    code?: string;
}

interface LoginResult {
    success: boolean;
    error?: string;
    requiresBranchSelection?: boolean;
    emailVerificationRequired?: boolean;
    onboardingRequired?: boolean;
    onboardingRoute?: "/onboarding";
    authErrorCode?: string;
}

interface LoginOnboardingResponse {
    success: true;
    onboardingRequired: true;
    onboardingRoute: "/onboarding";
    pendingAccountOnboardingToken: string;
}

function isLoginOnboardingResponse(data: unknown): data is LoginOnboardingResponse {
    return typeof data === "object"
        && data !== null
        && "onboardingRequired" in data
        && data.onboardingRequired === true;
}

function resolveAutoLoginCookieValue(autoLogin: boolean): "1" | "0" {
    return autoLogin ? "1" : "0";
}

function isAutoLoginCookieEnabled(value: string | undefined): boolean {
    return value === "1";
}

export async function loginWithEmail(email: string, password: string, autoLogin = true): Promise<LoginResult> {
    try {
        console.log("[Server Action] Logging in with email");

        const { data, status } = await serverAPIClient.post("/auth/login", { email, password });

        // Handle error responses
        if (status >= 400 || !data.success) {
            return {
                success: false,
                error: data.message || "이메일 또는 비밀번호가 올바르지 않습니다.",
                authErrorCode: typeof data.code === "string" ? data.code : undefined,
                emailVerificationRequired: data.message?.includes("이메일 인증")
            };
        }

        // Store tokens in httpOnly cookies
        const cookieStore = await cookies();
        const isSecureCookie = getServerRuntimeConfig().isSecureCookieEnv;

        if (isLoginOnboardingResponse(data)) {
            cookieStore.set("pending_account_onboarding", data.pendingAccountOnboardingToken, {
                httpOnly: true,
                secure: isSecureCookie,
                sameSite: "lax",
                path: "/",
                maxAge: 30 * 60,
            });
            cookieStore.delete("pending_kakao_signup");
            cookieStore.delete("auth_token");
            cookieStore.delete("refresh_token");
            cookieStore.delete("auto_login");

            return {
                success: true,
                onboardingRequired: true,
                onboardingRoute: data.onboardingRoute,
            };
        }

        let role = "user";
        try {
            const decoded = jwtDecode<TokenPayload>(data.accessToken);
            role = decoded.role || "user";
        } catch {
            console.error("[Server Action] Failed to decode token");
        }

        const authCookieBaseOptions = {
            httpOnly: true,
            secure: isSecureCookie,
            sameSite: "lax",
            path: "/",
        } as const;

        if (autoLogin) {
            cookieStore.set("auth_token", data.accessToken, {
                ...authCookieBaseOptions,
                maxAge: ACCESS_TOKEN_MAX_AGE_SECONDS,
            });
        } else {
            cookieStore.set("auth_token", data.accessToken, authCookieBaseOptions);
        }

        const refreshCookieBaseOptions = {
            httpOnly: true,
            secure: isSecureCookie,
            sameSite: "lax",
            path: "/",
        } as const;

        if (autoLogin) {
            cookieStore.set("refresh_token", data.refreshToken, {
                ...refreshCookieBaseOptions,
                maxAge: getRefreshSessionMaxAgeSeconds(role),
            });
        } else {
            cookieStore.set("refresh_token", data.refreshToken, refreshCookieBaseOptions);
        }

        const autoLoginCookieValue = resolveAutoLoginCookieValue(autoLogin);
        const autoLoginEnabled = isAutoLoginCookieEnabled(autoLoginCookieValue);
        if (autoLoginEnabled) {
            cookieStore.set("auto_login", autoLoginCookieValue, {
                ...authCookieBaseOptions,
                maxAge: 30 * 24 * 60 * 60,
            });
        } else {
            cookieStore.set("auto_login", autoLoginCookieValue, authCookieBaseOptions);
        }

        // middleware.ts gates every non-auth route on the selected_branch_id
        // cookie. When the backend has already resolved a single accessible
        // branch into the access token (requiresBranchSelection is false),
        // reflect that branch here now — otherwise the user is bounced
        // through /select-branch on the very next navigation.
        //
        // Every other case must CLEAR the cookie: this token carries no
        // authorised branch, and a stale value left by a previous account on
        // this device would otherwise satisfy the middleware gate and wave
        // this login through to /dashboard with someone else's branch.
        const branchId = data.requiresBranchSelection
            ? null
            : decodeAccessBranchId(data.accessToken);
        if (branchId) {
            cookieStore.set("selected_branch_id", branchId, {
                httpOnly: false,
                secure: isSecureCookie,
                sameSite: "lax",
                path: "/",
                maxAge: 30 * 24 * 60 * 60,
            });
        } else {
            cookieStore.delete("selected_branch_id");
        }

        console.log("[Server Action] Email login successful");
        console.log("[Server Action] requiresBranchSelection:", data.requiresBranchSelection);

        // Use requiresBranchSelection from backend response
        return { success: true, requiresBranchSelection: data.requiresBranchSelection || false };
    } catch (error) {
        console.error("[Server Action] Email Login Error:", error);

        if (error instanceof AxiosError) {
            const axiosError = error as AxiosError<APIErrorResponse>;
            console.error("[Server Action] Axios Error:", {
                message: axiosError.message,
                code: axiosError.code,
                status: axiosError.response?.status,
            });

            if (axiosError.code === 'ECONNABORTED' || axiosError.message === 'Network Error') {
                return { success: false, error: "서버에 연결할 수 없습니다. 다시 시도해 주세요." };
            }

            return {
                success: false,
                error: axiosError.response?.data?.message || "로그인에 실패했습니다.",
                authErrorCode: axiosError.response?.data?.code,
            };
        }

        return {
            success: false,
            error: error instanceof Error ? error.message : "알 수 없는 오류가 발생했습니다."
        };
    }
}
