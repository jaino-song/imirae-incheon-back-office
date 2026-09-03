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

  it("does not leak internal upstream fields (stack, code) for a 500 boundary error", async () => {
    // No `error`/`message` string on the upstream body, so errorResponse()'s legacy
    // formatter has nothing upstream-sourced to surface and falls back to its own
    // generic "Failed to <context>" text — the only shape a 5xx not caught by the
    // 4xx pass-through branch should ever produce.
    mockPost.mockRejectedValue(
      new AxiosError("Request failed with status code 500", "ERR_BAD_RESPONSE", undefined, undefined, {
        status: 500,
        statusText: "Internal Server Error",
        headers: {},
        config: { headers: new AxiosHeaders() },
        data: { stack: "at Foo.bar (/srv/app/internal.ts:42:9)", internalCode: "DB_TIMEOUT" },
      }),
    );

    const response = await POST(createRequest());
    const payload = await response.json();

    expect(response.status).toBe(500);
    expect(payload).toEqual({ error: "Request failed with status code 500" });
    const serialized = JSON.stringify(payload);
    expect(serialized).not.toContain("DB_TIMEOUT");
    expect(serialized).not.toContain("internal.ts");
  });

  it("does not leak an HTML upstream body for a 502", async () => {
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

    expect(response.status).toBe(502);
    expect(payload).toEqual({ error: "Request failed with status code 502" });
    const serialized = JSON.stringify(payload);
    expect(serialized).not.toContain("<html>");
    expect(serialized).not.toContain("internal only");
  });

  it("falls back to a 500 with the error's own message for a non-Axios failure", async () => {
    mockPost.mockRejectedValue(new Error("network down"));

    const response = await POST(createRequest());

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "network down" });
  });
});
