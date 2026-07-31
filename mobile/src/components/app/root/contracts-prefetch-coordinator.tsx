"use client";

import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";

import {
  CONTRACTS_PAGE_STALE_TIME,
  infiniteContractsQueryOptions,
} from "@/hooks/useInfiniteContracts";
import { useGetAuthUser } from "@/hooks/useGetAuthUser";
import { dashboardQueryKeys } from "@/hooks/useDashboardAnalytics";
import { clientQueryKeys } from "@/hooks/useClients";
import { api } from "@/lib/api/client";
import { eformsignApi } from "@/services/api";

export function ContractsPrefetchCoordinator(): null {
  const queryClient = useQueryClient();
  const { data: user } = useGetAuthUser();
  const branchId = user?.branchId;
  const attemptedBranchIdsRef = useRef(new Set<string>());

  useEffect(() => {
    if (!branchId || attemptedBranchIdsRef.current.has(branchId)) return;

    let cancelled = false;

    const prefetchShellData = async () => {
      try {
        attemptedBranchIdsRef.current.add(branchId);

        // Prefetch Dashboard queries in background
        void queryClient.prefetchQuery({
          queryKey: dashboardQueryKeys.analytics(),
          queryFn: async () => {
            const response = await fetch("/api/clients/analytics", { cache: "no-store" });
            return response.json();
          },
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

        const authStatus = await eformsignApi.getAuthStatus();
        if (
          cancelled
          || !authStatus.hasAppAuthToken
        ) {
          return;
        }

        // 계약 페이지의 기본 뷰(산모 계약서 섹션)와 완전히 같은 쿼리 키로 프리페치해야
        // 캐시가 재사용된다: 섹션은 제공기록지 template id의 exclude 필터로 표현되므로
        // template id를 먼저 확보한다(페이지와 동일한 쿼리 키 — 이 조회도 함께 워밍됨).
        const serviceRecordTemplate = await queryClient.fetchQuery({
          queryKey: ["eformsign-docs", "service-record-template-id"],
          queryFn: eformsignApi.getServiceRecordTemplateId,
          staleTime: 1000 * 60 * 5,
        });
        const serviceRecordTemplateIds = serviceRecordTemplate?.templateIds
          ?? (serviceRecordTemplate?.templateId ? [serviceRecordTemplate.templateId] : []);
        if (cancelled || serviceRecordTemplateIds.length === 0) return;
        const serviceRecordTemplateId = serviceRecordTemplateIds.join(",");

        const options = infiniteContractsQueryOptions({
          branchId,
          statusCategory: null,
          search: "",
          templateId: serviceRecordTemplateId,
          templateMatch: "exclude",
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
