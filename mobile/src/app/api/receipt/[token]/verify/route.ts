import { NextRequest, NextResponse } from "next/server";
import { serverAPIClient } from "@/lib/api/server";
import { errorResponse, withNoStore } from "@/lib/api/route-utils";
import { forwardedForHeaders, receiptBackendClientErrorResponse, setReceiptAccessCookie } from "@/lib/api/receipt-auth";

function readVerified(data: unknown): { accessToken: string; clientName: string } | null {
    if (!data || typeof data !== "object") return null;
    const record = data as { ok?: unknown; accessToken?: unknown; clientName?: unknown };
    if (record.ok !== true || typeof record.accessToken !== "string") return null;
    return {
        accessToken: record.accessToken,
        clientName: typeof record.clientName === "string" ? record.clientName : "산모",
    };
}

// Public, unauthenticated: birthday challenge. The [token] path segment IS the
// receipt link token. On success, mints an HttpOnly access-token cookie and
// returns only { ok, clientName } to the browser — the access token itself
// never leaves the server.
export async function POST(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
    const { token } = await params;
    try {
        const body = await request.json().catch(() => ({}));
        const response = await serverAPIClient.post(
            `/receipt-links/${encodeURIComponent(token)}/verify`,
            { birthday: typeof body?.birthday === "string" ? body.birthday : "" },
            { headers: forwardedForHeaders(request) },
        );
        const verified = readVerified(response.data);
        if (verified) {
            const verifiedResponse = withNoStore(
                NextResponse.json({ ok: true, clientName: verified.clientName }, { status: 200 }),
            );
            setReceiptAccessCookie(verifiedResponse, token, verified.accessToken);
            return verifiedResponse;
        }
        // The backend's 2xx verify response only ever has the { ok: true, accessToken,
        // clientName } shape (any rejection is a thrown 4xx, handled in the catch below).
        // A 200 that doesn't match it is an unexpected upstream contract break — passing
        // it through as-is would let the page's `response.ok` check treat the mother as
        // verified without ever minting the access cookie, so surface it as an error
        // instead of forwarding it.
        return errorResponse(new Error("unexpected verify payload"), "verify receipt birthday");
    } catch (error) {
        return receiptBackendClientErrorResponse(error) ?? errorResponse(error, "verify receipt birthday");
    }
}
