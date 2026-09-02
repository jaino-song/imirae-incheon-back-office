import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";

import { serverAPIClient } from "@/lib/api/server";
import { getUpstreamErrorStatus, logUpstreamError } from "@/lib/api/route-utils";
import { clearAuthSessionCookies, setAuthSessionCookies } from "@/lib/auth/session-cookies";
import { AUTH_COOKIE_NAMES } from "@/lib/auth/session-policy";

interface RefreshResponse {
    accessToken?: unknown;
    refreshToken?: unknown;
}

// Upstream answered, but without a usable token pair. The session cannot be
// recovered, so this must surface as 401 (and clear cookies) rather than as a
// transient 502 — the browser interceptor only redirects to /login on a 401,
// and a 502 would strand the tab issuing 401s forever.
class UnrecoverableRefreshError extends Error {}

function isAutoLoginEnabled(value: string | undefined): boolean {
    return value !== "0" && value !== "false";
}

export async function POST(request: NextRequest) {
    const refreshToken = request.cookies.get(AUTH_COOKIE_NAMES.refreshToken)?.value;
    if (!refreshToken) {
        return NextResponse.json(
            { error: "Session refresh required", code: "AUTH_REFRESH_REQUIRED" },
            { status: 401 },
        );
    }

    try {
        const response = await serverAPIClient.post<RefreshResponse>("/auth/refresh-token", {
            refreshToken,
        });
        const accessToken = response.data.accessToken;
        const rotatedRefreshToken = response.data.refreshToken;
        if (typeof accessToken !== "string" || typeof rotatedRefreshToken !== "string") {
            throw new UnrecoverableRefreshError("Auth refresh response is missing tokens");
        }

        const cookieStore = await cookies();
        setAuthSessionCookies(cookieStore, {
            accessToken,
            refreshToken: rotatedRefreshToken,
            autoLogin: isAutoLoginEnabled(
                request.cookies.get(AUTH_COOKIE_NAMES.autoLogin)?.value,
            ),
        });

        const result = NextResponse.json({ success: true });
        result.headers.set("Cache-Control", "no-store, max-age=0");
        return result;
    } catch (error) {
        const status = error instanceof UnrecoverableRefreshError
            ? 401
            : getUpstreamErrorStatus(error);
        logUpstreamError("refresh app session", error);

        if (status === 401) {
            const cookieStore = await cookies();
            clearAuthSessionCookies(cookieStore);
        }

        const result = NextResponse.json(
            { error: "Session refresh failed", code: "AUTH_REFRESH_FAILED" },
            { status: status === 401 ? 401 : 502 },
        );
        result.headers.set("Cache-Control", "no-store, max-age=0");
        return result;
    }
}
