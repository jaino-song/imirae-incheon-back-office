import { NextRequest, NextResponse } from "next/server";
import { serverAPIClient } from "@/lib/api/server";
import { errorResponse, withNoStore } from "@/lib/api/route-utils";
import { getReceiptAccessToken, receiptBackendClientErrorResponse } from "@/lib/api/receipt-auth";

interface AxiosLikeResponse {
    status?: number;
    data?: unknown;
}

// Decodes an AxiosError's response.data before handing it to
// receiptBackendClientErrorResponse. The backend call below uses
// responseType: "arraybuffer" for the 2xx (PNG) path, so axios also buffers a 4xx error
// body as a Buffer instead of parsing it as JSON — forwarding that raw Buffer would
// serialize to { type: "Buffer", data: [...] } instead of the backend's real
// { reason, ... } body.
function decodeBufferedAxiosError(error: unknown): unknown {
    const response = (error as { response?: AxiosLikeResponse } | null | undefined)?.response;
    if (!response || !Buffer.isBuffer(response.data)) return error;
    let data: unknown;
    try {
        data = JSON.parse(response.data.toString("utf8"));
    } catch {
        data = { reason: "access_required" };
    }
    return { response: { status: response.status, data } };
}

// Public after the birthday challenge: streams the receipt PNG, authenticated
// by the HttpOnly access-token cookie (or an explicit Authorization header).
export async function GET(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
    const { token } = await params;
    const accessToken = getReceiptAccessToken(request);
    if (!accessToken) {
        return withNoStore(NextResponse.json({ reason: "access_required" }, { status: 401 }));
    }

    const download = request.nextUrl.searchParams.get("download") === "1" ? "1" : "0";
    try {
        const response = await serverAPIClient.get(`/receipt-links/${encodeURIComponent(token)}/image`, {
            params: { download },
            responseType: "arraybuffer",
            headers: { "X-Receipt-Access-Token": accessToken },
        });
        const headers = new Headers({
            "Content-Type": "image/png",
            "Cache-Control": "private, no-store",
            "X-Content-Type-Options": "nosniff",
        });
        const disposition = response.headers?.["content-disposition"];
        if (disposition) headers.set("Content-Disposition", String(disposition));
        return new NextResponse(Buffer.from(response.data as ArrayBuffer), { status: 200, headers });
    } catch (error) {
        return receiptBackendClientErrorResponse(decodeBufferedAxiosError(error)) ?? errorResponse(error, "receipt image");
    }
}
