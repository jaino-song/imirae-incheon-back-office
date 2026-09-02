import { cookies } from "next/headers";

import { serverAPIClient } from "@/lib/api/server";
import { logout } from "./actions";

jest.mock("next/headers", () => ({
  cookies: jest.fn(),
}));

jest.mock("@/lib/api/server", () => ({
  serverAPIClient: {
    post: jest.fn(),
  },
}));

const mockedCookies = jest.mocked(cookies);
const mockedPost = jest.mocked(serverAPIClient.post);

describe("mobile logout server action", () => {
  const cookieStore = {
    get: jest.fn(),
    delete: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockedCookies.mockResolvedValue(cookieStore as never);
    cookieStore.get.mockImplementation((name: string) => {
      if (name === "auth_token") return { value: "access-token" };
      if (name === "refresh_token") return { value: "refresh-token" };
      return undefined;
    });
    mockedPost.mockResolvedValue({ status: 200, data: { success: true } } as never);
  });

  it("passes the browser endpoint to server logout and clears local cookies", async () => {
    await expect(logout("https://push.example/device-a")).resolves.toEqual({ success: true });

    expect(mockedPost).toHaveBeenCalledWith(
      "/auth/logout",
      { refreshToken: "refresh-token", pushEndpoint: "https://push.example/device-a" },
      { headers: { Authorization: "Bearer access-token" } },
    );
    expect(cookieStore.delete).toHaveBeenCalledWith("auth_token");
    expect(cookieStore.delete).toHaveBeenCalledWith("refresh_token");
    expect(cookieStore.delete).toHaveBeenCalledWith("auto_login");
    expect(cookieStore.delete).toHaveBeenCalledWith("selected_branch_id");
  });

  it("reports server revocation failure without retaining local session cookies", async () => {
    mockedPost.mockRejectedValueOnce(new Error("backend unavailable"));

    await expect(logout()).resolves.toMatchObject({
      success: false,
      error: expect.stringContaining("서버 로그아웃"),
    });
    expect(cookieStore.delete).toHaveBeenCalledWith("auth_token");
    expect(cookieStore.delete).toHaveBeenCalledWith("refresh_token");
    expect(cookieStore.delete).toHaveBeenCalledWith("selected_branch_id");
  });
});
