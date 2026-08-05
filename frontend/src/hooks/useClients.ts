"use client";

import { useInfiniteQuery, useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api/client";
import { messageTriggerKeys } from "@/features/message-triggers/hooks/keys";
import {
    removeById,
    restoreQueries,
    snapshotAndTransformQueries,
    type QuerySnapshot,
} from "@/lib/query/optimistic-list-cache";
import type {
    Client,
    CreateClientDto,
    UpdateClientDto,
    PaginatedResponse
} from "@/lib/client/types";

type InfiniteClientPages = {
    pages: PaginatedResponse<Client>[];
    pageParams: unknown[];
};

// Query keys - using factory pattern for proper invalidation
export const clientQueryKeys = {
    all: ["clients"] as const,
    lists: () => [...clientQueryKeys.all, "list"] as const,
    list: (page?: number, limit?: number, search?: string) => 
        [...clientQueryKeys.lists(), { page, limit, search }] as const,
    infiniteList: (limit?: number, search?: string) =>
        [...clientQueryKeys.lists(), "infinite", { limit, search }] as const,
    filtered: (filter: string) => [...clientQueryKeys.all, "filtered", filter] as const,
    details: () => [...clientQueryKeys.all, "detail"] as const,
    detail: (id: number) => [...clientQueryKeys.details(), id] as const,
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === "object" && value !== null;

const isClientRecord = (value: unknown): value is Client =>
    isRecord(value) && typeof value.id === "number";

const isPaginatedClientResponse = (value: unknown): value is PaginatedResponse<Client> =>
    isRecord(value) && Array.isArray(value.data);

const isInfiniteClientPages = (value: unknown): value is InfiniteClientPages =>
    isRecord(value) && Array.isArray(value.pages);

const mergeUpdatedClient = (client: Client, updatedClient: Client): Client =>
    client.id === updatedClient.id ? { ...client, ...updatedClient } : client;

const mergeUpdatedClientList = (clients: Client[], updatedClient: Client): Client[] =>
    clients.map((client) => mergeUpdatedClient(client, updatedClient));

const updateClientCacheData = (currentData: unknown, updatedClient: Client): unknown => {
    if (!currentData) return currentData;

    if (Array.isArray(currentData)) {
        return mergeUpdatedClientList(currentData, updatedClient);
    }

    if (isInfiniteClientPages(currentData)) {
        return {
            ...currentData,
            pages: currentData.pages.map((page) => ({
                ...page,
                data: mergeUpdatedClientList(page.data, updatedClient),
            })),
        };
    }

    if (isPaginatedClientResponse(currentData)) {
        return {
            ...currentData,
            data: mergeUpdatedClientList(currentData.data, updatedClient),
        };
    }

    if (isClientRecord(currentData)) {
        return mergeUpdatedClient(currentData, updatedClient);
    }

    return currentData;
};

// Fetch all clients (paginated)
export function useClients(page: number = 1, limit: number = 10, search?: string) {
    return useQuery<PaginatedResponse<Client>>({
        queryKey: clientQueryKeys.list(page, limit, search),
        queryFn: async () => {
            const params = new URLSearchParams();
            params.set("page", String(page));
            params.set("limit", String(limit));
            if (search) params.set("search", search);
            
            const { data } = await api.get(`/clients?${params.toString()}`);
            return data;
        },
        staleTime: 1000 * 60 * 5, // 5 minutes
    });
}

export function useInfiniteClients(limit: number = 10, search?: string) {
    return useInfiniteQuery<PaginatedResponse<Client>, Error>({
        queryKey: clientQueryKeys.infiniteList(limit, search),
        initialPageParam: 1,
        queryFn: async ({ pageParam }) => {
            const params = new URLSearchParams();
            params.set("page", String(pageParam));
            params.set("limit", String(limit));
            if (search) params.set("search", search);

            const { data } = await api.get(`/clients?${params.toString()}`);
            return data;
        },
        getNextPageParam: (lastPage) =>
            lastPage.page < lastPage.totalPages ? lastPage.page + 1 : undefined,
        staleTime: 1000 * 60 * 5,
    });
}

// Fetch all clients (non-paginated, for dropdowns)
export function useAllClients() {
    return useQuery<Client[]>({
        queryKey: clientQueryKeys.all,
        queryFn: async () => {
            const { data } = await api.get("/clients");
            return data;
        },
        staleTime: 1000 * 60 * 5,
    });
}

// Fetch single client by ID
export function useClient(id: number) {
    return useQuery<Client>({
        queryKey: clientQueryKeys.detail(id),
        queryFn: async () => {
            const { data } = await api.get(`/clients/${id}`);
            return data;
        },
        enabled: !!id,
    });
}

// Fetch filtered clients
export function useFilteredClients(filter: string) {
    return useQuery<Client[]>({
        queryKey: clientQueryKeys.filtered(filter),
        queryFn: async () => {
            const { data } = await api.get(`/clients?filter=${filter}`);
            return data;
        },
        enabled: !!filter,
        staleTime: 1000 * 60,
    });
}

// Create client mutation
export function useCreateClient() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: async (dto: CreateClientDto) => {
            const { data } = await api.post("/clients", dto);
            return data as Client;
        },
        onSuccess: async () => {
            // Invalidate all client queries (lists + details) using prefix match
            await queryClient.invalidateQueries({ queryKey: clientQueryKeys.all });
        },
    });
}

// Update client mutation
export function useUpdateClient() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: async ({ id, dto }: { id: number; dto: UpdateClientDto }) => {
            const { data } = await api.patch(`/clients/${id}`, dto);
            return data as Client;
        },
        onSuccess: async (updatedClient, variables) => {
            queryClient.setQueriesData(
                { queryKey: clientQueryKeys.all },
                (currentData) => updateClientCacheData(currentData, updatedClient)
            );
            queryClient.setQueryData(clientQueryKeys.detail(variables.id), updatedClient);

            await queryClient.invalidateQueries({ queryKey: clientQueryKeys.all });
        },
    });
}

// Removes a client from one paginated page, adjusting the count only when the
// client was actually present. Returns the original page when nothing changed.
const removeClientFromPage = (
    page: PaginatedResponse<Client>,
    id: number,
): PaginatedResponse<Client> => {
    const data = removeById(page.data, id);
    if (data === page.data) return page;

    const total = Math.max(0, page.total - 1);
    return {
        ...page,
        data,
        total,
        totalPages: page.limit > 0 ? Math.ceil(total / page.limit) : page.totalPages,
    };
};

const removeClientFromCacheData = (currentData: unknown, id: number): unknown => {
    if (!currentData) return currentData;

    if (Array.isArray(currentData)) {
        return removeById(currentData as Client[], id);
    }

    if (isInfiniteClientPages(currentData)) {
        // `total` is a global result count repeated on every page, so decrement it
        // once and write the corrected value to all pages.
        const removedIndex = currentData.pages.findIndex((page) =>
            page.data.some((client) => client.id === id),
        );
        if (removedIndex === -1) return currentData;

        const source = currentData.pages[removedIndex];
        const total = Math.max(0, source.total - 1);

        return {
            ...currentData,
            pages: currentData.pages.map((page, index) => ({
                ...page,
                data: index === removedIndex ? removeById(page.data, id) : page.data,
                total,
                totalPages: page.limit > 0 ? Math.ceil(total / page.limit) : page.totalPages,
            })),
        };
    }

    if (isPaginatedClientResponse(currentData)) {
        return removeClientFromPage(currentData, id);
    }

    return currentData;
};

// Delete client mutation
export function useDeleteClient() {
    const queryClient = useQueryClient();

    return useMutation<void, Error, number, { previous: QuerySnapshot }>({
        mutationFn: async (id: number) => {
            await api.delete(`/clients/${id}`);
        },
        onMutate: async (id) => {
            // Covers the exact all-clients array, paginated lists, the infinite
            // list and filtered arrays, while excluding detail caches.
            const previous = await snapshotAndTransformQueries(
                queryClient,
                {
                    queryKey: clientQueryKeys.all,
                    predicate: (query) => query.queryKey[1] !== "detail",
                },
                (current) => removeClientFromCacheData(current, id),
            );
            return { previous };
        },
        onError: (_error, _id, context) => {
            if (context?.previous) restoreQueries(queryClient, context.previous);
        },
        onSettled: async () => {
            // Invalidate all client queries (lists + details) using prefix match
            await queryClient.invalidateQueries({ queryKey: clientQueryKeys.all });
            // Backend client deletion also cancels that client's pending jobs.
            await queryClient.invalidateQueries({ queryKey: messageTriggerKeys.upcoming() });
        },
    });
}
