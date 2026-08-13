"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { eformsignApi, withEformsignReauth } from "@/services/api";
import {
  EformsignDeleteDocumentsResponse,
  EformsignDocumentsResponse,
  EformsignDocument,
} from "@/lib/eformsign/types";
import { getStatusCategory, DocumentFilterType } from "@/lib/eformsign/status-codes";

// Re-export types for convenience
export type { DocumentFilterType } from "@/lib/eformsign/status-codes";

// Debug logging (only in development)
const isDev = process.env.NODE_ENV === "development";
const debugLog = isDev ? console.log.bind(console) : () => {};

// Filter documents by actual status code (not just inbox type)
function filterByActualStatus(docs: EformsignDocument[], type: DocumentFilterType): EformsignDocument[] {
  if (type === null) return docs;
  return docs.filter(doc => getStatusCategory(doc.current_status?.status_type) === type);
}

// Query keys
export const eformsignQueryKeys = {
  documents: () => ["eformsign-documents"] as const,
  documentsByType: (type: string) => ["eformsign-documents", type] as const,
  allDocuments: () => ["eformsign-documents", "all"] as const,
  clientCandidate: (documentId: string) =>
    ["eformsign-client-candidate", documentId] as const,
};

// Fetch all documents using unified backend endpoint (single request instead of 3)
async function fetchAllDocuments(): Promise<EformsignDocumentsResponse> {
  // Uses the unified /documents endpoint which fetches all types on the backend
  const response = await eformsignApi.getAllDocuments();
  debugLog(`[fetchAllDocuments] Received ${response.documents?.length || 0} docs`);
  return response;
}

// Hook to fetch documents by type (in-progress, completed, expired, or all)
export function useEformsignDocumentsByType(isAuthenticated: boolean, type: DocumentFilterType) {
  return useQuery<EformsignDocumentsResponse>({
    queryKey: type === null 
      ? eformsignQueryKeys.allDocuments() 
      : eformsignQueryKeys.documentsByType(type),
    queryFn: async () => {
      let response: EformsignDocumentsResponse;
      
      switch (type) {
        case null:
          response = await fetchAllDocuments();
          break;
        case "in-progress":
          response = await eformsignApi.getInProgressDocuments();
          break;
        case "completed":
          response = await eformsignApi.getCompletedDocuments();
          break;
        case "expired":
          response = await eformsignApi.getExpiredDocuments();
          break;
        default:
          throw new Error("Invalid type");
      }
      
      // Filter by actual status code
      const filteredDocs = filterByActualStatus(response.documents || [], type);
      
      // Sort by created_date descending (newest first)
      filteredDocs.sort((a, b) => b.created_date - a.created_date);
      
      debugLog(`[useEformsignDocuments] Type: ${type}, Filtered: ${response.documents?.length || 0} -> ${filteredDocs.length}`);
      
      return {
        ...response,
        documents: filteredDocs,
        total_rows: filteredDocs.length,
      };
    },
    enabled: isAuthenticated,
    staleTime: 1000 * 60 * 5, // 5 minutes
    gcTime: 1000 * 60 * 60,   // 1 hour (garbage collection)
    refetchOnWindowFocus: false,
  });
}

// Legacy hook for backward compatibility
export function useEformsignDocuments(isAuthenticated: boolean = true) {
  return useQuery<EformsignDocumentsResponse>({
    queryKey: eformsignQueryKeys.documents(),
    queryFn: async () => eformsignApi.getDocuments(),
    enabled: isAuthenticated,
    staleTime: 1000 * 60 * 5,
    gcTime: 1000 * 60 * 60,
    refetchOnWindowFocus: false,
  });
}

export function useDeleteEformsignDocument() {
  const queryClient = useQueryClient();

  // Removes a document from a single response page if present. Returns the
  // page unchanged when the document isn't there.
  function removeFromPage(
    page: EformsignDocumentsResponse | undefined,
    documentId: string,
  ): EformsignDocumentsResponse | undefined {
    if (!page) return page;
    const currentDocuments = page.documents || [];
    const nextDocuments = currentDocuments.filter((doc) => doc.id !== documentId);
    const removedCount = currentDocuments.length - nextDocuments.length;
    if (removedCount === 0) return page;
    return {
      ...page,
      documents: nextDocuments,
      total_rows: Math.max(0, (page.total_rows ?? currentDocuments.length) - removedCount),
    };
  }

  return useMutation<EformsignDeleteDocumentsResponse, Error, string>({
    mutationFn: async (documentId: string) =>
      withEformsignReauth(() => eformsignApi.deleteDocument(documentId)),
    onMutate: async (documentId: string) => {
      await queryClient.cancelQueries({ queryKey: ["eformsign-documents"] });

      // Cache shape varies: legacy `useQuery` stores `EformsignDocumentsResponse`
      // directly, while `useInfiniteContracts` stores `InfiniteData<...>` with a
      // `pages` array. Handle both.
      queryClient.setQueriesData(
        { queryKey: ["eformsign-documents"] },
        (old: unknown) => {
          if (!old || typeof old !== "object") return old;

          if ("pages" in old && Array.isArray((old as { pages: unknown[] }).pages)) {
            const infinite = old as {
              pages: EformsignDocumentsResponse[];
              pageParams: unknown[];
            };
            const nextPages = infinite.pages.map((page) => removeFromPage(page, documentId) ?? page);
            const changed = nextPages.some((p, i) => p !== infinite.pages[i]);
            if (!changed) return old;
            return { ...infinite, pages: nextPages };
          }

          if ("documents" in old) {
            return removeFromPage(old as EformsignDocumentsResponse, documentId) ?? old;
          }

          return old;
        }
      );
    },
    onSettled: async () => {
      await queryClient.invalidateQueries({
        queryKey: eformsignQueryKeys.documents(),
      });
    },
    // A permanent purge can have already written a durable local tombstone
    // before its vendor request or local cleanup reports an error. Do not
    // restore that pre-delete snapshot; the invalidated local list is the
    // source of truth for whether the document remains safely hidden.
  });
}

/** 미연결 계약서의 고객 등록 프리필 후보. documentId가 null이면 조회하지 않는다. */
export function useContractClientCandidate(documentId: string | null) {
  return useQuery({
    queryKey: eformsignQueryKeys.clientCandidate(documentId ?? ""),
    queryFn: () => eformsignApi.getDocumentClientCandidate(documentId!),
    enabled: documentId !== null,
    staleTime: 1000 * 60,
    refetchOnWindowFocus: false,
    retry: false,
  });
}
