'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
    removeById,
    restoreQueries,
    snapshotAndTransformQueries,
    type QuerySnapshot,
} from '@/lib/query/optimistic-list-cache';
import { messageTemplatesApi } from '../api/message-templates.api';
import { messageTemplateKeys } from './keys';
import type { MessageTemplate, PaginatedTemplates, CreateTemplateDto, UpdateTemplateDto } from '../types';

export function useMessageTemplates(page: number = 1, limit: number = 10) {
    return useQuery<PaginatedTemplates>({
        queryKey: messageTemplateKeys.list(page, limit),
        queryFn: () => messageTemplatesApi.list(page, limit).then(r => r.data),
        staleTime: 1000 * 60 * 5,
    });
}

export function useMessageTemplate(id: string) {
    return useQuery<MessageTemplate>({
        queryKey: messageTemplateKeys.detail(id),
        queryFn: () => messageTemplatesApi.getById(id).then(r => r.data),
        enabled: !!id,
    });
}

export function useCreateMessageTemplate() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: (dto: CreateTemplateDto) =>
            messageTemplatesApi.create(dto).then(r => r.data),
        onSuccess: async () => {
            await queryClient.invalidateQueries({ queryKey: messageTemplateKeys.all });
        },
    });
}

export function useUpdateMessageTemplate() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: ({ id, dto }: { id: string; dto: UpdateTemplateDto }) =>
            messageTemplatesApi.update(id, dto).then(r => r.data),
        onSuccess: async () => {
            await queryClient.invalidateQueries({ queryKey: messageTemplateKeys.all });
        },
    });
}

// Removes a template from a cached list. `PaginatedTemplates` is an array despite
// its name, so non-array shapes (e.g. detail caches) pass through unchanged.
function removeTemplateFromCacheData(current: unknown, id: string): unknown {
    if (!Array.isArray(current)) return current;
    return removeById(current as MessageTemplate[], id);
}

export function useDeleteMessageTemplate() {
    const queryClient = useQueryClient();

    return useMutation<unknown, Error, string, { previous: QuerySnapshot }>({
        mutationFn: (id: string) => messageTemplatesApi.delete(id),
        onMutate: async (id) => {
            // Scope to list keys so detail caches are never optimistically edited.
            const previous = await snapshotAndTransformQueries(
                queryClient,
                { queryKey: messageTemplateKeys.lists() },
                (current) => removeTemplateFromCacheData(current, id),
            );
            return { previous };
        },
        onError: (_error, _id, context) => {
            if (context?.previous) restoreQueries(queryClient, context.previous);
        },
        onSettled: async () => {
            await queryClient.invalidateQueries({ queryKey: messageTemplateKeys.all });
        },
    });
}
