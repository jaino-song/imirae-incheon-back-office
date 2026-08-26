import { NextRequest, NextResponse } from "next/server";

import { serverAPIClient } from "@/lib/api/server";
import {
    backendJsonResponse,
    errorResponse,
    getAuthHeaders,
    getAuthToken,
    unauthorizedResponse,
} from "@/lib/api/route-utils";

interface RouteContext {
    params: Promise<{ id: string }>;
}

function isPositiveSafeInteger(value: string, max?: number) {
    if (!/^[1-9]\d*$/.test(value)) return false;

    const parsed = Number(value);
    return Number.isSafeInteger(parsed) && (max === undefined || parsed <= max);
}

export async function GET(request: NextRequest, context: RouteContext) {
    const token = getAuthToken(request);
    if (!token) {
        return unauthorizedResponse("Unauthorized");
    }

    const { id } = await context.params;
    if (!isPositiveSafeInteger(id)) {
        return NextResponse.json({ error: "Invalid employee id" }, { status: 400 });
    }

    const page = request.nextUrl.searchParams.get("page") ?? "1";
    const limit = request.nextUrl.searchParams.get("limit") ?? "20";
    if (!isPositiveSafeInteger(page) || !isPositiveSafeInteger(limit, 100)) {
        return NextResponse.json({ error: "Invalid pagination" }, { status: 400 });
    }

    try {
        const response = await serverAPIClient.get(`/employees/${id}/work-history`, {
            params: { page, limit },
            headers: getAuthHeaders(token),
        });
        return backendJsonResponse(response);
    } catch (error) {
        return errorResponse(error, "fetch employee work history");
    }
}
