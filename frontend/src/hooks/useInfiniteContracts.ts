"use client";

import { useEffect, useMemo, useRef } from "react";
import {
  type InfiniteData,
  useInfiniteQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { eformsignApi } from "@/services/api";
import { EformsignDocument, EformsignDocumentsResponse } from "@/lib/eformsign/types";
import { eformsignQueryKeys } from "@/hooks/useEformsignDocuments";
import { getStatusCategory, DocumentFilterType } from "@/lib/eformsign/status-codes";

const PAGE_SIZE = 20;
const EMPTY_DOCUMENTS: EformsignDocument[] = [];
const UNVERSIONED_SNAPSHOT_GENERATION = "<unversioned>";

// Filter documents by actual status code. Used as a safety net for the merged
// "전체" endpoint; per-status endpoints are already filtered server-side.
function filterByActualStatus(
  docs: EformsignDocument[],
  type: DocumentFilterType
): EformsignDocument[] {
  if (type === null) return docs;
  return docs.filter(
    (doc) => getStatusCategory(doc.current_status?.status_type) === type
  );
}

// Sort by created_date desc. Per-status endpoints already return sorted
// (eformsign yields newest first per status), so this is mostly a no-op there.
// For "전체", the merged-dedupe endpoint interleaves three status streams, so
// after concatenating multiple pages we re-sort to keep the global newest-first
// order — this can shift previously-displayed items if a later page surfaces a
// newer cross-status item, which is the unavoidable trade-off of paginating a
// merged stream without server-side merge-sort.
function sortByCreatedDate(docs: EformsignDocument[]): EformsignDocument[] {
  return [...docs].sort((a, b) => b.created_date - a.created_date);
}

export const infiniteContractsQueryKeys = {
  documents: (
    status: DocumentFilterType,
    section?: ContractsSectionParam,
    search?: string,
  ) => [
    ...eformsignQueryKeys.documents(),
    "infinite",
    status ?? "all",
    section ?? "any-section",
    // Search is part of the key so a new term never reuses another term's
    // cached pages (which would render as the search silently not applying).
    search || "",
  ] as const,
};

/**
 * Contracts sections whose template filter the backend resolves server-side
 * (maternity = whitelist of the branch's registered 계약서 templates,
 * service-records = the configured 제공기록지 tiers). Clients never send
 * templateId/templateMatch any more.
 */
export type ContractsSectionParam = "maternity" | "service-records";

interface UseInfiniteContractsOptions {
  enabled?: boolean;
  filterType?: DocumentFilterType;
  section?: ContractsSectionParam;
  /**
   * Server-side search term (chosung-aware on the backend). Trimmed here;
   * an empty/whitespace value means "no search" and sends no param, so the
   * unsearched list behaves exactly as before. With the search applied on the
   * server, `total_rows`/`hasNextPage` describe the *filtered* set — the list
   * stops paginating when the matches run out instead of walking the whole
   * table client-side.
   */
  search?: string;
}

/**
 * Server-side paginated hook for contracts.
 *
 * Per-status tabs (대기/완료/기간 만료) hit dedicated eformsign endpoints with
 * real `limit`/`skip` pagination using `total_rows` from the upstream response.
 *
 * The merged "전체" endpoint now also returns its branch-scoped `total_rows`.
 * Use that pagination metadata instead of issuing an extra, expensive request
 * solely to discover an empty page.
 *
 * Each tab has its own cache (queryKey differs by filterType) and persists for
 * `staleTime`, so tab switches do not refetch within that window.
 */
export function getNextContractsPageParam(
  lastPage: EformsignDocumentsResponse,
): number | undefined {
  if (lastPage.documents.length === 0) {
    return undefined;
  }

  const nextSkip = lastPage.skip + lastPage.limit;
  return nextSkip < lastPage.total_rows ? nextSkip : undefined;
}

export function useInfiniteContracts({
  enabled = true,
  filterType = null,
  section,
  search,
}: UseInfiniteContractsOptions = {}) {
  const queryClient = useQueryClient();
  const normalizedSearch = search?.trim() ?? "";
  const queryKey = useMemo(
    () => infiniteContractsQueryKeys.documents(filterType, section, normalizedSearch),
    [filterType, section, normalizedSearch],
  );
  const query = useInfiniteQuery<EformsignDocumentsResponse>({
    queryKey,
    initialPageParam: 0,
    queryFn: async ({ pageParam }) => {
      const skip = typeof pageParam === "number" ? pageParam : 0;
      const params = {
        limit: PAGE_SIZE,
        skip,
        ...(section ? { section } : {}),
        ...(normalizedSearch ? { search: normalizedSearch } : {}),
      };
      switch (filterType) {
        case "in-progress":
          return await eformsignApi.getInProgressDocuments(params);
        case "completed":
          return await eformsignApi.getCompletedDocuments(params);
        case "expired":
          return await eformsignApi.getExpiredDocuments(params);
        case null:
        default:
          return await eformsignApi.getAllDocuments({
            ...params,
            type: null,
            // A permanent delete scrubs the contract and leaves a 049 tombstone.
            // Without this the All tab shows that emptied row back to the user
            // right after they deleted it; the 기간 만료 tab is where deleted
            // contracts are meant to appear. Mobile has always sent this.
            excludeDeleted: true,
          });
      }
    },
    getNextPageParam: getNextContractsPageParam,
    enabled,
    staleTime: 1000 * 60 * 5, // 5 minutes
    gcTime: 1000 * 60 * 60, // 1 hour
    refetchOnWindowFocus: false,
  });

  // Offset pagination is valid only while every page belongs to the same effective
  // mirror generation. A live readiness/tombstone fence can change membership even
  // when Valkey invalidation fails, so restart from page 1 when a later page reports
  // a different semantic snapshot generation. Presence is part of that
  // generation: mixing a cache-backed versioned page with an unversioned
  // cache-bypass page is no safer than mixing two different versions.
  const pages = query.data?.pages;
  const baseSnapshotVersion = pages?.[0]?.snapshot_version;
  const baseSnapshotGeneration = pages?.length
    ? (baseSnapshotVersion ?? UNVERSIONED_SNAPSHOT_GENERATION)
    : undefined;
  const conflictingSnapshotGeneration = useMemo(() => {
    if (!pages || baseSnapshotGeneration === undefined) return undefined;
    return pages
      .slice(1)
      .map((page) =>
        page.snapshot_version ?? UNVERSIONED_SNAPSHOT_GENERATION)
      .find((generation) => generation !== baseSnapshotGeneration);
  }, [pages, baseSnapshotGeneration]);
  const lastSnapshotRestartRef = useRef<string | null>(null);

  useEffect(() => {
    if (baseSnapshotGeneration === undefined) return;
    if (conflictingSnapshotGeneration === undefined) {
      lastSnapshotRestartRef.current = null;
      return;
    }
    const signature =
      `${queryKey.join("|")}::${baseSnapshotGeneration}->${conflictingSnapshotGeneration}`;
    if (lastSnapshotRestartRef.current === signature) return;
    lastSnapshotRestartRef.current = signature;
    queryClient.setQueryData<InfiniteData<EformsignDocumentsResponse>>(
      queryKey,
      (current) => current
        ? {
            pages: current.pages.slice(0, 1),
            pageParams: current.pageParams.slice(0, 1),
          }
        : current,
    );
    void queryClient.invalidateQueries({ queryKey, exact: true });
  }, [
    baseSnapshotGeneration,
    conflictingSnapshotGeneration,
    queryClient,
    queryKey,
  ]);

  // Flatten loaded pages into a single document list, deduping by id.
  // The backend's getAllDocuments only dedupes within a single response, so a
  // document appearing in multiple status streams (e.g. completed and expired)
  // can leak across pages. Dedupe here to keep React keys unique and avoid
  // double-rendering.
  const fetchedDocuments = useMemo(() => {
    if (!query.data) return EMPTY_DOCUMENTS;
    const seen = new Set<string>();
    const deduped: EformsignDocument[] = [];
    for (const page of query.data.pages) {
      for (const doc of page.documents) {
        if (seen.has(doc.id)) continue;
        seen.add(doc.id);
        deduped.push(doc);
      }
    }
    return deduped;
  }, [query.data]);

  const documents = useMemo(() => {
    if (fetchedDocuments.length === 0) return EMPTY_DOCUMENTS;

    // Server filters by status for per-status endpoints; this is a safety net
    // for the merged "전체" endpoint (which returns all statuses) and a no-op
    // for other tabs.
    //
    // Nothing else may be filtered here. Dropping rows after the server has
    // paginated leaves has_more describing a larger set than what renders, so
    // the list keeps asking for pages that vanish on arrival and never settles
    // — the same loop the client-side search caused. A customer-name exclusion
    // list used to sit here; it was always empty, and if one is ever needed it
    // belongs in the query, not after it.
    return sortByCreatedDate(filterByActualStatus(fetchedDocuments, filterType));
  }, [filterType, fetchedDocuments]);

  // Total reported by upstream eformsign for per-status tabs. Not meaningful
  // for the 전체 tab (it is the first page's deduped batch size).
  const totalCount = query.data?.pages[0]?.total_rows ?? 0;

  return {
    documents,
    allDocuments: documents,
    isLoading: query.isLoading,
    isFetchingNextPage: query.isFetchingNextPage,
    hasNextPage: !!query.hasNextPage,
    fetchNextPage: query.fetchNextPage,
    totalCount,
    error: query.error,
    refetch: query.refetch,
  };
}
