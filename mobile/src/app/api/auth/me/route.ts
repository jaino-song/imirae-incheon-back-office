import { NextRequest, NextResponse } from "next/server";
import { serverAPIClient } from "@/lib/api/server";
import { E2E_ROLE_COOKIE, getE2EAuthUser, isE2ETest } from "@/lib/e2e";
import { getUpstreamErrorStatus, logUpstreamError, sanitizeUpstreamClientError } from "@/lib/api/route-utils";

function getAuthToken(request: NextRequest): string | null {
    return request.cookies.get("auth_token")?.value || null;
}

export async function GET(request: NextRequest) {
    try {
        if (isE2ETest()) {
            return NextResponse.json(getE2EAuthUser(request.cookies.get(E2E_ROLE_COOKIE)?.value));
        }

        const token = getAuthToken(request);
        if (!token) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const response = await serverAPIClient.get("/auth/me", {
            headers: { Authorization: `Bearer ${token}` },
        });
        
        return NextResponse.json(response.data);
    } catch (error: unknown) {
        const upstreamData = error && typeof error === "object" && "response" in error
            ? (error as { response?: { data?: unknown } }).response?.data
            : undefined;
        const status = getUpstreamErrorStatus(error);

        logUpstreamError("fetch user", error);
        return NextResponse.json(
            sanitizeUpstreamClientError(upstreamData, "Failed to fetch user"),
            { status }
        );
    }
}
