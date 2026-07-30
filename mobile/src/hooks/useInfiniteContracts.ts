"use client";

import { useEffect, useMemo, useRef } from "react";
import { infiniteQueryOptions, useInfiniteQuery, useQueryClient } from "@tanstack/react-query";

import { eformsignApi } from "@/services/api";
import type { EformsignStatusCategoryParam, EformsignTemplateMatchParam } from "@/services/api";
import type { EformsignDocument, EformsignDocumentsResponse } from "@/lib/eformsign/types";
import type { DocumentFilterType } from "@/lib/eformsign/status-codes";
import { useGetAuthUser } from "./useGetAuthUser";

/** First page is bigger so the list fills the viewport in one round trip. */
export const CONTRACTS_FIRST_PAGE_SIZE = 9;
/** Every subsequent "load more" page. */
export const CONTRACTS_NEXT_PAGE_SIZE = 6;

export const CONTRACTS_PAGE_STALE_TIME = 1000 * 60 * 5; // 5 minutes
export const CONTRACTS_PAGE_GC_TIME = 1000 * 60 * 60; // 1 hour

/** Offset page cursor sent to `GET /eformsign/documents`. */
export interface ContractsPageParam {
  limit: number;
  skip: number;
}

export interface InfiniteContractsQueryInput {
  /** Branch the documents belong to. Part of the key so branch switches never reuse a page. */
  branchId?: string | null;
  /** Server-side status bucket, or null/undefined for "all". */
  statusCategory?: EformsignStatusCategoryParam | null;
  /** Server-side search term (chosung-aware on the backend). */
  search?: string | null;
  /**
   * Section filter: the service-record template id, matched `include` for the
   * 제공기록지 section and `exclude` for the 산모 계약서 section. Part of the key so
   * section switches restart from page 1.
   */
  templateId?: string | null;
  templateMatch?: EformsignTemplateMatchParam | null;
}

export const infiniteContractsQueryKeys = {
  /** Prefix for every paginated contracts query (useful for invalidate/remove). */
  all: () => ["eformsign-documents", "paginated"] as const,
  list: ({ branchId, statusCategory, search, templateId, templateMatch }: InfiniteContractsQueryInput) =>
    [
      "eformsign-documents",
      "paginated",
      branchId ?? "unknown",
      statusCategory ?? "all",
      search ?? "",
      templateId ?? "any-template",
      templateMatch ?? "include",
    ] as const,
};

/**
 * Maps the contracts page's filter pill value onto the backend `statusCategory`
 * param. "rejected" is surfaced to users separately but lives in the backend's
 * "expired" bucket (same as the legacy client-side filter did).
 */
export function toStatusCategoryParam(
  filter: DocumentFilterType,
): EformsignStatusCategoryParam | null {
  if (filter === null) return null;
  return filter === "rejected" ? "expired" : filter;
}

function resolveHasMore(page: EformsignDocumentsResponse): boolean {
  // `has_more` is the authoritative signal, but a mobile deploy can race ahead of
  // the backend. Fall back to the offset math so an old backend still paginates.
  return page.has_more ?? page.skip + page.limit < page.total_rows;
}

function getNextPageParam(
  lastPage: EformsignDocumentsResponse,
  allPages: EformsignDocumentsResponse[],
  lastPageParam: ContractsPageParam,
): ContractsPageParam | undefined {
  if (!resolveHasMore(lastPage)) return undefined;

  const loadedCount = allPages.reduce((total, page) => total + (page.documents?.length ?? 0), 0);

  // Defensive: a server that claims `has_more` but returns nothing would otherwise
  // spin on the same cursor forever.
  if (loadedCount <= lastPageParam.skip) return undefined;

  return { limit: CONTRACTS_NEXT_PAGE_SIZE, skip: loadedCount };
}

/**
 * Shared query options for the paginated contracts list.
 *
 * Deliberately free of `enabled` so the exact same object works for both
 * `useInfiniteQuery` (the hook below) and `queryClient.prefetchInfiniteQuery`
 * (the prefetch coordinator) — identical key, queryFn and staleTime is what makes
 * a prefetched cache entry reusable by the page instead of refetched.
 */
export function infiniteContractsQueryOptions({
  branchId,
  statusCategory,
  search,
  templateId,
  templateMatch,
}: InfiniteContractsQueryInput) {
  const normalizedSearch = search?.trim() ?? "";
  const normalizedStatusCategory = statusCategory ?? null;
  const normalizedTemplateId = templateId ?? null;
  const normalizedTemplateMatch = templateMatch ?? null;

  return infiniteQueryOptions({
    queryKey: infiniteContractsQueryKeys.list({
      branchId,
      statusCategory: normalizedStatusCategory,
      search: normalizedSearch,
      templateId: normalizedTemplateId,
      templateMatch: normalizedTemplateMatch,
    }),
    queryFn: ({ pageParam }) =>
      eformsignApi.getAllDocuments({
        limit: pageParam.limit,
        skip: pageParam.skip,
        statusCategory: normalizedStatusCategory ?? undefined,
        search: normalizedSearch || undefined,
        templateId: normalizedTemplateId ?? undefined,
        templateMatch: normalizedTemplateMatch ?? undefined,
        // Mobile never shows deleted documents; filtering server-side keeps the
        // page slice honest (deleted docs would otherwise eat page slots).
        excludeDeleted: true,
      }),
    initialPageParam: { limit: CONTRACTS_FIRST_PAGE_SIZE, skip: 0 } as ContractsPageParam,
    getNextPageParam,
    staleTime: CONTRACTS_PAGE_STALE_TIME,
    gcTime: CONTRACTS_PAGE_GC_TIME,
  });
}

export interface UseInfiniteContractsOptions extends Omit<InfiniteContractsQueryInput, "branchId"> {
  /** Caller-side gate (e.g. eformsign auth). Branch readiness is handled internally. */
  enabled?: boolean;
}

/**
 * Server-paginated contracts list: 9 documents on the first request, 6 per
 * "load more". Status/search filtering happens on the server, so `total_rows`
 * and `has_more` describe the filtered set. Changing the filter, the search term
 * or the branch changes the query key, which restarts from page 1 automatically.
 */
export function useInfiniteContracts({
  statusCategory = null,
  search = "",
  templateId = null,
  templateMatch = null,
  enabled = true,
}: UseInfiniteContractsOptions = {}) {
  const queryClient = useQueryClient();
  const { data: authUser } = useGetAuthUser();
  const branchId = authUser?.branchId ?? null;

  const options = useMemo(
    () => infiniteContractsQueryOptions({ branchId, statusCategory, search, templateId, templateMatch }),
    [branchId, statusCategory, search, templateId, templateMatch],
  );

  const query = useInfiniteQuery({
    ...options,
    // Querying before the branch is known would cache pages under "unknown" and
    // then refetch everything once the real branch arrives.
    enabled: enabled && Boolean(branchId),
  });

  const pages = query.data?.pages;

  // Offset pagination can hand back a document twice when the underlying list
  // shifts between page requests. De-duplicating by id keeps React keys unique;
  // page offsets are still computed from the raw page sizes in getNextPageParam.
  const documents = useMemo(() => {
    const seen = new Set<string>();
    const flattened: EformsignDocument[] = [];

    for (const page of pages ?? []) {
      for (const document of page.documents ?? []) {
        if (document.id) {
          if (seen.has(document.id)) continue;
          seen.add(document.id);
        }
        flattened.push(document);
      }
    }

    return flattened;
  }, [pages]);

  const totalRows = pages?.length ? pages[pages.length - 1].total_rows : 0;

  // --- snapshot_version drift guard -----------------------------------------
  // Offset pagination is only coherent against a stable snapshot. If the backend
  // reports a different snapshot for a later page, the underlying list changed
  // mid-pagination and the loaded pages may hold duplicates or gaps — restart
  // from page 1. The field is optional (absent when the cache is bypassed), which
  // simply means "no signal".
  const baseSnapshotVersion = pages?.[0]?.snapshot_version;
  const conflictingSnapshotVersion = useMemo(() => {
    if (!pages || !baseSnapshotVersion) return undefined;
    return pages
      .slice(1)
      .find((page) => page.snapshot_version && page.snapshot_version !== baseSnapshotVersion)
      ?.snapshot_version;
  }, [pages, baseSnapshotVersion]);

  // Loop guard: at most one reset per (query key, base -> conflicting) pair. A
  // repeat of the exact same mismatch after a reset is swallowed rather than
  // resetting forever.
  const lastSnapshotResetRef = useRef<string | null>(null);
  const queryKey = options.queryKey;

  useEffect(() => {
    if (!baseSnapshotVersion || !conflictingSnapshotVersion) return;

    const signature = `${queryKey.join("|")}::${baseSnapshotVersion}->${conflictingSnapshotVersion}`;
    if (lastSnapshotResetRef.current === signature) return;
    lastSnapshotResetRef.current = signature;

    void queryClient.resetQueries({ queryKey, exact: true });
  }, [baseSnapshotVersion, conflictingSnapshotVersion, queryClient, queryKey]);

  return {
    // Spreading opts out of react-query's tracked-props optimization (every
    // field counts as observed), which is the trade for a flat, page-friendly
    // surface. List rendering re-renders on those fields anyway.
    ...query,
    /** All documents loaded so far, in server order, de-duplicated by id. */
    documents,
    /** Total documents matching the active filters on the server. */
    totalRows,
    /** How many documents are currently rendered. */
    loadedCount: documents.length,
    /** Snapshot the loaded pages were built from, when the backend reports one. */
    snapshotVersion: baseSnapshotVersion,
    /** Branch the loaded pages belong to; null until the auth user resolves. */
    branchId,
    /** True while the branch is still unknown, so the query cannot run yet. */
    isBranchPending: !branchId,
    /** A "load more" failed, but the already-loaded documents are still shown. */
    isLoadMoreError: query.isFetchNextPageError,
    queryKey,
  };
}
