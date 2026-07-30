import { NextRequest, NextResponse } from "next/server";
import { serverAPIClient } from "@/lib/api/server";
import { errorResponse } from "@/lib/api/route-utils";

function getAuthToken(request: NextRequest): string | null {
    return request.cookies.get("auth_token")?.value || null;
}

export async function POST(request: NextRequest) {
    try {
        const token = getAuthToken(request);
        if (!token) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const body = await request.json();
        if (!Number.isInteger(body?.clientId) || body.clientId < 1) {
            return NextResponse.json({ error: "clientId is required" }, { status: 400 });
        }

        const response = await serverAPIClient.post("/eformsign-docs/dispatch-headless", body, {
            headers: { Authorization: `Bearer ${token}` },
            // Must sit between the backend's own budget (iframe boot 30s + gates
            // 100s + SDK callback 30s ≈ 160s worst case) and the browser's 180s,
            // so a slow run still resolves into a real backend verdict.
            timeout: 170_000,
        });

        return NextResponse.json(response.data);
    } catch (error) {
        return errorResponse(error, "headless eformsign dispatch");
    }
}
