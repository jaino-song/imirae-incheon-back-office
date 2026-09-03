import { AxiosError } from "axios";
import { NextRequest, NextResponse } from "next/server";
import { serverAPIClient } from "@/lib/api/server";
import { errorResponse, getAuthHeaders, getAuthToken, unauthorizedResponse } from "@/lib/api/route-utils";

export async function POST(request: NextRequest) {
  try {
    const token = getAuthToken(request);
    if (!token) {
      return unauthorizedResponse("Authentication required. Please log in.");
    }
    const body = await request.json();
    const response = await serverAPIClient.post(
      "/receipt-links/send",
      { documentId: body?.documentId },
      { headers: getAuthHeaders(token) },
    );
    return NextResponse.json(response.data, { status: response.status });
  } catch (error) {
    // serverAPIClient's validateStatus rejects any 4xx as an AxiosError (see
    // frontend/src/lib/api/server.ts) — pass its { reason, message } body through
    // untouched so the UI can map `reason` to a message. errorResponse() would
    // otherwise rewrite the body to { error } and drop `reason`.
    if (error instanceof AxiosError) {
      const status = error.response?.status;
      if (status && status >= 400 && status < 500) {
        return NextResponse.json(error.response?.data ?? { reason: "unknown" }, { status });
      }
    }
    return errorResponse(error, "send receipt link");
  }
}
