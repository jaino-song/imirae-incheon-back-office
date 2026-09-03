/**
 * @jest-environment node
 */
import { NextRequest } from "next/server";
import { serverAPIClient } from "@/lib/api/server";
import { POST } from "../receipt-links/send/route";

jest.mock("@/lib/api/server", () => ({ serverAPIClient: { post: jest.fn() } }));
const mockPost = serverAPIClient.post as jest.Mock;

function request(body: unknown, cookie = "auth_token=auth-token") {
  return new NextRequest("http://localhost/api/receipt-links/send", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json", cookie },
  });
}

describe("POST /api/receipt-links/send", () => {
  beforeEach(() => mockPost.mockReset());

  it("401s without an auth cookie and 400s without a documentId", async () => {
    expect((await POST(request({ documentId: "d" }, ""))).status).toBe(401);
    expect((await POST(request({}))).status).toBe(400);
    expect(mockPost).not.toHaveBeenCalled();
  });

  it("forwards the send and returns the backend body", async () => {
    mockPost.mockResolvedValue({
      status: 200,
      data: { jobId: "job-1", scheduledFor: "2026-09-03T00:00:00.000Z", clientName: "김산모" },
    });
    const response = await POST(request({ documentId: "doc-1" }));
    expect(mockPost).toHaveBeenCalledWith(
      "/receipt-links/send",
      { documentId: "doc-1" },
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: "Bearer auth-token" }) }),
    );
    expect(response.status).toBe(200);
    expect((await response.json()).clientName).toBe("김산모");
  });

  it("passes 4xx reason bodies through", async () => {
    mockPost.mockRejectedValue({ response: { status: 400, data: { reason: "not_voucher_client", message: "바우처 이용 산모가 아닙니다" } } });
    const response = await POST(request({ documentId: "doc-1" }));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ reason: "not_voucher_client", message: "바우처 이용 산모가 아닙니다" });
  });

  it("passes a 404 document_not_found body through", async () => {
    mockPost.mockRejectedValue({ response: { status: 404, data: { reason: "document_not_found" } } });
    const response = await POST(request({ documentId: "doc-1" }));
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ reason: "document_not_found" });
  });

  it("returns 500 for a transport error with no response", async () => {
    mockPost.mockRejectedValue(new Error("network down"));
    const response = await POST(request({ documentId: "doc-1" }));
    expect(response.status).toBe(500);
  });
});
