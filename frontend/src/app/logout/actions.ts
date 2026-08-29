"use server";

import { cookies } from "next/headers";
import { serverAPIClient } from "@/lib/api/server";
import { clearAuthSessionCookies } from "@/lib/auth/session-cookies";

export async function logout(pushEndpoint?: string): Promise<{ success: boolean; error?: string }> {
  let serverLogoutError: string | undefined;

  try {
    const cookieStore = await cookies();
    const token = cookieStore.get("auth_token")?.value;
    const refreshToken = cookieStore.get("refresh_token")?.value;

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

    clearAuthSessionCookies(cookieStore);
    cookieStore.delete("selected_branch_id");
    cookieStore.delete("selected_organization_id");

    return serverLogoutError
      ? { success: false, error: serverLogoutError }
      : { success: true };
  } catch (error) {
    console.error("[Logout] Error:", error);
    return { success: false, error: "로그아웃 중 오류가 발생했습니다." };
  }
}
