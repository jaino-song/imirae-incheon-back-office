"use client";

import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";

import {
  CONTRACTS_PAGE_STALE_TIME,
  infiniteContractsQueryOptions,
} from "@/hooks/useInfiniteContracts";
import { useGetAuthUser } from "@/hooks/useGetAuthUser";
import { safeStorageGetItem } from "@/lib/safe-storage";
import { eformsignApi } from "@/services/api";

const EFORMSIGN_TOKEN_EXPIRY_MS = 60 * 60 * 1000;
const EFORMSIGN_AUTH_BUFFER_MS = 5 * 60 * 1000;

function isEformsignAuthenticated(): boolean {
  if (typeof window === "undefined") return false;

  const authTimeStr = safeStorageGetItem("session", "eformsign_auth_time");
  if (!authTimeStr) return false;

  const authTime = parseInt(authTimeStr, 10);
  return Date.now() - authTime < EFORMSIGN_TOKEN_EXPIRY_MS - EFORMSIGN_AUTH_BUFFER_MS;
}

export function ContractsPrefetchCoordinator(): null {
  const queryClient = useQueryClient();
  const { data: user } = useGetAuthUser();
  const branchId = user?.branchId;
  const attemptedBranchIdsRef = useRef(new Set<string>());

  useEffect(() => {
    if (!branchId || attemptedBranchIdsRef.current.has(branchId)) return;

    let cancelled = false;

    const prefetchContracts = async () => {
      try {
        // 인증 확인을 통과한 뒤에만 "시도함"으로 기록한다 — 신선한 세션에서 eformsign
        // 인증보다 먼저 마운트돼 조기 반환한 경우, 다음 마운트/지점 변경에서 재시도된다.
        if (!isEformsignAuthenticated()) return;

        const authStatus = await eformsignApi.getAuthStatus();
        if (
          cancelled
          || !authStatus.hasAppAuthToken
          || !authStatus.hasAccessToken
        ) {
          return;
        }

        attemptedBranchIdsRef.current.add(branchId);

        // 계약 페이지의 기본 뷰(산모 계약서 섹션)와 완전히 같은 쿼리 키로 프리페치해야
        // 캐시가 재사용된다: 섹션은 제공기록지 template id의 exclude 필터로 표현되므로
        // template id를 먼저 확보한다(페이지와 동일한 쿼리 키 — 이 조회도 함께 워밍됨).
        const feedbackTemplate = await queryClient.fetchQuery({
          queryKey: ["eformsign-docs", "feedback-template-id"],
          queryFn: eformsignApi.getFeedbackTemplateId,
          staleTime: 1000 * 60 * 5,
        });
        if (cancelled || !feedbackTemplate?.templateId) return;

        const options = infiniteContractsQueryOptions({
          branchId,
          statusCategory: null,
          search: "",
          templateId: feedbackTemplate.templateId,
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

    void prefetchContracts();

    return () => {
      cancelled = true;
    };
  }, [branchId, queryClient]);

  return null;
}
