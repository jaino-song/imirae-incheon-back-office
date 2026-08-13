import { QueryClient } from "@tanstack/react-query";

import { clientQueryKeys } from "@/hooks/useClients";
import {
    removeById,
    restoreQueries,
    snapshotAndTransformQueries,
} from "@/lib/query/optimistic-list-cache";

type Client = { id: number; name: string };
type Paginated = {
    data: Client[];
    total: number;
    page: number;
    limit: number;
    totalPages: number;
};

// Mirrors the adapter + filter `useDeleteClient` applies in production.
const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === "object" && value !== null;

const isPaginated = (value: unknown): value is Paginated =>
    isRecord(value) && Array.isArray(value.data);

const removeClientFromCacheData = (currentData: unknown, id: number): unknown => {
    if (!currentData) return currentData;
    if (Array.isArray(currentData)) return removeById(currentData as Client[], id);

    if (isPaginated(currentData)) {
        const data = removeById(currentData.data, id);
        if (data === currentData.data) return currentData;
        const total = Math.max(0, currentData.total - 1);
        return {
            ...currentData,
            data,
            total,
            totalPages: currentData.limit > 0 ? Math.ceil(total / currentData.limit) : currentData.totalPages,
        };
    }

    return currentData;
};

function optimisticallyDeleteClient(queryClient: QueryClient, id: number) {
    return snapshotAndTransformQueries(
        queryClient,
        {
            queryKey: clientQueryKeys.all,
            predicate: (query) => query.queryKey[1] !== "detail",
        },
        (current) => removeClientFromCacheData(current, id),
    );
}

function paginated(data: Client[], total: number): Paginated {
    return { data, total, page: 1, limit: 10, totalPages: Math.ceil(total / 10) };
}

describe("mobile client optimistic delete", () => {
    const TARGET = 1;

    function seed() {
        const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
        const detail = { id: TARGET, name: "target" };

        // Every live client list family plus a detail cache that must not change.
        queryClient.setQueryData(clientQueryKeys.all, [
            { id: TARGET, name: "target" },
            { id: 2, name: "keep" },
        ]);
        queryClient.setQueryData(
            clientQueryKeys.list(1, 10),
            paginated([{ id: TARGET, name: "target" }, { id: 2, name: "keep" }], 2),
        );
        queryClient.setQueryData(
            [...clientQueryKeys.lists(), { scope: "all-pages", limit: 100 }],
            paginated([{ id: TARGET, name: "target" }, { id: 2, name: "keep" }], 2),
        );
        queryClient.setQueryData(clientQueryKeys.filtered("upcoming"), [
            { id: TARGET, name: "target" },
        ]);
        queryClient.setQueryData(clientQueryKeys.detail(TARGET), detail);

        return { queryClient, detail };
    }

    it("removes the client from the exact all-clients array, paginated, all-pages and filtered caches", async () => {
        const { queryClient, detail } = seed();

        await optimisticallyDeleteClient(queryClient, TARGET);

        expect(queryClient.getQueryData(clientQueryKeys.all)).toEqual([{ id: 2, name: "keep" }]);
        expect(queryClient.getQueryData(clientQueryKeys.list(1, 10))).toMatchObject({
            data: [{ id: 2, name: "keep" }],
            total: 1,
        });
        expect(
            queryClient.getQueryData([...clientQueryKeys.lists(), { scope: "all-pages", limit: 100 }]),
        ).toMatchObject({ data: [{ id: 2, name: "keep" }], total: 1 });
        expect(queryClient.getQueryData(clientQueryKeys.filtered("upcoming"))).toEqual([]);
        expect(queryClient.getQueryData(clientQueryKeys.detail(TARGET))).toBe(detail);
    });

    it("leaves totals untouched on a cached page that never contained the client", async () => {
        const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
        const untouched = paginated([{ id: 9, name: "elsewhere" }], 25);
        queryClient.setQueryData(clientQueryKeys.list(2, 10), untouched);

        await optimisticallyDeleteClient(queryClient, TARGET);

        expect(queryClient.getQueryData(clientQueryKeys.list(2, 10))).toBe(untouched);
    });

    it("never drives a total below zero", async () => {
        const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
        queryClient.setQueryData(clientQueryKeys.list(1, 10), paginated([{ id: TARGET, name: "t" }], 0));

        await optimisticallyDeleteClient(queryClient, TARGET);

        expect(queryClient.getQueryData<Paginated>(clientQueryKeys.list(1, 10))?.total).toBe(0);
    });

    it("restores every transformed list cache on failure", async () => {
        const { queryClient } = seed();

        const previous = await optimisticallyDeleteClient(queryClient, TARGET);
        restoreQueries(queryClient, previous);

        expect(queryClient.getQueryData(clientQueryKeys.all)).toEqual([
            { id: TARGET, name: "target" },
            { id: 2, name: "keep" },
        ]);
        expect(queryClient.getQueryData(clientQueryKeys.list(1, 10))).toMatchObject({ total: 2 });
        expect(queryClient.getQueryData(clientQueryKeys.filtered("upcoming"))).toEqual([
            { id: TARGET, name: "target" },
        ]);
    });
});
