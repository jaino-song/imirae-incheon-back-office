/**
 * @jest-environment node
 */
import { cookies } from "next/headers";

import { serverAPIClient } from "@/lib/api/server";

import { getUserBranches } from "./actions";

jest.mock("next/headers", () => ({ cookies: jest.fn() }));
jest.mock("@/lib/api/server", () => ({
  serverAPIClient: {
    get: jest.fn(),
    post: jest.fn(),
  },
}));

const mockCookies = jest.mocked(cookies);
const mockGet = jest.mocked(serverAPIClient.get);

describe("mobile getUserBranches", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("returns the most recently selected branch first", async () => {
    mockCookies.mockResolvedValue({
      get: jest.fn((name: string) => {
        if (name === "auth_token") return { value: "auth-token" };
        if (name === "selected_branch_id") return { value: "branch-c" };
        return undefined;
      }),
    } as never);
    mockGet.mockResolvedValue({
      data: {
        branches: [
          { id: "branch-a", name: "가 지점" },
          { id: "branch-b", name: "나 지점" },
          { id: "branch-c", name: "다 지점" },
        ],
      },
    });

    await expect(getUserBranches()).resolves.toEqual({
      success: true,
      branches: [
        { id: "branch-c", name: "다 지점" },
        { id: "branch-a", name: "가 지점" },
        { id: "branch-b", name: "나 지점" },
      ],
    });
    expect(mockGet).toHaveBeenCalledWith("/auth/branches", {
      headers: { Authorization: "Bearer auth-token" },
    });
  });
});
