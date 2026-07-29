"use server";

import { cookies } from "next/headers";
import { AxiosError } from "axios";

import { serverAPIClient } from "@/lib/api/server";
import { getServerRuntimeConfig } from "@/lib/env";
import {
  ACCESS_TOKEN_MAX_AGE_SECONDS,
  decodeAccessRole,
  getRefreshSessionMaxAgeSeconds,
} from "@/lib/auth/session-policy";

import { prioritizeRecentBranch } from "./branch-order";

interface Branch {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  role: string;
}

interface APIErrorResponse {
  statusCode: number;
  message: string;
  error: string;
}

function getAuthHeaders(token: string | null): Record<string, string> {
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export async function getUserBranches(): Promise<{
  success: boolean;
  branches?: Branch[];
  error?: string;
}> {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get("auth_token")?.value || null;
    const recentBranchId = cookieStore.get("selected_branch_id")?.value;

    const { data } = await serverAPIClient.get("/auth/branches", {
      headers: getAuthHeaders(token),
    });

    return {
      success: true,
      branches: prioritizeRecentBranch(data.branches ?? [], recentBranchId),
    };
  } catch (error) {
    console.error("[Server Action] Error fetching branches:", error);

    if (error instanceof AxiosError) {
      const axiosError = error as AxiosError<APIErrorResponse>;
      return {
        success: false,
        error: axiosError.response?.data?.message || "지점 목록을 불러오는데 실패했습니다.",
      };
    }

    return {
      success: false,
      error: "지점 목록을 불러오는데 실패했습니다.",
    };
  }
}

export async function setCurrentBranch(branchId: string): Promise<{
  success: boolean;
  error?: string;
}> {
  try {
    const cookieStore = await cookies();
    const isSecureCookie = getServerRuntimeConfig().isSecureCookieEnv;
    const token = cookieStore.get("auth_token")?.value || null;
    const autoLoginCookie = cookieStore.get("auto_login")?.value;
    const autoLogin = autoLoginCookie !== "0" && autoLoginCookie !== "false";

    const { data } = await serverAPIClient.post("/auth/select-branch", {
      branchId,
    }, {
      headers: getAuthHeaders(token),
    });
    const role = decodeAccessRole(data.accessToken);

    // Update auth token with new branch context
    const authCookieBaseOptions = {
      httpOnly: true,
      secure: isSecureCookie,
      sameSite: "lax",
      path: "/",
    } as const;
    const refreshCookieBaseOptions = {
      httpOnly: true,
      secure: isSecureCookie,
      sameSite: "lax",
      path: "/",
    } as const;

    if (autoLogin) {
      cookieStore.set("auth_token", data.accessToken, {
        ...authCookieBaseOptions,
        maxAge: ACCESS_TOKEN_MAX_AGE_SECONDS,
      });
      if (data.refreshToken) {
        cookieStore.set("refresh_token", data.refreshToken, {
          ...refreshCookieBaseOptions,
          maxAge: getRefreshSessionMaxAgeSeconds(role),
        });
      }
    } else {
      cookieStore.set("auth_token", data.accessToken, authCookieBaseOptions);
      if (data.refreshToken) {
        cookieStore.set("refresh_token", data.refreshToken, refreshCookieBaseOptions);
      }
    }

    // Store selected branch ID in a separate cookie for client-side access
    cookieStore.set("selected_branch_id", branchId, {
      httpOnly: false,
      secure: isSecureCookie,
      sameSite: "lax",
      path: "/",
      maxAge: 30 * 24 * 60 * 60,
    });

    return { success: true };
  } catch (error) {
    console.error("[Server Action] Error setting current branch:", error);

    if (error instanceof AxiosError) {
      const axiosError = error as AxiosError<APIErrorResponse>;
      return {
        success: false,
        error: axiosError.response?.data?.message || "지점 선택에 실패했습니다.",
      };
    }

    return {
      success: false,
      error: "지점 선택에 실패했습니다.",
    };
  }
}
