"use server";

import { cookies } from "next/headers";
import { serverAPIClient } from "@/lib/api/server";

export async function logout(pushEndpoint?: string): Promise<{ success: boolean; error?: string }> {
  let serverLogoutError: string | undefined;

  try {
    const cookieStore = await cookies();
    const token = cookieStore.get("auth_token")?.value;
    const refreshToken = cookieStore.get("refresh_token")?.value;

    // Call backend to clear server-side cookies
    if (token || refreshToken) {
      try {
        await serverAPIClient.post("/auth/logout", {
          refreshToken,
          ...(pushEndpoint ? { pushEndpoint } : {}),
        }, {
          headers: token ? { Authorization: `Bearer ${token}` } : undefined,
        });
      } catch {
        // Local cookies are still cleared below, but report the server failure
        // so callers do not claim that the session was fully revoked.
        serverLogoutError = "서버 로그아웃에 실패했습니다. 다시 시도해 주세요.";
      }
    }

    // Clear all auth-related cookies
    cookieStore.delete("auth_token");
    cookieStore.delete("refresh_token");
    cookieStore.delete("auto_login");
    cookieStore.delete("selected_branch_id");

    return serverLogoutError
      ? { success: false, error: serverLogoutError }
      : { success: true };
  } catch (error) {
    console.error("[Logout] Error:", error);
    return { success: false, error: "로그아웃 중 오류가 발생했습니다." };
  }
}
