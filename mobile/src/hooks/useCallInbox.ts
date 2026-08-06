import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api } from "@/lib/api/client";
import { clientQueryKeys } from "@/hooks/useClients";
import type {
    CallCategory,
    CallRecordDetail,
    CallRecordListItem,
    ClientDraftDetail,
    ClientDraftListItem,
    ConfirmDraftBody,
    ConfirmUpdateBody,
    Paginated,
    Proposal,
} from "@/lib/call-inbox/types";

/**
 * How much one round trip fetches. Not how much the list shows — the page
 * reveals rows a screenful at a time and pulls the next page when it runs out.
 */
const PAGE_SIZE = 20;

export const callInboxKeys = {
    all: ["call-inbox"] as const,
    // The page number is not part of the key: every page of one filter belongs
    // to a single infinite query, so a refetch reloads the whole loaded list.
    records: (category?: string, search?: string) =>
        [...callInboxKeys.all, "records", category ?? "", search ?? ""] as const,
    record: (id: string) => [...callInboxKeys.all, "record", id] as const,
    drafts: (status: string) => [...callInboxKeys.all, "drafts", status] as const,
    draft: (id: string) => [...callInboxKeys.all, "draft", id] as const,
    count: () => [...callInboxKeys.all, "count"] as const,
};

function nextPageParam<T>(lastPage: Paginated<T>): number | undefined {
    return lastPage.page < lastPage.totalPages ? lastPage.page + 1 : undefined;
}

export function useCallRecords(category?: CallCategory, search?: string) {
    return useInfiniteQuery({
        queryKey: callInboxKeys.records(category, search),
        queryFn: async ({ pageParam }) => {
            const params = new URLSearchParams({
                page: String(pageParam),
                limit: String(PAGE_SIZE),
            });
            if (category) params.set("category", category);
            if (search) params.set("search", search);
            const { data } = await api.get(`/call-records?${params.toString()}`);
            return data as Paginated<CallRecordListItem>;
        },
        initialPageParam: 1,
        getNextPageParam: nextPageParam,
        staleTime: 1000 * 30,
    });
}

export function useCallRecord(id: string | null) {
    return useQuery<CallRecordDetail>({
        queryKey: callInboxKeys.record(id ?? ""),
        queryFn: async () => {
            const { data } = await api.get(`/call-records/${id}`);
            return data;
        },
        enabled: id !== null,
    });
}

export function useClientDrafts(status: string = "PENDING") {
    return useInfiniteQuery({
        queryKey: callInboxKeys.drafts(status),
        queryFn: async ({ pageParam }) => {
            const { data } = await api.get(
                `/client-drafts?status=${status}&page=${pageParam}&limit=${PAGE_SIZE}`,
            );
            return data as Paginated<ClientDraftListItem>;
        },
        initialPageParam: 1,
        getNextPageParam: nextPageParam,
        staleTime: 1000 * 30,
    });
}

export function usePendingDraftCount() {
    return useQuery<{ count: number }>({
        queryKey: callInboxKeys.count(),
        queryFn: async () => {
            const { data } = await api.get("/client-drafts/count?status=PENDING");
            return data;
        },
        staleTime: 1000 * 60,
        refetchInterval: 1000 * 60,
    });
}

export function useClientDraft(id: string | null) {
    return useQuery<ClientDraftDetail>({
        queryKey: callInboxKeys.draft(id ?? ""),
        queryFn: async () => {
            const { data } = await api.get(`/client-drafts/${id}`);
            return data;
        },
        enabled: id !== null,
    });
}

export function usePatchDraft(id: string) {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: async (body: { proposals?: Proposal[]; clientId?: number | null }) => {
            const { data } = await api.patch(`/client-drafts/${id}`, body);
            return data as ClientDraftDetail;
        },
        onSuccess: () => queryClient.invalidateQueries({ queryKey: callInboxKeys.all }),
    });
}

export function useConfirmDraft(id: string) {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: async (body: ConfirmDraftBody | ConfirmUpdateBody) => {
            const { data } = await api.post(`/client-drafts/${id}/confirm`, body);
            return data as { clientId: number };
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: callInboxKeys.all });
            queryClient.invalidateQueries({ queryKey: clientQueryKeys.all });
        },
    });
}

export function useDiscardDraft(id: string) {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: async (body: { reason?: string }) => {
            const { data } = await api.post(`/client-drafts/${id}/discard`, body);
            return data as { id: string; status: "DISCARDED" };
        },
        onSuccess: () => queryClient.invalidateQueries({ queryKey: callInboxKeys.all }),
    });
}
