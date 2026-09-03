/**
 * @jest-environment node
 */
import { AxiosError, AxiosHeaders } from "axios";
import { NextRequest } from "next/server";

import { serverAPIClient } from "@/lib/api/server";

import { POST } from "./route";

jest.mock("@/lib/api/server", () => ({
  serverAPIClient: {
    post: jest.fn(),
  },
}));

const mockPost = serverAPIClient.post as jest.Mock;

function createRequest(body: unknown = { documentId: "doc-1" }, authenticated = true) {
  return new NextRequest("http://localhost/api/receipt-links/send", {
    method: "POST",
    headers: authenticated ? { cookie: "auth_token=token-1" } : {},
    body: JSON.stringify(body),
  });
}

function createRawRequest(rawBody: string, authenticated = true) {
  return new NextRequest("http://localhost/api/receipt-links/send", {
    method: "POST",
    headers: authenticated ? { cookie: "auth_token=token-1" } : {},
    body: rawBody,
  });
}

describe("POST /api/receipt-links/send", () => {
  beforeEach(() => {
    mockPost.mockReset();
  });

  it("forwards the authenticated send request and returns the queued job", async () => {
    mockPost.mockResolvedValue({
      status: 200,
      data: { jobId: "job-1", scheduledFor: "2026-09-03T00:00:00.000Z", clientName: "김산모" },
    });

    const response = await POST(createRequest());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      jobId: "job-1",
      scheduledFor: "2026-09-03T00:00:00.000Z",
      clientName: "김산모",
    });
    expect(mockPost).toHaveBeenCalledWith(
      "/receipt-links/send",
      { documentId: "doc-1" },
      { headers: { Authorization: "Bearer token-1" } },
    );
  });

  it("requires authentication before forwarding", async () => {
    const response = await POST(createRequest({ documentId: "doc-1" }, false));

    expect(response.status).toBe(401);
    expect(mockPost).not.toHaveBeenCalled();
  });

  it("rejects an empty body with a 400 and never calls the backend", async () => {
    const response = await POST(createRequest({}));

    expect(response.status).toBe(400);
    expect(mockPost).not.toHaveBeenCalled();
    expect(await response.json()).toEqual({
      reason: "invalid_request",
      message: "계약서 정보가 올바르지 않습니다.",
    });
  });

  it("rejects a blank documentId with a 400 and never calls the backend", async () => {
    const response = await POST(createRequest({ documentId: "" }));

    expect(response.status).toBe(400);
    expect(mockPost).not.toHaveBeenCalled();
    expect(await response.json()).toEqual({
      reason: "invalid_request",
      message: "계약서 정보가 올바르지 않습니다.",
    });
  });

  it("rejects malformed JSON with a 400 and never calls the backend", async () => {
    const response = await POST(createRawRequest("{not-valid-json"));

    expect(response.status).toBe(400);
    expect(mockPost).not.toHaveBeenCalled();
  });

  it("passes a 400 { reason, message } body through untouched", async () => {
    mockPost.mockRejectedValue(
      new AxiosError("Bad Request", "ERR_BAD_REQUEST", undefined, undefined, {
        status: 400,
        statusText: "Bad Request",
        headers: {},
        config: { headers: new AxiosHeaders() },
        data: { reason: "missing_phone", message: "산모 연락처가 없거나 형식이 올바르지 않습니다" },
      }),
    );

    const response = await POST(createRequest());

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      reason: "missing_phone",
      message: "산모 연락처가 없거나 형식이 올바르지 않습니다",
    });
  });

  it("passes a 404 { reason: document_not_found } body through untouched", async () => {
    mockPost.mockRejectedValue(
      new AxiosError("Not Found", "ERR_BAD_REQUEST", undefined, undefined, {
        status: 404,
        statusText: "Not Found",
        headers: {},
        config: { headers: new AxiosHeaders() },
        data: { reason: "document_not_found" },
      }),
    );

    const response = await POST(createRequest());

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ reason: "document_not_found" });
  });

  it("passes a 403 sender-approval body through untouched", async () => {
    mockPost.mockRejectedValue(
      new AxiosError("Forbidden", "ERR_BAD_REQUEST", undefined, undefined, {
        status: 403,
        statusText: "Forbidden",
        headers: {},
        config: { headers: new AxiosHeaders() },
        data: { message: "메시지 발송 권한 승인이 필요합니다." },
      }),
    );

    const response = await POST(createRequest());

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ message: "메시지 발송 권한 승인이 필요합니다." });
  });

  it("does not leak internal upstream fields (message, code) for a 500 boundary error", async () => {
    // The upstream body carries a Prisma-stack-like `message` — the exact shape
    // errorResponse()'s legacy-message mode would surface verbatim (minus token/email
    // scrubbing). The 5xx path must never call errorResponse(); it must log via
    // logUpstreamError() and always respond with the fixed generic message, matching
    // the mobile twin (mobile/src/app/api/receipt-links/send/route.ts).
    mockPost.mockRejectedValue(
      new AxiosError("Request failed with status code 500", "ERR_BAD_RESPONSE", undefined, undefined, {
        status: 500,
        statusText: "Internal Server Error",
        headers: {},
        config: { headers: new AxiosHeaders() },
        data: {
          message:
            "PrismaClientKnownRequestError: Invalid `prisma.document.findUnique()` invocation at /srv/app/dist/services/document.js:142:19 — Can't reach database server at `db-primary.internal:5432`",
          internalCode: "DB_TIMEOUT",
        },
      }),
    );

    const response = await POST(createRequest());
    const payload = await response.json();

    expect(response.status).toBe(500);
    expect(payload).toEqual({ error: "Failed to send receipt link" });
    const serialized = JSON.stringify(payload);
    expect(serialized).not.toContain("DB_TIMEOUT");
    expect(serialized).not.toContain("db-primary.internal");
    expect(serialized).not.toContain("/srv/app/dist");
  });

  it("does not leak an HTML upstream body for a 502, normalized to a fixed 500", async () => {
    mockPost.mockRejectedValue(
      new AxiosError("Request failed with status code 502", "ERR_BAD_RESPONSE", undefined, undefined, {
        status: 502,
        statusText: "Bad Gateway",
        headers: {},
        config: { headers: new AxiosHeaders() },
        data: "<html><body>upstream proxy diagnostics — internal only</body></html>",
      }),
    );

    const response = await POST(createRequest());
    const payload = await response.json();

    expect(response.status).toBe(500);
    expect(payload).toEqual({ error: "Failed to send receipt link" });
    const serialized = JSON.stringify(payload);
    expect(serialized).not.toContain("<html>");
    expect(serialized).not.toContain("internal only");
  });

  it("falls back to the fixed 500 message for a non-Axios failure (never leaks error.message)", async () => {
    mockPost.mockRejectedValue(new Error("connect ECONNREFUSED db-primary.internal:5432"));

    const response = await POST(createRequest());

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "Failed to send receipt link" });
  });

  it("falls back to the fixed 500 message when request.text() itself rejects (never leaks error.message) (M5)", async () => {
    // invalidJsonResponse() only handles malformed-JSON bodies (InvalidJsonBodyError) —
    // a genuine transport/stream failure from request.text() is a different error type,
    // for which invalidJsonResponse() returns null. Before the fix, that fell through to
    // errorResponse() (bound in legacy-message mode for this route), which would surface
    // error.message verbatim into the response body.
    const request = createRequest();
    jest.spyOn(request, "text").mockRejectedValue(new Error("stream reset by db-primary.internal:5432"));

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(500);
    expect(payload).toEqual({ error: "Failed to send receipt link" });
    expect(mockPost).not.toHaveBeenCalled();
    expect(JSON.stringify(payload)).not.toContain("db-primary.internal");
  });
});
