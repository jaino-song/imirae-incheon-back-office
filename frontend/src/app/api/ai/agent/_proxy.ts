import { cookies } from "next/headers";
import { NextRequest } from "next/server";

const isProduction = process.env.NODE_ENV === "production" || process.env.VERCEL_ENV === "preview";

function getBackendUrl(): string {
    return (isProduction ? process.env.NEXT_PUBLIC_API_BASE_URL : process.env.DEVELOPMENT_API_BASE_URL || process.env.NEXT_PUBLIC_API_BASE_URL) ?? "";
}

export async function proxyAgentRequest(request: NextRequest, path: string, method = request.method, body?: unknown) {
    const token = (await cookies()).get("auth_token")?.value;
    if (!token) return Response.json({ error: "Unauthorized" }, { status: 401 });
    const backendUrl = getBackendUrl();
    if (!backendUrl) return Response.json({ error: "Agent backend is not configured" }, { status: 503 });
    const response = await fetch(`${backendUrl}${path}`, {
        method,
        headers: { Authorization: `Bearer ${token}`, ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: request.signal,
    });
    const headers = new Headers();
    for (const name of ["content-type", "cache-control", "x-accel-buffering", "x-vercel-ai-ui-message-stream"]) {
        const value = response.headers.get(name);
        if (value) headers.set(name, value);
    }
    const sessionId = response.headers.get("x-agent-session-id");
    if (sessionId) headers.set("x-agent-session-id", sessionId);
    return new Response(response.body, { status: response.status, headers });
}
