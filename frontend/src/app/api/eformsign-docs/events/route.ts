import { NextRequest } from "next/server";

import { proxySseStream } from "@/lib/api/sse-proxy";
import { getAuthToken } from "@/lib/api/route-utils";
import { createServerApiUrl } from "@/lib/api/server-base-url";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// The stream closes itself at 50s; this remains the final platform safety net.
export const maxDuration = 60;

export async function GET(request: NextRequest) {
    const token = getAuthToken(request);
    if (!token) {
        return new Response("Unauthorized", { status: 401 });
    }

    const upstreamUrl = createServerApiUrl("/eformsign-docs/events");

    return proxySseStream({
        upstreamUrl,
        requestSignal: request.signal,
        headers: {
            Authorization: `Bearer ${token}`,
            Accept: "text/event-stream",
        },
    });
}
