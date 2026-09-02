import { NextRequest, NextResponse } from "next/server";
import { serverAPIClient } from "@/lib/api/server";
import { errorResponse, getAuthHeaders, getAuthToken } from "@/lib/api/route-utils";

export async function POST(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> },
) {
    try {
        const token = getAuthToken(request);
        if (!token) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const { id } = await params;
        const response = await serverAPIClient.post(`/call-ingest-tokens/${id}/revoke`, {}, {
            headers: getAuthHeaders(token),
        });
        return NextResponse.json(response.data, { status: response.status });
    } catch (error) {
        return errorResponse(error, "revoke call ingest token");
    }
}
