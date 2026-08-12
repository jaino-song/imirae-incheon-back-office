import { NextRequest, NextResponse } from "next/server";

import { serverAPIClient } from "@/lib/api/server";
import {
    backendJsonResponse,
    errorResponse,
    getAuthHeaders,
    getAuthToken,
    unauthorizedResponse,
    withNoStore,
} from "@/lib/api/route-utils";

type RouteParams = { params: Promise<{ id: string }> };

function isValidJobId(value: string): boolean {
    return /^[A-Za-z0-9_-]{1,128}$/.test(value);
}

export async function POST(request: NextRequest, { params }: RouteParams) {
    try {
        const token = getAuthToken(request);
        if (!token) return unauthorizedResponse("Unauthorized");

        const { id } = await params;
        if (!isValidJobId(id)) {
            return NextResponse.json({ error: "Invalid message trigger job id" }, { status: 400 });
        }

        const response = await serverAPIClient.post(
            `/message-trigger-jobs/${encodeURIComponent(id)}/cancel`,
            {},
            { headers: getAuthHeaders(token) },
        );
        return withNoStore(backendJsonResponse(response));
    } catch (error) {
        return errorResponse(error, "cancel message trigger job");
    }
}
