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

        const response = await serverAPIClient.post("/eformsign-docs/finalize-headless", body, {
            headers: { Authorization: `Bearer ${token}` },
            // Same ordering as dispatch-headless: 60s sat *below* the backend's
            // own worst case, so a slow-but-still-working finalize was cut off
            // here and surfaced as an unclassifiable proxy error.
            timeout: 170_000,
        });

        return NextResponse.json(response.data);
    } catch (error) {
        return errorResponse(error, "headless eformsign finalize");
    }
}
