import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { serverAPIClient } from "@/lib/api/server";
import { getAuthHeaders, getAuthToken, getUpstreamErrorStatus, logUpstreamError, parseBody } from "@/lib/api/route-utils";

const sendReceiptLinkSchema = z.object({ documentId: z.string().min(1) });

export async function POST(request: NextRequest) {
  const token = getAuthToken(request);
  if (!token) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { data, response: invalidBody } = await parseBody(sendReceiptLinkSchema, request);
  if (invalidBody) {
    return invalidBody;
  }
  try {
    const response = await serverAPIClient.post("/receipt-links/send", data, { headers: getAuthHeaders(token) });
    return NextResponse.json(response.data, { status: response.status });
  } catch (error) {
    // serverAPIClient's validateStatus rejects on 4xx (see mobile/src/lib/api/server.ts), so the
    // backend's { reason, message } preflight body arrives here, not in the try block above.
    // Forward it verbatim on 4xx so the UI can map `reason` to copy — the shared errorResponse()
    // helper would sanitize it away.
    const upstream = (error as { response?: { status?: number; data?: unknown } })?.response;
    if (upstream && upstream.status && upstream.status >= 400 && upstream.status < 500) {
      return NextResponse.json(upstream.data ?? { error: "Failed to send receipt link" }, {
        status: getUpstreamErrorStatus(error),
      });
    }
    // Only log unexpected failures (no upstream response, or a 5xx) — expected business
    // rejections (not_voucher_client, missing_birthday, etc.) are routine and forwarded above.
    logUpstreamError("API send receipt link", error);
    return NextResponse.json({ error: "Failed to send receipt link" }, { status: 500 });
  }
}
