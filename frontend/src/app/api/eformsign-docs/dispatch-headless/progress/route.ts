import { NextRequest } from "next/server";

import { proxySseStream } from "@/lib/api/sse-proxy";
import { getAuthToken } from "@/lib/api/route-utils";
import { createServerApiUrl } from "@/lib/api/server-base-url";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(request: NextRequest) {
    const token = getAuthToken(request);
    if (!token) {
        return new Response("Unauthorized", { status: 401 });
    }

    const progressId = request.nextUrl.searchParams.get("progressId");
    if (!progressId) {
        return new Response("progressId is required", { status: 400 });
    }

    const upstreamUrl = createServerApiUrl(
        `/eformsign-docs/dispatch-headless/progress?progressId=${encodeURIComponent(progressId)}`,
    );

    return proxySseStream({
        upstreamUrl,
        requestSignal: request.signal,
        headers: {
            Authorization: `Bearer ${token}`,
            Accept: "text/event-stream",
        },
    });
}
