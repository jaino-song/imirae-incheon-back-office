import { cookies } from "next/headers";
import { NextRequest } from "next/server";
import { BACKEND_BASE_URL } from "@/lib/api/server";

const BACKEND_URL = BACKEND_BASE_URL;

function json(data: unknown, status: number): Response {
    return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ path: string[] }> }): Promise<Response> {
    return forward(request, await params, undefined);
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ path: string[] }> }): Promise<Response> {
    return forward(request, await params, await request.text());
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ path: string[] }> }): Promise<Response> {
    return forward(request, await params, await request.text());
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ path: string[] }> }): Promise<Response> {
    return forward(request, await params, undefined);
}

async function forward(request: NextRequest, params: { path: string[] }, body: string | undefined): Promise<Response> {
    const token = (await cookies()).get("auth_token");
    if (!token) return json({ error: "Unauthorized" }, 401);
    const path = params.path.map((segment) => encodeURIComponent(segment)).join("/");
    const backendPath = path === "capabilities"
        ? "/ai/capabilities"
        : path.startsWith("actions/")
            ? `/ai/${path}`
            : `/ai/agent/${path}`;
    try {
        const upstream = await fetch(`${BACKEND_URL}${backendPath}${new URL(request.url).search}`, {
            method: request.method,
            headers: { Authorization: `Bearer ${token.value}`, ...(body !== undefined ? { "Content-Type": "application/json" } : {}) },
            body,
            signal: request.signal,
        });
        return new Response(upstream.body, {
            status: upstream.status,
            headers: {
                "Content-Type": upstream.headers.get("content-type") ?? (path.endsWith("chat") ? "text/event-stream" : "application/json"),
                ...(upstream.headers.get("x-agent-session-id") ? { "x-agent-session-id": upstream.headers.get("x-agent-session-id")! } : {}),
                ...(upstream.headers.get("x-vercel-ai-ui-message-stream") ? { "x-vercel-ai-ui-message-stream": upstream.headers.get("x-vercel-ai-ui-message-stream")! } : {}),
                "Cache-Control": path.endsWith("chat") ? "no-cache" : "no-store",
            },
        });
    } catch {
        return json({ error: "Upstream unavailable" }, 502);
    }
}
