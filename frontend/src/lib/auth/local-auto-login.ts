import type { NextRequest } from "next/server";
import { resolveServerApiUrl } from "@/lib/api/server-base-url";

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

// Credentials stay in the server environment; this module is only used by proxy.ts.
export async function tryLocalAutoLogin(request: NextRequest): Promise<{
  accessToken: string;
  refreshToken: string;
} | null> {
  if (
    process.env.NODE_ENV !== "development" ||
    process.env.VERCEL || process.env.VERCEL_ENV ||
    process.env.RAILWAY_ENVIRONMENT_ID || process.env.RAILWAY_ENVIRONMENT_NAME ||
    request.method !== "GET" ||
    request.headers.get("sec-fetch-site") === "cross-site" ||
    request.cookies.has("auth_token") || request.cookies.has("refresh_token")
  ) return null;

  const email = process.env.LOCAL_AUTO_LOGIN_EMAIL;
  const password = process.env.LOCAL_AUTO_LOGIN_PASSWORD;
  if (!email || !password) return null;

  try {
    const frontend = new URL(request.url);
    const backend = new URL(resolveServerApiUrl() ?? "");
    const host = request.headers.get("host");
    const incoming = new URL(`http://${host ?? ""}`);
    if (
      frontend.protocol !== "http:" || backend.protocol !== "http:" ||
      !LOOPBACK_HOSTS.has(frontend.hostname) || !LOOPBACK_HOSTS.has(backend.hostname) ||
      !LOOPBACK_HOSTS.has(incoming.hostname) || incoming.port !== frontend.port ||
      incoming.host !== host ||
      backend.username || backend.password
    ) return null;
    const origin = request.headers.get("origin");
    const forwardedHost = request.headers.get("x-forwarded-host");
    if ((origin && origin !== incoming.origin) ||
        (forwardedHost && forwardedHost !== incoming.host)) return null;

    const response = await fetch(new URL("/auth/login", backend), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) return null;
    const session = await response.json() as {
      success?: boolean;
      accessToken?: string;
      refreshToken?: string;
    };
    if (session.success !== true || typeof session.accessToken !== "string" ||
        !session.accessToken || typeof session.refreshToken !== "string" ||
        !session.refreshToken) return null;
    return { accessToken: session.accessToken, refreshToken: session.refreshToken };
  } catch {
    // Do not log fetch errors: they can contain the credential-bearing request.
    return null;
  }
}
