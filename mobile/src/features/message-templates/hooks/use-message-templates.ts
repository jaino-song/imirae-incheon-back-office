'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
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

export function useDeleteMessageTemplate() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: (id: string) => messageTemplatesApi.delete(id),
        onSuccess: async () => {
            await queryClient.invalidateQueries({ queryKey: messageTemplateKeys.all });
        },
    });
}
