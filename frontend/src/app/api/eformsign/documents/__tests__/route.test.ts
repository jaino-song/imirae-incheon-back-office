/**
 * @jest-environment node
 */
import { NextRequest } from "next/server";

import { serverAPIClient } from "@/lib/api/server";

import { DELETE, GET } from "../route";

jest.mock("@/lib/api/server", () => ({
  serverAPIClient: {
    delete: jest.fn(),
    get: jest.fn(),
  },
}));

const mockDelete = serverAPIClient.delete as jest.Mock;
const mockGet = serverAPIClient.get as jest.Mock;
const EFORMSIGN_COOKIE = "eformsign_access_token=eformsign-access-token";
let authCookie: string;
let testCounter = 0;

function createRequest(
  url: string,
  init?: { method?: string; body?: string; headers?: HeadersInit; authCookie?: string },
): NextRequest {
  const headers = new Headers(init?.headers);
  headers.set("cookie", `${init?.authCookie ?? authCookie}; ${EFORMSIGN_COOKIE}`);

  return new NextRequest(url, {
    method: init?.method,
    body: init?.body,
    headers,
  });
}

describe("eformsign documents API route", () => {
  let consoleError: jest.SpyInstance;

  beforeEach(() => {
    consoleError = jest.spyOn(console, "error").mockImplementation(() => undefined);
    mockDelete.mockReset();
    mockGet.mockReset();
    testCounter += 1;
    authCookie = `auth_token=permanent-purge-cache-test-${testCounter}`;
  });

  afterEach(() => {
    consoleError.mockRestore();
  });

  it("does not serve another viewer's cached PII after a failed permanent delete", async () => {
    const deletingViewer = "auth_token=deleting-viewer";
    const otherViewer = "auth_token=other-viewer";
    const staleDocument = {
      id: "purge-pending-document",
      customer_name: "고객 이름",
      creator: { name: "작성자 이름" },
    };
    mockGet
      .mockResolvedValueOnce({ status: 200, data: { documents: [staleDocument] } })
      .mockResolvedValueOnce({ status: 200, data: { documents: [staleDocument] } })
      .mockResolvedValueOnce({ status: 200, data: { documents: [] } });

    await GET(createRequest("http://localhost/api/eformsign/documents", {
      authCookie: deletingViewer,
    }));
    await GET(createRequest("http://localhost/api/eformsign/documents", {
      authCookie: otherViewer,
    }));

    mockDelete.mockResolvedValue({
      status: 500,
      data: { error: "local purge failed" },
    });
    const deleteResponse = await DELETE(createRequest(
      "http://localhost/api/eformsign/documents?is_permanent=true",
      {
        method: "DELETE",
        authCookie: deletingViewer,
        body: JSON.stringify({ document_ids: ["purge-pending-document"] }),
      },
    ));
    expect(deleteResponse.status).toBe(500);

    const otherViewerResponse = await GET(createRequest(
      "http://localhost/api/eformsign/documents",
      { authCookie: otherViewer },
    ));

    expect(mockGet).toHaveBeenCalledTimes(3);
    await expect(otherViewerResponse.json()).resolves.toEqual({ documents: [] });
  });
});
