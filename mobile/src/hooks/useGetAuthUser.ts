import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api/client";
import { usePathname } from "next/navigation";
import { isPublicAuthPath } from "@/lib/auth/routes";
import { E2E_AUTH_USER, isE2ETest } from "@/lib/e2e";

// User 타입 정의 (백엔드 응답 기반)
export interface AuthUser {
    id: string;
    name: string;
    email?: string;
    profileImage?: string;
    role?: string;
    branchId?: string | null;
    branchName?: string | null;
}

interface UseGetAuthUserOptions {
    // 서버에서 prefetch된 초기 데이터
    initialData?: AuthUser | null;
}

export const AUTH_USER_QUERY_KEY = ['authUser'] as const;

// 외부에서 사용할 수 있도록 queryFn export
export const fetchAuthUser = async (): Promise<AuthUser | null> => {
    const { data } = await api.get('/auth/me');
    return data || null;
};

export const useGetAuthUser = (options?: UseGetAuthUserOptions) => {
    const pathname = usePathname();
    // Disable auth query on public auth pages (login, register, forgot-password, etc.)
    const isAuthPage = isPublicAuthPath(pathname);
    const isE2E = isE2ETest()
        || (typeof window !== 'undefined' && (window as Window & { __E2E_AUTH__?: boolean }).__E2E_AUTH__);

    return useQuery({
        queryKey: AUTH_USER_QUERY_KEY,
        queryFn: isE2E ? async () => E2E_AUTH_USER : fetchAuthUser,
        retry: false,
        staleTime: 1000 * 60 * 30, // 30분 (성능 최적화)
        gcTime: 1000 * 60 * 60, // 1시간
        enabled: isE2E ? true : !isAuthPage,
        // initialData가 있으면 바로 사용 (duplicate fetch 방지)
        initialData: options?.initialData ?? (isE2E ? E2E_AUTH_USER : undefined),
    });
}
