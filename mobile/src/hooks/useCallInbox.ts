import { useMemo } from "react";
import {
    keepPreviousData,
    useInfiniteQuery,
    useMutation,
    useQuery,
    useQueryClient,
} from "@tanstack/react-query";

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

/**
 * Offset pagination is only coherent against a list that holds still. A call
 * landing between two page requests shifts every later row down, so page 2 can
 * repeat a row page 1 already showed — de-duplicating by id keeps React keys
 * unique. The offsets themselves still come from the raw page numbers.
 * `useInfiniteContracts` paginates the same way and does the same thing.
 *
 * The count comes from the newest page: the first one was fetched earliest and
 * is the most likely to be stale.
 */
function flattenPages<T extends { id: string }>(pages: Paginated<T>[] | undefined) {
    const seen = new Set<string>();
    const items: T[] = [];

    for (const page of pages ?? []) {
        for (const item of page.data ?? []) {
            if (seen.has(item.id)) continue;
            seen.add(item.id);
            items.push(item);
        }
    }

    return { items, total: pages?.length ? pages[pages.length - 1].total : items.length };
}

export function useCallRecords(category?: CallCategory, search?: string) {
    const query = useInfiniteQuery({
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
        // The category and search terms are part of the key, so changing either
        // starts a fresh query. Without this the list the user is reading gets
        // replaced by a loading skeleton on every keystroke; the other list
        // pages filter in memory and never blank out. Holding the previous
        // results keeps isLoading false, so only the first visit shows one.
        placeholderData: keepPreviousData,
    });

    const pages = query.data?.pages;
    const { items, total } = useMemo(() => flattenPages(pages), [pages]);

    return {
        ...query,
        /** Every record loaded so far, in server order, de-duplicated by id. */
        records: items,
        /** Records matching the active filters on the server, per the newest page. */
        total,
        /** A "load more" failed; the rows already loaded stay on screen. */
        isLoadMoreError: query.isFetchNextPageError,
    };
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
    const query = useInfiniteQuery({
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

    const pages = query.data?.pages;
    const { items, total } = useMemo(() => flattenPages(pages), [pages]);

    return {
        ...query,
        /** Every draft loaded so far, in server order, de-duplicated by id. */
        drafts: items,
        /** Drafts in this status on the server, per the newest page. */
        total,
        /** A "load more" failed; the rows already loaded stay on screen. */
        isLoadMoreError: query.isFetchNextPageError,
    };
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
