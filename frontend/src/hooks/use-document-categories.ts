"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api/client";

export interface DocumentCategory {
    id: string;
    value: string;
    label: string;
    color: string;
    isCustom: boolean;
    createdAt: string;
}

export const documentCategoryQueryKeys = {
    all: ["document-categories"] as const,
};

export function useDocumentCategories() {
    return useQuery<DocumentCategory[]>({
        queryKey: documentCategoryQueryKeys.all,
        queryFn: async () => {
            const { data } = await api.get<DocumentCategory[]>("/document-categories");
            return data;
        },
        staleTime: 1000 * 60 * 10,
    });
}

export function useCreateDocumentCategory() {
    const queryClient = useQueryClient();

    return useMutation<DocumentCategory, Error, { value: string; label: string; color: string }>({
        mutationFn: async (params) => {
            const { data } = await api.post<DocumentCategory>("/document-categories", params);
            return data;
        },
        onSuccess: async () => {
            await queryClient.invalidateQueries({ queryKey: documentCategoryQueryKeys.all });
        },
    });
}
