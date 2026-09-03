import { isAxiosError } from "axios";
import { NextRequest, NextResponse } from "next/server";
import { serverAPIClient } from "@/lib/api/server";
import {
  errorResponse,
  getAuthHeaders,
  getAuthToken,
  invalidJsonResponse,
  readJsonObjectBody,
  unauthorizedResponse,
} from "@/lib/api/route-utils";

export async function POST(request: NextRequest) {
  const token = getAuthToken(request);
  if (!token) {
    return unauthorizedResponse("Authentication required. Please log in.");
  }

  let body: Record<string, unknown>;
  try {
    body = await readJsonObjectBody(request);
  } catch (error) {
    return invalidJsonResponse(error) ?? errorResponse(error, "send receipt link");
  }

  const documentId = body.documentId;
  if (typeof documentId !== "string" || !documentId.trim()) {
    return NextResponse.json(
      { reason: "invalid_request", message: "계약서 정보가 올바르지 않습니다." },
      { status: 400 },
    );
  }

  try {
    const response = await serverAPIClient.post(
      "/receipt-links/send",
      { documentId },
      { headers: getAuthHeaders(token) },
    );
    return NextResponse.json(response.data, { status: response.status });
  } catch (error) {
    // serverAPIClient's validateStatus rejects any 4xx as an AxiosError (see
    // frontend/src/lib/api/server.ts) — pass its { reason, message } body through
    // untouched so the UI can map `reason` to a message. errorResponse() would
    // otherwise rewrite the body to { error } and drop `reason`.
    if (isAxiosError(error)) {
      const status = error.response?.status;
      if (status && status >= 400 && status < 500) {
        return NextResponse.json(error.response?.data ?? { reason: "unknown" }, { status });
      }
    }
    return errorResponse(error, "send receipt link");
  }
}
