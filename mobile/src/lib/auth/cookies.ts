import { serverAPIClient } from "@/lib/api/server";
import { cookies } from "next/headers";
import { cache } from "react";
import { jwtDecode } from "jwt-decode";
import axios from "axios";
import { E2E_ROLE_COOKIE, getE2EAuthUser, isE2ETest } from "@/lib/e2e";

interface TokenPayload {
  sub: string;
  role: string | null;
  branchId?: string;
  branchRole?: string;
  organizationId?: string;
  type: "access" | "refresh";
}

// React cache()를 사용하여 같은 request cycle 내에서 중복 호출 방지
// Next.js의 Request Memoization은 native fetch에만 적용되므로
// axios를 사용하는 경우 수동으로 캐싱 필요
export const getCurrentUser = cache(async () => {
  try {
    const cookieStore = await cookies();
    const authToken = cookieStore.get('auth_token');

    console.log("[getCurrentUser] auth_token present:", !!authToken);

    if (!authToken) {
      console.log("[getCurrentUser] No auth token found");
      return null;
    }

    if (isE2ETest()) {
      return getE2EAuthUser(cookieStore.get(E2E_ROLE_COOKIE)?.value);
    }

    // Send token as Bearer token in Authorization header
    const res = await serverAPIClient.get(`/auth/me`, {
      headers: {
        Authorization: `Bearer ${authToken.value}`,
      },
    });

    if (res.status !== 200) {
      console.error("[getCurrentUser] Failed to fetch user: non-200 response", res.status);
      return null;
    }

    console.log("[getCurrentUser] User fetched successfully:", res.data?.name);
    return res.data;
  } catch (error: unknown) {
    if (axios.isAxiosError(error)) {
      console.error("[getCurrentUser] Failed to fetch user:", {
        code: error.code,
        status: error.response?.status,
        name: error.name,
      });
    } else if (error instanceof Error) {
      console.error("[getCurrentUser] Failed to fetch user:", { name: error.name });
    } else {
      console.error("[getCurrentUser] Failed to fetch user");
    }
    return null;
  }
});

/**
 * Check if user has selected an branch
 * Returns true if branchId exists in JWT token
 */
export const hasSelectedBranch = cache(async (): Promise<boolean> => {
  try {
    const cookieStore = await cookies();
    const authToken = cookieStore.get('auth_token');

    if (!authToken) {
      return false;
    }

    const decoded = jwtDecode<TokenPayload>(authToken.value);
    return !!(decoded.branchId ?? decoded.organizationId);
  } catch {
    return false;
  }
});
