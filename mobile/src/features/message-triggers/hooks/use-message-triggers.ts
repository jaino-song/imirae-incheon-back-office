"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
    removeById,
    restoreQueries,
    snapshotAndTransformQueries,
    type QuerySnapshot,
} from "@/lib/query/optimistic-list-cache";
import { messageTriggersApi } from "../api/message-triggers.api";
import { messageTriggerKeys } from "./keys";
import type {
    MessageLogRecord,
    MessageTriggerRule,
    CreateMessageTriggerRuleDto,
    TriggerEventType,
    TriggerRecipientType,
    TriggerTemplateCatalogItem,
    UpcomingMessageTriggerJob,
    UpdateMessageTriggerRuleDto,
} from "../types";

function normalizeArrayPayload<T>(payload: unknown): T[] {
    if (Array.isArray(payload)) {
        return payload as T[];
    }

    if (payload !== null && typeof payload === "object" && "data" in payload) {
        const nestedData = (payload as Record<string, unknown>).data;
        if (Array.isArray(nestedData)) {
            return nestedData as T[];
        }
    }

    return [];
}

function normalizeSinglePayload<T>(payload: unknown): T | null {
    if (payload !== null && typeof payload === "object" && "data" in payload) {
        const nestedData = (payload as Record<string, unknown>).data;
        if (nestedData !== null && typeof nestedData === "object") {
            return nestedData as T;
        }
    }

    if (payload !== null && typeof payload === "object") {
        return payload as T;
    }

    return null;
}

export function useMessageTriggerRules() {
    return useQuery<MessageTriggerRule[]>({
        queryKey: messageTriggerKeys.list(),
        queryFn: () =>
            messageTriggersApi.list().then((response) => normalizeArrayPayload<MessageTriggerRule>(response.data)),
    });
}

export function useMessageTriggerRule(id: string) {
    return useQuery<MessageTriggerRule | null>({
        queryKey: messageTriggerKeys.detail(id),
        queryFn: () =>
            messageTriggersApi
                .getById(id)
                .then((response) => normalizeSinglePayload<MessageTriggerRule>(response.data)),
        enabled: !!id,
    });
}

export function useMessageTriggerTemplates(params: {
    eventType?: TriggerEventType;
    recipientType?: TriggerRecipientType;
}) {
    return useQuery<TriggerTemplateCatalogItem[]>({
        queryKey: messageTriggerKeys.templates("sms", params.eventType, params.recipientType),
        queryFn: () =>
            messageTriggersApi
                .listTemplates(params)
                .then((response) => normalizeArrayPayload<TriggerTemplateCatalogItem>(response.data)),
    });
}

export function useUpcomingMessageTriggerJobs(limit = 200) {
    return useQuery<UpcomingMessageTriggerJob[]>({
        queryKey: messageTriggerKeys.upcoming(limit),
        queryFn: () =>
            messageTriggersApi
                .listUpcomingJobs(limit)
                .then((response) => normalizeArrayPayload<UpcomingMessageTriggerJob>(response.data)),
        staleTime: 0,
        refetchOnMount: "always",
        refetchInterval: (query) =>
            query.state.data?.some((job) => job.status === "processing") ? 1_000 : 5_000,
    });
}

export function useMessageHistory(limit = 200) {
    return useQuery<MessageLogRecord[]>({
        queryKey: messageTriggerKeys.history(limit),
        queryFn: () =>
            messageTriggersApi
                .listHistory(limit)
                .then((response) => normalizeArrayPayload<MessageLogRecord>(response.data)),
        staleTime: 0,
        refetchOnMount: "always",
        refetchInterval: 5_000,
    });
}

export function useCreateMessageTriggerRule() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: (dto: CreateMessageTriggerRuleDto) =>
            messageTriggersApi.create(dto).then((response) => response.data),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: messageTriggerKeys.all });
            queryClient.invalidateQueries({ queryKey: messageTriggerKeys.upcoming() });
        },
    });
}

export function useUpdateMessageTriggerRule() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: ({ id, dto }: { id: string; dto: UpdateMessageTriggerRuleDto }) =>
            messageTriggersApi.update(id, dto).then((response) => response.data),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: messageTriggerKeys.all });
            queryClient.invalidateQueries({ queryKey: messageTriggerKeys.upcoming() });
        },
    });
}

// Removes a rule from the cached rule list. Non-array shapes pass through unchanged.
function removeTriggerRuleFromCacheData(current: unknown, id: string): unknown {
    if (!Array.isArray(current)) return current;
    return removeById(current as MessageTriggerRule[], id);
}

export function useDeleteMessageTriggerRule() {
    const queryClient = useQueryClient();

    return useMutation<unknown, Error, string, { previous: QuerySnapshot }>({
        mutationFn: (id: string) => messageTriggersApi.delete(id),
        onMutate: async (id) => {
            // Must target the exact rule-list key, never `messageTriggerKeys.all`:
            // that broad prefix also matches upcoming jobs, history, templates and
            // detail caches, whose differently-shaped rows can carry the same `id`.
            const previous = await snapshotAndTransformQueries(
                queryClient,
                { queryKey: messageTriggerKeys.list() },
                (current) => removeTriggerRuleFromCacheData(current, id),
            );
            return { previous };
        },
        onError: (_error, _id, context) => {
            if (context?.previous) restoreQueries(queryClient, context.previous);
        },
        onSettled: () => {
            queryClient.invalidateQueries({ queryKey: messageTriggerKeys.all });
        },
    });
}

// Cancels a still-pending trigger job. On success the job drops out of the
// upcoming list and a canceled entry appears in history, so both queries need
// a refetch for the row to visibly move from one zone to the other.
export function useCancelMessageTriggerJob() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: (id: string) => messageTriggersApi.cancelJob(id).then((response) => response.data),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: messageTriggerKeys.upcoming() });
            queryClient.invalidateQueries({ queryKey: messageTriggerKeys.history() });
        },
    });
}
