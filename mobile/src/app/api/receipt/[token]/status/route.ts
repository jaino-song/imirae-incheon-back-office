import { NextRequest, NextResponse } from "next/server";
import { serverAPIClient } from "@/lib/api/server";
import { errorResponse, withNoStore } from "@/lib/api/route-utils";
import { receiptBackendClientErrorResponse } from "@/lib/api/receipt-auth";

type StatusPayload = {
    // No default fabricated here (M1) — undefined is passed through as-is if the backend
    // omits the field, rather than papering over a missing/false value with `true`.
    ok: boolean | undefined;
    state: unknown;
    branchName: unknown;
    expiresAt: unknown;
    remainingAttempts: unknown;
    lockedUntil: unknown;
};

// Public, unauthenticated: is the receipt link still usable? Explicitly project
// only the fields the public page needs — never forward the backend body as-is,
// so an unrelated client name/phone field added upstream can't leak here.
export async function GET(_request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
    const { token } = await params;
    try {
        const response = await serverAPIClient.get(`/receipt-links/${encodeURIComponent(token)}/status`);
        const status = response.status ?? 200;
        // A 204 (no content) response has no body — NextResponse.json() throws if handed
        // one alongside a 204 status, so it must short-circuit before the projection below.
        if (status === 204) {
            return withNoStore(new NextResponse(null, { status }));
        }
        const data = (response.data ?? {}) as Partial<StatusPayload>;
        const projected: StatusPayload = {
            ok: data.ok,
            state: data.state,
            branchName: data.branchName,
            expiresAt: data.expiresAt,
            remainingAttempts: data.remainingAttempts,
            lockedUntil: data.lockedUntil ?? null,
        };
        return withNoStore(NextResponse.json(projected, { status }));
    } catch (error) {
        return receiptBackendClientErrorResponse(error) ?? errorResponse(error, "receipt link status");
    }
}
