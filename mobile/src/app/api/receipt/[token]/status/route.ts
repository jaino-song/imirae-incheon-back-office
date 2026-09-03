import { NextRequest } from "next/server";
import { serverAPIClient } from "@/lib/api/server";
import { backendJsonResponse, errorResponse, withNoStore } from "@/lib/api/route-utils";
import { forwardedForHeaders, receiptBackendClientErrorResponse } from "@/lib/api/receipt-auth";

// Public, unauthenticated: is the receipt link still usable? Never returns the
// client name (the backend's own status projection already omits it).
export async function GET(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
    const { token } = await params;
    try {
        const response = await serverAPIClient.get(`/receipt-links/${encodeURIComponent(token)}/status`, {
            headers: forwardedForHeaders(request),
        });
        return withNoStore(backendJsonResponse(response));
    } catch (error) {
        return receiptBackendClientErrorResponse(error) ?? errorResponse(error, "receipt link status");
    }
}
