"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { getStatusCategory, isDeletedStatusCode, DocumentFilterType } from "@/lib/eformsign/status-codes";
import { IS_DEVELOPMENT } from "@/lib/env";
import { EformsignDocumentsResponse, EformsignDocument } from "@/lib/eformsign/types";
import { eformsignApi, withEformsignReauth } from "@/services/api";

// Re-export types for convenience
export type { DocumentFilterType } from "@/lib/eformsign/status-codes";

// Debug logging (only in development)
const isDev = IS_DEVELOPMENT;
const debugLog = isDev ? console.log.bind(console) : () => {};

// Filter documents by actual status code (not just inbox type)
function filterByActualStatus(docs: EformsignDocument[], type: DocumentFilterType): EformsignDocument[] {
  const visibleDocs = docs.filter((doc) => !isDeletedStatusCode(doc.current_status?.status_type));
  if (type === null) return visibleDocs;
  const category = type === "rejected" ? "expired" : type;
  return visibleDocs.filter(doc => getStatusCategory(doc.current_status?.status_type) === category);
}

// Query keys
export const eformsignQueryKeys = {
  documents: () => ["eformsign-documents"] as const,
  documentsByType: (type: string) => ["eformsign-documents", type] as const,
  allDocuments: () => ["eformsign-documents", "all"] as const,
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
        case "rejected":
          response = await eformsignApi.getRejectedDocuments();
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
  });
}

export function useDeleteEformsignDocument() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (documentId: string) =>
      withEformsignReauth(() => eformsignApi.deleteDocument(documentId)),
    onMutate: async (documentId: string) => {
      await queryClient.cancelQueries({ queryKey: ["eformsign-documents"] });

      const previousQueries = queryClient.getQueriesData<EformsignDocumentsResponse>({
        queryKey: ["eformsign-documents"],
      });

      queryClient.setQueriesData<EformsignDocumentsResponse>(
        { queryKey: ["eformsign-documents"] },
        (old) => old ? {
          ...old,
          documents: (old.documents || []).filter((d) => d.id !== documentId),
          total_rows: Math.max(0, (old.total_rows || 0) - 1),
        } : old,
      );

      return { previousQueries };
    },
    onError: (_err, _id, context) => {
      context?.previousQueries?.forEach(([queryKey, data]) => {
        queryClient.setQueryData(queryKey, data);
      });
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["eformsign-documents"] });
    },
  });
}
