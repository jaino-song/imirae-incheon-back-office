import { api } from "@/lib/api/client";

export interface SystemAdminUserBranch {
  id: string;
  name: string;
  role: string | null;
}

export interface SystemAdminUser {
  id: string;
  kakaoId: string | null;
  email: string | null;
  name: string | null;
  phone: string | null;
  birthDate: string | null;
  profileImage: string | null;
  role: string | null;
  createdAt: string;
  emailVerified: boolean;
  authProvider: string;
  branches: SystemAdminUserBranch[];
  approvalStatus: string;
  requestedRole: string | null;
}

export async function getSystemAdminUsers(): Promise<SystemAdminUser[]> {
  const { data } = await api.get("/users");
  return Array.isArray(data) ? data : [];
}

export async function getPendingUsers(): Promise<SystemAdminUser[]> {
  const { data } = await api.get("/users", { params: { status: "pending" } });
  return Array.isArray(data) ? data : [];
}

export async function approveUser(
  id: string,
  role: string,
  branchId: string,
  ownerBranchId?: string,
): Promise<void> {
  await api.post(`/users/${id}/approve`, {
    role,
    branchId,
    ...(ownerBranchId ? { ownerBranchId } : {}),
  });
}

export async function rejectUser(id: string): Promise<void> {
  await api.post(`/users/${id}/reject`, {});
}

export interface UpdateSystemAdminUserAccountInput {
  role: "admin" | "manager" | "user";
  branchIds: string[];
  expectedRole: "admin" | "manager" | "user";
  expectedBranchIds: string[];
}

export async function updateSystemAdminUserAccount(
  id: string,
  input: UpdateSystemAdminUserAccountInput,
): Promise<void> {
  await api.patch(`/users/${encodeURIComponent(id)}/account-assignment`, input);
}
