import { NextRequest, NextResponse } from "next/server";
import { serverAPIClient } from "@/lib/api/server";
import { errorResponse, getAuthHeaders, getAuthToken } from "@/lib/api/route-utils";

interface RouteContext {
    params: Promise<{ branchId: string }>;
}

export async function GET(request: NextRequest, context: RouteContext) {
    try {
        const token = getAuthToken(request);
        if (!token) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const { branchId } = await context.params;
        const response = await serverAPIClient.get(`/branches/${branchId}/call-ingest-tokens`, {
            headers: getAuthHeaders(token),
        });
        return NextResponse.json(response.data);
    } catch (error) {
        return errorResponse(error, "list call ingest tokens");
    }
}

export async function POST(request: NextRequest, context: RouteContext) {
    try {
        const token = getAuthToken(request);
        if (!token) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const { branchId } = await context.params;
        const body: unknown = await request.json();
        const response = await serverAPIClient.post(`/branches/${branchId}/call-ingest-tokens`, body, {
            headers: getAuthHeaders(token),
        });
        return NextResponse.json(response.data, { status: response.status });
    } catch (error) {
        return errorResponse(error, "create call ingest token");
    }
}
