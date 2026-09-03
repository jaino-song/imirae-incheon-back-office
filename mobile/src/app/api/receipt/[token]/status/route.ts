import { NextRequest, NextResponse } from "next/server";
import { serverAPIClient } from "@/lib/api/server";
import { errorResponse, withNoStore } from "@/lib/api/route-utils";
import { receiptBackendClientErrorResponse } from "@/lib/api/receipt-auth";

type StatusPayload = {
    ok: boolean;
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
        const data = (response.data ?? {}) as Partial<StatusPayload>;
        const projected: StatusPayload = {
            ok: data.ok ?? true,
            state: data.state,
            branchName: data.branchName,
            expiresAt: data.expiresAt,
            remainingAttempts: data.remainingAttempts,
            lockedUntil: data.lockedUntil ?? null,
        };
        return withNoStore(NextResponse.json(projected, { status: response.status ?? 200 }));
    } catch (error) {
        return receiptBackendClientErrorResponse(error) ?? errorResponse(error, "receipt link status");
    }
}
