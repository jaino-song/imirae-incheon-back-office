import { jwtDecode } from "jwt-decode";

const DAY_IN_SECONDS = 24 * 60 * 60;

export const ACCESS_TOKEN_MAX_AGE_SECONDS = 15 * 60;

export function getRefreshSessionMaxAgeSeconds(
    role: string | null | undefined,
): number {
    if (role === "owner") return 30 * DAY_IN_SECONDS;
    if (role === "admin" || role === "manager") return 7 * DAY_IN_SECONDS;
    return 3 * DAY_IN_SECONDS;
}

export function decodeAccessRole(accessToken: string): string | null {
    try {
        return jwtDecode<{ role?: string | null }>(accessToken).role ?? null;
    } catch {
        return null;
    }
}

export function decodeAccessBranchId(accessToken: string): string | null {
    try {
        return jwtDecode<{ branchId?: string | null }>(accessToken).branchId ?? null;
    } catch {
        return null;
    }
}
