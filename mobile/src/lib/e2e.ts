import { IS_E2E_TEST } from "@/lib/env";

export const E2E_ROLE_COOKIE = "e2e_role";

export const E2E_AUTH_USER = {
  id: "e2e-user",
  name: "E2E Tester",
  email: "e2e@example.com",
  profileImage: "",
  role: "admin",
  branchId: "e2e-branch",
  branchName: "E2E Branch",
} as const;

export function getE2EAuthUser(role?: string) {
  return role === "owner" ? { ...E2E_AUTH_USER, role: "owner" as const } : E2E_AUTH_USER;
}

export const E2E_VAPID_PUBLIC_KEY =
  "BAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

export function isE2ETest() {
  return IS_E2E_TEST;
}
