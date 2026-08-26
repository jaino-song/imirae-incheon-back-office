"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api/client";
import { 
    MessageTemplate, 
    CreateMessageTemplateRequest, 
    UpdateMessageTemplateRequest 
} from "@/lib/template/types";

const normalizeTemplateList = (payload: unknown): MessageTemplate[] => {
    if (Array.isArray(payload)) {
        return payload;
    }

    if (payload && typeof payload === "object") {
        const nestedList = (payload as { data?: unknown }).data;
        if (Array.isArray(nestedList)) {
            return nestedList;
        }
    }

    return [];
};

export const templateQueryKeys = {
    all: ["message-templates"] as const,
    lists: () => [...templateQueryKeys.all, "list"] as const,
    details: () => [...templateQueryKeys.all, "detail"] as const,
    detail: (id: string) => [...templateQueryKeys.details(), id] as const,
};

export function useMessageTemplates() {
    return useQuery<MessageTemplate[]>({
        queryKey: templateQueryKeys.lists(),
        queryFn: async () => {
            const { data } = await api.get("/message-templates");
            return normalizeTemplateList(data);
        },
        staleTime: 1000 * 60 * 5,
    });
}

export function useMessageTemplate(id: string) {
    return useQuery<MessageTemplate>({
        queryKey: templateQueryKeys.detail(id),
        queryFn: async () => {
            const { data } = await api.get(`/message-templates/${id}`);
            return data;
        },
        enabled: !!id,
    });
}

export function useCreateMessageTemplate() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: async (request: CreateMessageTemplateRequest) => {
            const { data } = await api.post("/message-templates", request);
            return data as MessageTemplate;
        },
        onSuccess: async () => {
            await queryClient.invalidateQueries({ queryKey: templateQueryKeys.all });
        },
    });
}

export function useUpdateMessageTemplate() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: async ({ id, request }: { id: string; request: UpdateMessageTemplateRequest }) => {
            const { data } = await api.patch(`/message-templates/${id}`, request);
            return data as MessageTemplate;
        },
        onSuccess: async (_, variables) => {
            await Promise.all([
                queryClient.invalidateQueries({ queryKey: templateQueryKeys.all }),
                queryClient.invalidateQueries({ queryKey: templateQueryKeys.detail(variables.id) }),
            ]);
        },
    });
}

export function useDeleteMessageTemplate() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: async (id: string) => {
            await api.delete(`/message-templates/${id}`);
        },
        onSuccess: async () => {
            await queryClient.invalidateQueries({ queryKey: templateQueryKeys.all });
        },
    });
}
