import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { getServerRuntimeConfig } from "@/lib/env";
import { withNoStore } from "@/lib/api/route-utils";

export const RECEIPT_ACCESS_COOKIE = "receipt_access";
// Mirrors the backend's RECEIPT_LINK_TTL_MS design constant (30 days). The
// verify response does not carry the link's expiresAt, so this is a fixed
// upper bound rather than a computed "remaining time" value — the access
// token itself is re-validated server-side on every request regardless of
// how long the browser holds the cookie.
const RECEIPT_COOKIE_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

function receiptApiPath(linkToken: string): string {
    return `/api/receipt/${encodeURIComponent(linkToken)}`;
}

/** Raw access token only (no "Bearer " prefix) — the backend expects it verbatim
 *  in the X-Receipt-Access-Token header. */
export function getReceiptAccessToken(request: NextRequest): string {
    const authorization = request.headers.get("authorization");
    if (authorization) return authorization.replace(/^Bearer\s+/i, "").trim();
    return request.cookies.get(RECEIPT_ACCESS_COOKIE)?.value ?? "";
}

export function setReceiptAccessCookie(response: NextResponse, linkToken: string, accessToken: string): void {
    response.cookies.set(RECEIPT_ACCESS_COOKIE, accessToken, {
        httpOnly: true,
        maxAge: RECEIPT_COOKIE_MAX_AGE_SECONDS,
        path: receiptApiPath(linkToken),
        sameSite: "lax",
        secure: getServerRuntimeConfig().isProductionNodeEnv,
    });
}

interface AxiosLikeError {
    response?: {
        status?: number;
        data?: unknown;
    };
}

/**
 * serverAPIClient's validateStatus rejects every 4xx (mobile/src/lib/api/server.ts),
 * so the receipt-links backend THROWS on every 4xx response rather than resolving. The
 * shared errorResponse() helper rewrites the body to { error }, which would drop the
 * `reason` / `remainingAttempts` / `lockedUntil` fields the public page needs to pick the
 * right screen. Forward the backend's public 4xx body verbatim instead. Duck-types the
 * error's `.response` shape (matching the shared errorResponse()'s own approach two lines
 * below it in route-utils.ts) rather than checking `instanceof AxiosError`, so a caller
 * that has already unwrapped/reshaped an AxiosError (e.g. the image route decoding a
 * Buffer body first) can still hand this a plain `{ response: { status, data } }` object.
 * Returns null for anything without a `.response` (5xx, network errors, non-Axios throws)
 * so the caller falls back to errorResponse().
 */
export function receiptBackendClientErrorResponse(error: unknown): NextResponse | null {
    const response = (error as AxiosLikeError | null | undefined)?.response;
    const status = response?.status;
    if (typeof status !== "number" || status < 400 || status >= 500) return null;

    const record = (response?.data ?? null) as Record<string, unknown> | null;
    const hasReason = record !== null && typeof record === "object" && "reason" in record;
    // A 400 without `reason` can only come from the global validation pipe (an
    // empty/malformed/unknown body) — normalize it to invalid_format so the page
    // always has a reason-shaped body to render (resolution #6).
    const body = status === 400 && !hasReason ? { reason: "invalid_format" } : (record ?? { reason: "unknown" });
    return withNoStore(NextResponse.json(body, { status }));
}
