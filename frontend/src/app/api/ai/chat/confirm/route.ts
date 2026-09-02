import { cookies } from "next/headers";
import { NextRequest } from "next/server";
import { z } from "zod";

import { parseBody, upstreamJsonErrorResponse } from "@/lib/api/route-utils";

const isProduction = process.env.NODE_ENV === "production" || process.env.VERCEL_ENV === "preview";
const BACKEND_URL = isProduction
    ? process.env.NEXT_PUBLIC_API_BASE_URL
    : process.env.DEVELOPMENT_API_BASE_URL;

const chatConfirmSchema = z
    .object({
        intentId: z.string().min(1),
        nonce: z.string().min(1),
        sessionId: z.string().min(1).nullable().optional(),
    })
    .strict();

export async function POST(request: NextRequest) {
    const cookieStore = await cookies();
    const authToken = cookieStore.get("auth_token");

    if (!authToken) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
            status: 401,
            headers: { "Content-Type": "application/json" },
        });
    }

    const { data, response } = await parseBody(chatConfirmSchema, request);
    if (response) return response;

    try {
        const backendResponse = await fetch(`${BACKEND_URL}/ai/chat/confirm`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${authToken.value}`,
            },
            body: JSON.stringify(data),
        });

        if (!backendResponse.ok) {
            await backendResponse.text().catch(() => "");
            return upstreamJsonErrorResponse(backendResponse.status);
        }

        const responseBody = await backendResponse.text();
        return new Response(responseBody || "{}", {
            status: backendResponse.status,
            headers: { "Content-Type": "application/json" },
        });
    } catch {
        return upstreamJsonErrorResponse(502);
    }
}
