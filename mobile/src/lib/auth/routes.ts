// Auth routes live under the `(auth)` route group, so the folder name is hidden from the URL.
// Keep all "public auth pages" in one place to avoid scattering hard-coded paths.

export const AUTH_ROUTES = {
  login: "/login",
  register: "/register",
  forgotPassword: "/forgot-password",
  resetPassword: "/reset-password",
  verifyEmail: "/verify-email",
  callback: "/callback",
} as const;

export const PUBLIC_AUTH_PATHS = new Set<string>(Object.values(AUTH_ROUTES));

export function isAuthPath(pathname: string | null | undefined): boolean {
  if (!pathname) return false;
  const normalized = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  return PUBLIC_AUTH_PATHS.has(normalized);
}

export function isPublicAuthPath(pathname: string | null | undefined): boolean {
  if (!pathname) return false;
  // Normalize trailing slash
  const normalized = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  // No-login 제공기록지 capture (BJJ-247): the dynamic /service-record/[token] route is a public,
  // shell-free page opened from an SMS link with no auth cookie. Treating it as a public path
  // keeps the authenticated app shell and the 401 → /login redirect (lib/api/client.ts) from
  // hijacking it — same "skip auth shell / no login redirect" treatment the auth pages get.
  if (normalized === "/service-record" || normalized.startsWith("/service-record/")) return true;
  return PUBLIC_AUTH_PATHS.has(normalized);
}
