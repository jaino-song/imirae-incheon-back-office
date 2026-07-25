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

    attemptedBranchIdsRef.current.add(branchId);
    let cancelled = false;

    const prefetchContracts = async () => {
      try {
        if (!isEformsignAuthenticated()) return;

        const authStatus = await eformsignApi.getAuthStatus();
        if (
          cancelled
          || !authStatus.hasAppAuthToken
          || !authStatus.hasAccessToken
        ) {
          return;
        }

        const options = infiniteContractsQueryOptions({
          branchId,
          statusCategory: null,
          search: "",
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
