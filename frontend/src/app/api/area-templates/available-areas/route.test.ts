/**
 * @jest-environment node
 */
import { NextRequest } from "next/server";

import { serverAPIClient } from "@/lib/api/server";

import { GET } from "./route";

jest.mock("@/lib/api/server", () => ({
  serverAPIClient: {
    get: jest.fn(),
  },
}));

const mockGet = serverAPIClient.get as jest.Mock;

describe("GET /api/area-templates/available-areas", () => {
  beforeEach(() => {
    mockGet.mockReset();
  });

  it("requires authentication", async () => {
    const response = await GET(
      new NextRequest("http://localhost/api/area-templates/available-areas"),
    );

    expect(response.status).toBe(401);
    expect(mockGet).not.toHaveBeenCalled();
  });

  it("proxies the tenant-scoped area list with the auth token", async () => {
    mockGet.mockResolvedValue({
      data: [{ id: "Yeonsugu", name: "Yeonsu-gu", koreanName: "연수구" }],
    });
    const request = new NextRequest(
      "http://localhost/api/area-templates/available-areas",
      { headers: { cookie: "auth_token=auth-token" } },
    );

    const response = await GET(request);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual([
      { id: "Yeonsugu", name: "Yeonsu-gu", koreanName: "연수구" },
    ]);
    expect(mockGet).toHaveBeenCalledWith(
      "/area-templates/available-areas",
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: "Bearer auth-token" }),
      }),
    );
  });
});
