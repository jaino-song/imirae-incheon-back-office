import { cookies } from "next/headers";
import { NextRequest } from "next/server";

import { upstreamSseErrorResponse } from "@/lib/api/route-utils";

const isProduction = process.env.NODE_ENV === "production" || process.env.VERCEL_ENV === "preview";
const BACKEND_URL = isProduction
    ? process.env.NEXT_PUBLIC_API_BASE_URL
    : process.env.DEVELOPMENT_API_BASE_URL;

export async function POST(request: NextRequest) {
    const cookieStore = await cookies();
    const authToken = cookieStore.get("auth_token");

    if (!authToken) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
            status: 401,
            headers: { "Content-Type": "application/json" },
        });
    }

    const body = await request.json();

    const backendResponse = await fetch(`${BACKEND_URL}/ai/chat/stream`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${authToken.value}`,
        },
        body: JSON.stringify(body),
    });

    if (!backendResponse.ok) {
        await backendResponse.text().catch(() => "");
        console.error("[chat] upstream stream request failed:", {
            status: backendResponse.status,
        });
        return upstreamSseErrorResponse(backendResponse.status);
    }

    return new Response(backendResponse.body, {
        headers: {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            Connection: "keep-alive",
        },
    });
}
