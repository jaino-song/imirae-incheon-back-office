import { QueryClient, isServer } from "@tanstack/react-query";

const MAX_QUERY_RETRIES = 1;

// 인증 실패(401/403)는 일시적 오류가 아니라 세션 상태의 문제다.
// 재시도해도 절대 성공하지 않으면서 요청 수만 두 배로 늘리고,
// 401 인터셉터의 로그인 리다이렉트만 지연시킨다.
const NON_RETRYABLE_STATUSES = new Set([401, 403]);

function getResponseStatus(error: unknown): number | undefined {
    const status = (error as { response?: { status?: unknown } } | null | undefined)
        ?.response?.status;
    return typeof status === "number" ? status : undefined;
}

export function shouldRetryQuery(failureCount: number, error: unknown): boolean {
    const status = getResponseStatus(error);
    if (status !== undefined && NON_RETRYABLE_STATUSES.has(status)) {
        return false;
    }
    return failureCount < MAX_QUERY_RETRIES;
}

// SSR-safe QueryClient factory
// - Server: Creates new instance per request (prevents state leakage)
// - Client: Uses singleton for consistent cache
function makeQueryClient() {
    return new QueryClient({
        defaultOptions: {
            queries: {
                staleTime: 1000 * 60 * 30, // 30분 (성능 최적화)
                gcTime: 1000 * 60 * 60, // 1시간 garbage collection
                retry: shouldRetryQuery,
            },
        },
    });
}

let browserQueryClient: QueryClient | undefined = undefined;

export function getQueryClient() {
    if (isServer) {
        // Server: 매 요청마다 새 인스턴스 생성
        return makeQueryClient();
    }
    // Client: 싱글톤 사용
    if (!browserQueryClient) {
        browserQueryClient = makeQueryClient();
    }
    return browserQueryClient;
}

// 하위 호환성을 위한 기존 export 유지
export const queryClient = getQueryClient();
