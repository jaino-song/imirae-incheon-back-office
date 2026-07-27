/**
 * @jest-environment node
 */
import { NextRequest } from "next/server";

import { serverAPIClient } from "@/lib/api/server";

import { GET } from "../route";

jest.mock("@/lib/api/server", () => ({
  serverAPIClient: {
    get: jest.fn(),
  },
}));

const mockServerGet = serverAPIClient.get as jest.Mock;

function createRequest(authenticated = true): NextRequest {
  return new NextRequest("http://localhost/api/eformsign-docs/feedback-template-id", {
    headers: authenticated ? { cookie: "auth_token=auth-token" } : undefined,
  });
}

describe("GET /api/eformsign-docs/feedback-template-id", () => {
  beforeEach(() => {
    mockServerGet.mockReset();
  });

  it("returns the configured service-record template id", async () => {
    mockServerGet.mockResolvedValue({
      status: 200,
      data: { templateId: "service-record-template" },
    });

    const response = await GET(createRequest());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ templateId: "service-record-template" });
    expect(mockServerGet).toHaveBeenCalledWith(
      "/eformsign-docs/feedback-template-id",
      { headers: { Authorization: "Bearer auth-token" } },
    );
  });

  it("rejects unauthenticated requests without calling the backend", async () => {
    const response = await GET(createRequest(false));

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "Unauthorized" });
    expect(mockServerGet).not.toHaveBeenCalled();
  });
});
