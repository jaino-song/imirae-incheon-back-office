"use client";

import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";

import {
  CONTRACTS_PAGE_STALE_TIME,
  infiniteContractsQueryOptions,
} from "@/hooks/useInfiniteContracts";
import { useGetAuthUser } from "@/hooks/useGetAuthUser";
import { dashboardQueryKeys, fetchDashboardAnalytics } from "@/hooks/useDashboardAnalytics";
import { clientQueryKeys } from "@/hooks/useClients";
import { api } from "@/lib/api/client";
import { eformsignApi } from "@/services/api";

export function ContractsPrefetchCoordinator(): null {
  const queryClient = useQueryClient();
  const { data: user } = useGetAuthUser();
  const branchId = user?.branchId;
  const attemptedBranchIdsRef = useRef(new Set<string>());
  const contractsAttemptedBranchIdsRef = useRef(new Set<string>());

  useEffect(() => {
    if (
      !branchId
      || (
        attemptedBranchIdsRef.current.has(branchId)
        && contractsAttemptedBranchIdsRef.current.has(branchId)
      )
    ) {
      return;
    }

    let cancelled = false;

    const prefetchShellData = async () => {
      try {
        if (!attemptedBranchIdsRef.current.has(branchId)) {
          attemptedBranchIdsRef.current.add(branchId);

          // Prefetch Dashboard queries in background
          void queryClient.prefetchQuery({
            queryKey: dashboardQueryKeys.analytics(),
            queryFn: fetchDashboardAnalytics,
            staleTime: 60_000,
          });

          void queryClient.prefetchQuery({
            queryKey: clientQueryKeys.list(1, 50, undefined),
            queryFn: async () => {
              const { data } = await api.get("/clients", { params: { page: 1, limit: 50 } });
              return data;
            },
            staleTime: 60_000,
          });
        }

        if (contractsAttemptedBranchIdsRef.current.has(branchId)) return;

        // 인증 확인을 통과한 뒤에만 "시도함"으로 기록한다 — 신선한 세션에서 eformsign
        // 인증보다 먼저 마운트돼 조기 반환한 경우, 다음 마운트/지점 변경에서 재시도된다.
        const authStatus = await eformsignApi.getAuthStatus();
        if (
          cancelled
          || !authStatus.hasAppAuthToken
        ) {
          return;
        }

        contractsAttemptedBranchIdsRef.current.add(branchId);

        // 계약 페이지의 기본 뷰(산모 계약서 섹션)와 완전히 같은 쿼리 키로 프리페치해야
        // 캐시가 재사용된다: 템플릿 필터는 section 파라미터로 서버가 결정하므로
        // 클라이언트가 템플릿 id를 먼저 확보할 필요가 없다.
        const options = infiniteContractsQueryOptions({
          branchId,
          statusCategory: null,
          search: "",
          section: "maternity",
        });
        const queryState = queryClient.getQueryState(options.queryKey);
        const isFresh = Boolean(
          queryState?.dataUpdatedAt
          && Date.now() - queryState.dataUpdatedAt < CONTRACTS_PAGE_STALE_TIME,
        );

        if (isFresh) return;

        await queryClient.prefetchInfiniteQuery(options);
      } catch {
        // Background prefetch must never block shell entry.
      }
    };

    void prefetchShellData();

    return () => {
      cancelled = true;
    };
  }, [branchId, queryClient]);

  return null;
}
