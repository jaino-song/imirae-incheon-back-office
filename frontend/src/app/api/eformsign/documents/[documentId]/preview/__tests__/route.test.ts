/**
 * @jest-environment node
 */
import { NextRequest } from "next/server";

import { serverAPIClient } from "@/lib/api/server";
import { GET, HEAD } from "../route";

jest.mock("@/lib/api/server", () => ({
  serverAPIClient: {
    get: jest.fn(),
  },
}));

const mockServerGet = serverAPIClient.get as jest.Mock;
const context = { params: Promise.resolve({ documentId: "doc-1" }) };

function createRequest(method: "GET" | "HEAD"): NextRequest {
  return new NextRequest(
    "http://localhost/api/eformsign/documents/doc-1/preview",
    {
      method,
      headers: {
        cookie: "auth_token=auth-token",
      },
    },
  );
}

describe("eformsign document preview route", () => {
  beforeEach(() => {
    mockServerGet.mockReset();
  });

  it("returns PDF bytes for GET", async () => {
    const pdf = new Uint8Array([1, 2, 3]);
    mockServerGet.mockResolvedValue({
      status: 200,
      headers: { "content-type": "application/pdf" },
      data: pdf,
    });

    const response = await GET(createRequest("GET"), context);

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Length")).toBe("3");
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(pdf);
  });

  it("returns only PDF metadata for HEAD", async () => {
    mockServerGet.mockResolvedValue({
      status: 200,
      headers: { "content-type": "application/pdf" },
      data: new Uint8Array([1, 2, 3]),
    });

    const response = await HEAD(createRequest("HEAD"), context);

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("application/pdf");
    expect(response.headers.get("Content-Length")).toBe("3");
    expect((await response.arrayBuffer()).byteLength).toBe(0);
    expect(mockServerGet).toHaveBeenCalledWith(
      "/api/documents/doc-1/download_files",
      expect.objectContaining({
        params: { fileType: "document" },
        responseType: "arraybuffer",
      }),
    );
  });

  it("does not contact the backend for an unauthenticated HEAD request", async () => {
    const request = new NextRequest(
      "http://localhost/api/eformsign/documents/doc-1/preview",
      { method: "HEAD" },
    );

    const response = await HEAD(request, context);

    expect(response.status).toBe(401);
    expect((await response.arrayBuffer()).byteLength).toBe(0);
    expect(mockServerGet).not.toHaveBeenCalled();
  });

  it("preserves a backend access denial for HEAD without returning its body", async () => {
    mockServerGet.mockRejectedValue(
      Object.assign(new Error("forbidden"), {
        response: {
          status: 403,
          headers: { "content-type": "application/json" },
          data: { error: "sensitive backend detail" },
        },
      }),
    );

    const response = await HEAD(createRequest("HEAD"), context);

    expect(response.status).toBe(403);
    expect(response.headers.get("Content-Type")).toBe("application/json");
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect((await response.arrayBuffer()).byteLength).toBe(0);
  });

  it("preserves retry metadata for a pending local PDF without forwarding cookies", async () => {
    mockServerGet.mockRejectedValue(
      Object.assign(new Error("not ready"), {
        response: {
          status: 503,
          headers: {
            "content-type": "application/json",
            "retry-after": "30",
            "set-cookie": "backend-session=secret",
          },
          data: { error: "waiting for local synchronization" },
        },
      }),
    );

    const response = await HEAD(createRequest("HEAD"), context);

    expect(response.status).toBe(503);
    expect(response.headers.get("Retry-After")).toBe("30");
    expect(response.headers.get("Set-Cookie")).toBeNull();
    expect((await response.arrayBuffer()).byteLength).toBe(0);
  });

  it("returns a bodyless bad-gateway response for a HEAD transport failure", async () => {
    mockServerGet.mockRejectedValue(new Error("connection refused"));

    const response = await HEAD(createRequest("HEAD"), context);

    expect(response.status).toBe(502);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect((await response.arrayBuffer()).byteLength).toBe(0);
  });
});
