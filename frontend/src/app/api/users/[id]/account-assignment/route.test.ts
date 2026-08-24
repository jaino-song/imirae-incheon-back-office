/**
 * @jest-environment node
 */
import { NextRequest } from "next/server";
import { AxiosError, AxiosHeaders } from "axios";

import { serverAPIClient } from "@/lib/api/server";
import { PATCH } from "./route";

jest.mock("@/lib/api/server", () => ({
  serverAPIClient: {
    patch: jest.fn(),
  },
}));

const mockPatch = serverAPIClient.patch as jest.Mock;

function createRequest(body: object, authenticated = true): NextRequest {
  return new NextRequest(
    "http://localhost/api/users/approved-admin/account-assignment",
    {
      method: "PATCH",
      headers: {
        ...(authenticated ? { cookie: "auth_token=access-token" } : {}),
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    },
  );
}

describe("PATCH /api/users/[id]/account-assignment", () => {
  beforeEach(() => {
    mockPatch.mockReset();
  });

  it("forwards the authenticated account-assignment update", async () => {
    const input = {
      role: "admin",
      branchIds: ["branch-admin-owned", "branch-songdo"],
      expectedRole: "admin",
      expectedBranchIds: ["branch-admin-owned"],
    };
    mockPatch.mockResolvedValue({ data: { id: "approved-admin" }, status: 200 });

    const response = await PATCH(createRequest(input), {
      params: Promise.resolve({ id: "approved-admin" }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ id: "approved-admin" });
    expect(mockPatch).toHaveBeenCalledWith(
      "/users/approved-admin/account-assignment",
      input,
      { headers: { Authorization: "Bearer access-token" } },
    );
  });

  it("rejects an unauthenticated request without contacting the backend", async () => {
    const response = await PATCH(createRequest({ role: "admin", branchIds: [] }, false), {
      params: Promise.resolve({ id: "approved-admin" }),
    });

    expect(response.status).toBe(401);
    expect(mockPatch).not.toHaveBeenCalled();
  });

  it("encodes the dynamic account id before forwarding it upstream", async () => {
    mockPatch.mockResolvedValue({ data: { id: "account id/with?reserved" }, status: 200 });

    const response = await PATCH(createRequest({ role: "user" }), {
      params: Promise.resolve({ id: "account id/with?reserved" }),
    });

    expect(response.status).toBe(200);
    expect(mockPatch).toHaveBeenCalledWith(
      "/users/account%20id%2Fwith%3Freserved/account-assignment",
      { role: "user" },
      { headers: { Authorization: "Bearer access-token" } },
    );
  });

  it("preserves an upstream optimistic-snapshot conflict", async () => {
    const consoleError = jest.spyOn(console, "error").mockImplementation(() => undefined);
    mockPatch.mockRejectedValue(
      new AxiosError("Conflict", "ERR_BAD_RESPONSE", undefined, undefined, {
        status: 409,
        statusText: "Conflict",
        headers: {},
        config: { headers: new AxiosHeaders() },
        data: {
          message: "다른 곳에서 계정 정보가 변경되었습니다.",
          code: "ACCOUNT_ASSIGNMENT_CONFLICT",
        },
      }),
    );

    const response = await PATCH(createRequest({ role: "user" }), {
      params: Promise.resolve({ id: "approved-admin" }),
    });
    consoleError.mockRestore();

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: "다른 곳에서 계정 정보가 변경되었습니다.",
    });
  });
});
