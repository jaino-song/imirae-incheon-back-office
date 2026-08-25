"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api/client";
import {
    removeById,
    restoreQueries,
    snapshotAndTransformQueries,
    type QuerySnapshot,
} from "@/lib/query/optimistic-list-cache";
import {
    DEFAULT_DOCUMENT_UPLOAD_CAPABILITIES,
    type DocumentVisibilityScope,
    type DocumentUploadCapabilities,
} from "@babyjamjam/shared/file-storage";

export interface Document {
    id: string;
    name: string;
    description?: string | null;
    categoryId: string;
    categoryLabel?: string | null;
    tags: string[];
    mimeType: string;
    fileSize: number;
    storagePath: string;
    storageUrl?: string | null;
    orgId?: string | null;
    uploadedBy: string;
    createdAt: string;
    updatedAt: string;
    visibilityScope: "branch" | "all_branches";
    canManage: boolean;
}

// orgId/uploadedBy are deliberately absent: the backend derives both from the
// JWT (@CurrentTenant), and the proxy strips them — sending them would only
// earn a 400 from the backend's forbidNonWhitelisted pipe.
export interface UploadDocumentParams {
    file: File;
    name?: string;
    description?: string;
    categoryId: string;
    tags?: string[];
    visibilityScope: DocumentVisibilityScope;
    onProgress?: (progress: number) => void;
}

export interface UpdateDocumentParams {
    name?: string;
    description?: string;
    categoryId?: string;
    tags?: string[];
}

// Query key factory pattern
export const documentQueryKeys = {
    all: ["documents"] as const,
    lists: () => [...documentQueryKeys.all, "list"] as const,
    list: (filters: Record<string, unknown>) => [...documentQueryKeys.lists(), filters] as const,
    details: () => [...documentQueryKeys.all, "detail"] as const,
    detail: (id: string) => [...documentQueryKeys.details(), id] as const,
    capabilities: () => [...documentQueryKeys.all, "upload-capabilities"] as const,
};

export function useDocumentUploadCapabilities() {
    return useQuery<DocumentUploadCapabilities>({
        queryKey: documentQueryKeys.capabilities(),
        queryFn: async () => {
            const { data } = await api.get<DocumentUploadCapabilities>("/file-storage/capabilities");
            return data;
        },
        placeholderData: DEFAULT_DOCUMENT_UPLOAD_CAPABILITIES,
        staleTime: 1000 * 60 * 5,
    });
}

export function useDocuments(categoryId?: string) {
    return useQuery<Document[]>({
        queryKey: documentQueryKeys.list({ categoryId }),
        queryFn: async () => {
            const params = new URLSearchParams();
            if (categoryId) params.append("categoryId", categoryId);
            const url = `/file-storage/files${params.toString() ? `?${params.toString()}` : ""}`;
            const { data } = await api.get<Document[]>(url);
            return data;
        },
        staleTime: 1000 * 60 * 5,
    });
}

/**
 * Hook to fetch a single document by id
 */
export function useDocument(id: string) {
    return useQuery<Document>({
        queryKey: documentQueryKeys.detail(id),
        queryFn: async () => {
            const { data } = await api.get<Document>(`/file-storage/files/${id}`);
            return data;
        },
        enabled: !!id,
        staleTime: 1000 * 60 * 10, // 10 minutes
    });
}

export function useUploadDocument() {
    const queryClient = useQueryClient();

    return useMutation<Document, Error, UploadDocumentParams>({
        mutationFn: async ({
            file,
            name,
            description,
            categoryId,
            tags,
            visibilityScope,
            onProgress,
        }: UploadDocumentParams) => {
            const formData = new FormData();
            formData.append("file", file);
            if (name) formData.append("name", name);
            if (description) formData.append("description", description);
            formData.append("categoryId", categoryId);
            formData.append("visibilityScope", visibilityScope);
            if (tags) formData.append("tags", JSON.stringify(tags));

            const { data } = await api.post<Document>("/file-storage/files", formData, {
                onUploadProgress: (progressEvent) => {
                    if (onProgress && progressEvent.total) {
                        const progress = Math.round((progressEvent.loaded * 100) / progressEvent.total);
                        onProgress(progress);
                    }
                },
            });
            return data;
        },
        onSuccess: async () => {
            await queryClient.invalidateQueries({ queryKey: documentQueryKeys.all });
        },
        onError: (error) => {
            console.error("[useUploadDocument] onError called:", error);
        },
    });
}

/**
 * Hook to update document metadata
 */
export function useUpdateDocument() {
    const queryClient = useQueryClient();

    return useMutation<Document, Error, { id: string } & UpdateDocumentParams>({
        mutationFn: async ({ id, ...params }: { id: string } & UpdateDocumentParams) => {
            const { data } = await api.put<Document>(`/file-storage/files/${id}`, params);
            return data;
        },
        onSuccess: async (data) => {
            await queryClient.invalidateQueries({ queryKey: documentQueryKeys.all });
            await queryClient.invalidateQueries({ queryKey: documentQueryKeys.detail(data.id) });
        },
        onError: (error) => {
            console.error("[useUpdateDocument] onError called:", error);
        },
    });
}

// Removes a document from a cached list. Non-list shapes pass through unchanged.
function removeDocumentFromCacheData(current: unknown, id: string): unknown {
    if (!Array.isArray(current)) return current;
    return removeById(current as Document[], id);
}

/**
 * Hook to delete a document
 */
export function useDeleteDocument() {
     const queryClient = useQueryClient();

     return useMutation<string, Error, string, { previous: QuerySnapshot }>({
         mutationFn: async (id: string) => {
             await api.delete(`/file-storage/files/${id}`);
             return id;
         },
         onMutate: async (id) => {
             // Scope to list keys so detail caches are never optimistically edited.
             // Every per-categoryId list variant lives under this prefix.
             const previous = await snapshotAndTransformQueries(
                 queryClient,
                 { queryKey: documentQueryKeys.lists() },
                 (current) => removeDocumentFromCacheData(current, id),
             );
             return { previous };
         },
         onError: (error, _id, context) => {
             if (context?.previous) restoreQueries(queryClient, context.previous);
             console.error("[useDeleteDocument] onError called:", error);
         },
         onSettled: async () => {
             await queryClient.invalidateQueries({ queryKey: documentQueryKeys.all });
         },
     });
}

/**
 * Get the download URL for a document (proxied through Next.js API)
 * @param id - document ID
 * @param attachment - if true, browser will download instead of preview
 */
export function getDownloadUrl(id: string, attachment?: boolean): string {
     const base = `/api/file-storage/files/${id}/download`;
     return attachment ? `${base}?attachment=true` : base;
}
