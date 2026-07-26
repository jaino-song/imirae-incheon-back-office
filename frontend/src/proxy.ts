import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { jwtDecode } from "jwt-decode";

import { createServerApiUrl } from "@/lib/api/server-base-url";
import { setAuthSessionCookies } from "@/lib/auth/session-cookies";
import { getMobileGatewayRedirectUrl } from "@/lib/gateway/mobile-redirect";

interface TokenPayload {
  sub: string;
  sid?: string;
  role: string | null;
  branchId?: string;
  branchRole?: string;
  organizationId?: string;
  orgRole?: string;
  type: "access" | "refresh";
  exp?: number;
}

interface RefreshResponse {
  accessToken?: string;
  refreshToken?: string;
}

type RefreshAttempt =
  | {
    kind: "success";
    accessToken: string;
    refreshToken: string;
  }
  | { kind: "concurrent" }
  | null;

// Routes that don't require authentication
const PUBLIC_ROUTES = [
  "/login",
  "/register",
  "/forgot-password",
  "/reset-password",
  "/verify-email",
  "/callback",
  "/logout",
  "/auth",
  "/api",
  "/_next",
  "/vendor",
  "/favicon.ico",
  "/manifest.json",
  "/sw.js",
];

// Routes that require auth but NOT branch selection
const AUTH_ONLY_ROUTES = [
  "/select-branch",
];

const PENDING_ACCOUNT_ONBOARDING_COOKIE = "pending_account_onboarding";

function isAccessTokenExpiredOrInvalid(token: string): boolean {
  try {
    const decoded = jwtDecode<TokenPayload>(token);
    return decoded.type !== "access"
      || !decoded.sid
      || typeof decoded.exp !== "number"
      || decoded.exp * 1000 <= Date.now();
  } catch {
    return true;
  }
}

function clearAuthCookies(response: NextResponse): void {
  response.cookies.delete("auth_token");
  response.cookies.delete("refresh_token");
  response.cookies.delete("selected_branch_id");
  response.cookies.delete("auto_login");
}

function isAutoLoginEnabled(value: string | undefined): boolean {
  return value !== "0" && value !== "false";
}

function nextWithUpdatedRequestCookies(
  request: NextRequest,
  accessToken: string,
  refreshToken: string,
): NextResponse {
  const requestHeaders = new Headers(request.headers);
  const cookies = new Map(
    request.cookies.getAll().map((cookie) => [cookie.name, cookie.value]),
  );
  cookies.set("auth_token", accessToken);
  cookies.set("refresh_token", refreshToken);
  requestHeaders.set(
    "cookie",
    Array.from(cookies.entries())
      .map(([name, value]) => `${name}=${encodeURIComponent(value)}`)
      .join("; "),
  );
  return NextResponse.next({ request: { headers: requestHeaders } });
}

async function tryRefreshAuthSession(
  refreshToken: string,
): Promise<RefreshAttempt> {
  try {
    const response = await fetch(createServerApiUrl("/auth/refresh-token"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken }),
      cache: "no-store",
    });
    if (!response.ok) {
      if (response.status === 401) {
        const error = await response.json().catch(() => null) as {
          code?: string;
        } | null;
        if (error?.code === "AUTH_REFRESH_REPLAY_CONCURRENT") {
          return { kind: "concurrent" };
        }
      }
      return null;
    }
    const data = await response.json() as RefreshResponse;
    if (
      !data.accessToken
      || isAccessTokenExpiredOrInvalid(data.accessToken)
    ) {
      return null;
    }
    return {
      kind: "success",
      accessToken: data.accessToken,
      refreshToken: data.refreshToken || refreshToken,
    };
  } catch {
    return null;
  }
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const mobileRedirectUrl = getMobileGatewayRedirectUrl(
    request.nextUrl,
    request.headers.get("user-agent")
  );

  if (mobileRedirectUrl) {
    return NextResponse.redirect(mobileRedirectUrl);
  }

  let authToken = request.cookies.get("auth_token")?.value;

  if (
    pathname === "/onboarding" &&
    request.cookies.has(PENDING_ACCOUNT_ONBOARDING_COOKIE)
  ) {
    return NextResponse.next();
  }

  // Skip public routes ("/" needs exact match — startsWith would match every path)
  if (pathname === "/" || PUBLIC_ROUTES.some((route) => pathname.startsWith(route))) {
    const isNavigationRequest = request.method === "GET" || request.method === "HEAD";
    if (
      pathname.startsWith("/login") &&
      isNavigationRequest &&
      authToken &&
      isAccessTokenExpiredOrInvalid(authToken)
    ) {
      const loginRefreshToken = request.cookies.get("refresh_token")?.value;
      if (loginRefreshToken) {
        const refreshAttempt = await tryRefreshAuthSession(loginRefreshToken);
        if (refreshAttempt?.kind === "success") {
          const response = NextResponse.redirect(new URL("/", request.url));
          setAuthSessionCookies(response.cookies, {
            accessToken: refreshAttempt.accessToken,
            refreshToken: refreshAttempt.refreshToken,
            autoLogin: isAutoLoginEnabled(
              request.cookies.get("auto_login")?.value,
            ),
          });
          return response;
        }
        if (refreshAttempt?.kind === "concurrent") {
          const response = NextResponse.next();
          response.cookies.delete("auth_token");
          response.headers.set("Retry-After", "1");
          return response;
        }
      }
      const response = NextResponse.next();
      clearAuthCookies(response);
      return response;
    }
    return NextResponse.next();
  }

  // No auth token - redirect to login
  const refreshToken = request.cookies.get("refresh_token")?.value;
  const autoLogin = isAutoLoginEnabled(
    request.cookies.get("auto_login")?.value,
  );
  let refreshedSession: Extract<RefreshAttempt, { kind: "success" }> | null = null;
  if ((!authToken || isAccessTokenExpiredOrInvalid(authToken)) && refreshToken) {
    const refreshAttempt = await tryRefreshAuthSession(refreshToken);
    if (refreshAttempt?.kind === "concurrent") {
      const response = NextResponse.redirect(request.nextUrl);
      response.headers.set("Retry-After", "1");
      return response;
    }
    if (refreshAttempt?.kind === "success") {
      refreshedSession = refreshAttempt;
      authToken = refreshAttempt.accessToken;
      if (request.method === "GET" || request.method === "HEAD") {
        const response = NextResponse.redirect(request.nextUrl);
        setAuthSessionCookies(response.cookies, {
          accessToken: refreshAttempt.accessToken,
          refreshToken: refreshAttempt.refreshToken,
          autoLogin,
        });
        return response;
      }
    }
  }

  if (!authToken || isAccessTokenExpiredOrInvalid(authToken)) {
    const loginUrl = new URL("/login", request.url);
    const response = NextResponse.redirect(loginUrl);
    clearAuthCookies(response);
    return response;
  }

  // Check if route only requires auth (not branch)
  if (AUTH_ONLY_ROUTES.some((route) => pathname.startsWith(route))) {
    const response = refreshedSession
      ? nextWithUpdatedRequestCookies(
        request,
        refreshedSession.accessToken,
        refreshedSession.refreshToken,
      )
      : NextResponse.next();
    if (refreshedSession) {
      setAuthSessionCookies(response.cookies, {
        accessToken: refreshedSession.accessToken,
        refreshToken: refreshedSession.refreshToken,
        autoLogin,
      });
    }
    return response;
  }

  // For all other routes, check if branch is selected
  try {
    const decoded = jwtDecode<TokenPayload>(authToken);

    // No branch selected - redirect to select-branch
    if (!decoded.branchId && !decoded.organizationId) {
      const selectBranchUrl = new URL("/select-branch", request.url);
      return NextResponse.redirect(selectBranchUrl);
    }

    const response = refreshedSession
      ? nextWithUpdatedRequestCookies(
        request,
        refreshedSession.accessToken,
        refreshedSession.refreshToken,
      )
      : NextResponse.next();
    if (refreshedSession) {
      setAuthSessionCookies(response.cookies, {
        accessToken: refreshedSession.accessToken,
        refreshToken: refreshedSession.refreshToken,
        autoLogin,
      });
    }
    return response;
  } catch {
    // Invalid token - redirect to login
    const loginUrl = new URL("/login", request.url);
    const response = NextResponse.redirect(loginUrl);
    clearAuthCookies(response);
    return response;
  }
}

export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - public files (images, etc.)
     */
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
