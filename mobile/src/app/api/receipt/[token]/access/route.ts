import { NextRequest, NextResponse } from "next/server";

import { getReceiptAccessToken, receiptBackendClientErrorResponse } from "@/lib/api/receipt-auth";
import { serverAPIClient } from "@/lib/api/server";
import { errorResponse, withNoStore } from "@/lib/api/route-utils";

function readAccess(data: unknown): { ok: true; clientName: string } | null {
    if (!data || typeof data !== "object") return null;
    const record = data as { ok?: unknown; clientName?: unknown };
    if (record.ok !== true || typeof record.clientName !== "string") return null;
    return { ok: true, clientName: record.clientName };
}

// Authenticated metadata-only probe used when a browser resumes a previously
// verified session. The access token remains in the HttpOnly cookie and the PNG
// is left for the browser's <img> request to download exactly once.
export async function GET(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
    const { token } = await params;
    const accessToken = getReceiptAccessToken(request);
    if (!accessToken) {
        return withNoStore(NextResponse.json({ reason: "access_required" }, { status: 401 }));
    }

    try {
        const response = await serverAPIClient.get(`/receipt-links/${encodeURIComponent(token)}/access`, {
            headers: { "X-Receipt-Access-Token": accessToken },
        });
        const access = readAccess(response.data);
        if (!access) return errorResponse(new Error("unexpected access payload"), "probe receipt access");
        return withNoStore(NextResponse.json(access, { status: 200 }));
    } catch (error) {
        return receiptBackendClientErrorResponse(error) ?? errorResponse(error, "probe receipt access");
    }
}
