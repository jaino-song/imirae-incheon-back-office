import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { jwtDecode } from "jwt-decode";

import { getServerRuntimeConfig } from "@/lib/env";
import {
  ACCESS_TOKEN_MAX_AGE_SECONDS,
  getRefreshSessionMaxAgeSeconds,
} from "@/lib/auth/session-policy";

interface TokenPayload {
  sub: string;
  sid?: string;
  role: string | null;
  branchId?: string;
  branchRole?: string;
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
    role: string;
  }
  | { kind: "concurrent" }
  | null;

const {
  backendBaseUrl: API_URL,
  isProductionLike,
} = getServerRuntimeConfig();

function isAutoLoginEnabled(value: string | undefined): boolean {
  return value !== "0" && value !== "false";
}

function decodeRole(token: string): string {
  try {
    const decoded = jwtDecode<TokenPayload>(token);
    return decoded.role || "user";
  } catch {
    return "user";
  }
}

function isTokenExpired(token: string): boolean {
  try {
    const decoded = jwtDecode<TokenPayload>(token);
    return decoded.type !== "access"
      || !decoded.sid
      || !decoded.exp
      || decoded.exp * 1000 <= Date.now();
  } catch {
    return true;
  }
}

function clearAuthCookies(response: NextResponse): void {
  response.cookies.delete("auth_token");
  response.cookies.delete("refresh_token");
  response.cookies.delete("auto_login");
  response.cookies.delete("selected_branch_id");
}

function buildRequestCookieHeader(request: NextRequest, params: {
  accessToken: string;
  refreshToken: string;
  autoLogin: boolean;
}): string {
  const cookiesMap = new Map<string, string>();

  request.cookies.getAll().forEach((cookie) => {
    cookiesMap.set(cookie.name, cookie.value);
  });

  cookiesMap.set("auth_token", params.accessToken);
  cookiesMap.set("refresh_token", params.refreshToken);
  cookiesMap.set("auto_login", params.autoLogin ? "1" : "0");

  return Array.from(cookiesMap.entries())
    .map(([name, value]) => `${name}=${encodeURIComponent(value)}`)
    .join("; ");
}

function nextWithUpdatedRequestCookies(
  request: NextRequest,
  params: { accessToken: string; refreshToken: string; autoLogin: boolean }
): NextResponse {
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("cookie", buildRequestCookieHeader(request, params));
  return NextResponse.next({
    request: {
      headers: requestHeaders,
    },
  });
}

function setSessionCookies(
  response: NextResponse,
  params: { accessToken: string; refreshToken: string; role: string; autoLogin: boolean }
): void {
  const baseCookieOptions = {
    httpOnly: true,
    secure: isProductionLike,
    sameSite: "lax" as const,
    path: "/",
  };

  if (params.autoLogin) {
    response.cookies.set("auth_token", params.accessToken, {
      ...baseCookieOptions,
      maxAge: ACCESS_TOKEN_MAX_AGE_SECONDS,
    });
    response.cookies.set("refresh_token", params.refreshToken, {
      ...baseCookieOptions,
      maxAge: getRefreshSessionMaxAgeSeconds(params.role),
    });
    response.cookies.set("auto_login", "1", {
      ...baseCookieOptions,
      maxAge: 30 * 24 * 60 * 60,
    });
    return;
  }

  response.cookies.set("auth_token", params.accessToken, baseCookieOptions);
  response.cookies.set("refresh_token", params.refreshToken, baseCookieOptions);
  response.cookies.set("auto_login", "0", baseCookieOptions);
}

async function tryRefreshAuthSession(refreshToken: string): Promise<RefreshAttempt> {
  try {
    const refreshResponse = await fetch(`${API_URL}/auth/refresh-token`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ refreshToken }),
      cache: "no-store",
    });

    if (!refreshResponse.ok) {
      if (refreshResponse.status === 401) {
        const error = await refreshResponse.json().catch(() => null) as {
          code?: string;
        } | null;
        if (error?.code === "AUTH_REFRESH_REPLAY_CONCURRENT") {
          return { kind: "concurrent" };
        }
      }
      return null;
    }

    const data = await refreshResponse.json() as RefreshResponse;
    if (!data.accessToken || isTokenExpired(data.accessToken)) {
      return null;
    }

    return {
      kind: "success",
      accessToken: data.accessToken,
      refreshToken: data.refreshToken || refreshToken,
      role: decodeRole(data.accessToken),
    };
  } catch {
    return null;
  }
}

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
  "/_next",
  "/favicon.ico",
  "/manifest.json",
  "/sw.js",
  "/service-record",
  // The PDF preview loads this as a Web Worker. A redirect here would not just
  // break the preview: this middleware clears the auth cookies on its way to
  // /login, so one worker fetch landing in an expired-token window would log
  // the user out mid-session. It is an unmodified pdf.js build — nothing to gate.
  "/pdf.worker.min.mjs",
  "/pdfjs-iframe-test.html",
];

const PUBLIC_API_ROUTES = [
  "/api/auth/check-email",
  "/api/auth/forgot-password",
  "/api/auth/kakao",
  "/api/auth/login",
  "/api/auth/refresh",
  "/api/auth/register",
  "/api/auth/resend-verification",
  "/api/auth/reset-password",
  "/api/auth/token",
  "/api/auth/verify-email",
  "/api/health",
  "/api/service-record",
];

// Routes that require auth but NOT branch selection
const AUTH_ONLY_ROUTES = [
  "/select-branch",
];
const LOGIN_ROUTE = "/login";

function isRouteMatch(pathname: string, route: string): boolean {
  return pathname === route || pathname.startsWith(`${route}/`);
}

function isApiRoute(pathname: string): boolean {
  return pathname === "/api" || pathname.startsWith("/api/");
}

function apiJsonResponse(error: string, status: number): NextResponse {
  return NextResponse.json({ error }, { status });
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Legacy alias: SMS links issued before the service-record rename pointed at
  // /feedback/:token (and /api/feedback). Redirect outstanding (unexpired) links to
  // the new public URL so providers who already received them still reach the wizard.
  if (pathname === "/api/feedback" || pathname.startsWith("/api/feedback/")) {
    const url = request.nextUrl.clone();
    url.pathname = pathname.replace("/api/feedback", "/api/service-record");
    return NextResponse.redirect(url);
  }
  if (pathname === "/feedback" || pathname.startsWith("/feedback/")) {
    const url = request.nextUrl.clone();
    url.pathname = pathname.replace("/feedback", "/service-record");
    return NextResponse.redirect(url);
  }

  if (PUBLIC_API_ROUTES.some((route) => isRouteMatch(pathname, route))) {
    return NextResponse.next();
  }

  // Prevent authenticated users from seeing the login screen.
  let authToken = request.cookies.get("auth_token")?.value;
  if (
    isRouteMatch(pathname, LOGIN_ROUTE)
    && authToken
    && !isTokenExpired(authToken)
  ) {
    return NextResponse.redirect(new URL("/", request.url));
  }
  if (
    isRouteMatch(pathname, LOGIN_ROUTE)
    && authToken
    && isTokenExpired(authToken)
  ) {
    const loginRefreshToken = request.cookies.get("refresh_token")?.value;
    if (loginRefreshToken) {
      const refreshAttempt = await tryRefreshAuthSession(loginRefreshToken);
      if (refreshAttempt?.kind === "success") {
        const response = NextResponse.redirect(new URL("/", request.url));
        setSessionCookies(response, {
          accessToken: refreshAttempt.accessToken,
          refreshToken: refreshAttempt.refreshToken,
          role: refreshAttempt.role,
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

  // Skip public routes
  if (PUBLIC_ROUTES.some((route) => isRouteMatch(pathname, route))) {
    return NextResponse.next();
  }

  // Get auth token
  const refreshToken = request.cookies.get("refresh_token")?.value;
  const autoLogin = isAutoLoginEnabled(request.cookies.get("auto_login")?.value);
  let refreshedSession: {
    accessToken: string;
    refreshToken: string;
    role: string;
  } | null = null;

  const needsRefresh = !authToken || isTokenExpired(authToken);

  if (needsRefresh && refreshToken) {
    const refreshAttempt = await tryRefreshAuthSession(refreshToken);
    if (refreshAttempt?.kind === "concurrent") {
      const response = isApiRoute(pathname)
        ? apiJsonResponse("Authentication refresh already in progress", 409)
        : NextResponse.redirect(request.nextUrl);
      response.headers.set("Retry-After", "1");
      return response;
    }
    if (refreshAttempt?.kind === "success") {
      refreshedSession = refreshAttempt;
      authToken = refreshAttempt.accessToken;
      if (request.method === "GET" || request.method === "HEAD") {
        const response = NextResponse.redirect(request.nextUrl);
        setSessionCookies(response, {
          accessToken: refreshAttempt.accessToken,
          refreshToken: refreshAttempt.refreshToken,
          role: refreshAttempt.role,
          autoLogin,
        });
        return response;
      }

    }
  }

  // No auth token - redirect to login
  if (!authToken || isTokenExpired(authToken)) {
    if (isApiRoute(pathname)) {
      return apiJsonResponse("Authentication required", 401);
    }

    const loginUrl = new URL("/login", request.url);
    const response = NextResponse.redirect(loginUrl);
    clearAuthCookies(response);
    return response;
  }

  // Check if route only requires auth (not branch)
  if (AUTH_ONLY_ROUTES.some((route) => pathname.startsWith(route))) {
    const response = refreshedSession
      ? nextWithUpdatedRequestCookies(request, {
        accessToken: refreshedSession.accessToken,
        refreshToken: refreshedSession.refreshToken,
        autoLogin,
      })
      : NextResponse.next();
    if (refreshedSession) {
      setSessionCookies(response, {
        accessToken: refreshedSession.accessToken,
        refreshToken: refreshedSession.refreshToken,
        role: refreshedSession.role,
        autoLogin,
      });
    }
    return response;
  }

  // For all other routes, check if a branch has been selected by the branch-selection action.
  if (!request.cookies.get("selected_branch_id")?.value) {
    if (isApiRoute(pathname)) {
      return apiJsonResponse("Branch selection required", 403);
    }

    const selectBranchUrl = new URL("/select-branch", request.url);
    const response = NextResponse.redirect(selectBranchUrl);
    if (refreshedSession) {
      setSessionCookies(response, {
        accessToken: refreshedSession.accessToken,
        refreshToken: refreshedSession.refreshToken,
        role: refreshedSession.role,
        autoLogin,
      });
    }
    return response;
  }

  const response = refreshedSession
    ? nextWithUpdatedRequestCookies(request, {
      accessToken: refreshedSession.accessToken,
      refreshToken: refreshedSession.refreshToken,
      autoLogin,
    })
    : NextResponse.next();
  if (refreshedSession) {
    setSessionCookies(response, {
      accessToken: refreshedSession.accessToken,
      refreshToken: refreshedSession.refreshToken,
      role: refreshedSession.role,
      autoLogin,
    });
  }
  return response;
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
    "/((?!monitoring|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
