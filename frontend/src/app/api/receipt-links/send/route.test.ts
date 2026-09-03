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

  it("falls back to a 500 error response for a non-4xx failure", async () => {
    mockPost.mockRejectedValue(new Error("network down"));

    const response = await POST(createRequest());

    expect(response.status).toBe(500);
  });
});
