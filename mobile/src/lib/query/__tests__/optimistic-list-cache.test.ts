import { QueryClient } from "@tanstack/react-query";

import {
    removeById,
    restoreQueries,
    snapshotAndTransformQueries,
} from "@/lib/query/optimistic-list-cache";

type Row = { id: number; name: string };

function createQueryClient(): QueryClient {
    return new QueryClient({
        defaultOptions: { queries: { retry: false } },
    });
}

describe("removeById", () => {
    it("returns the original array reference when the id is absent", () => {
        const items: Row[] = [{ id: 1, name: "a" }];
        expect(removeById(items, 2)).toBe(items);
    });

    it("returns a new array with only the matching item removed", () => {
        const items: Row[] = [
            { id: 1, name: "a" },
            { id: 2, name: "b" },
            { id: 3, name: "c" },
        ];
        const next = removeById(items, 2);

        expect(next).not.toBe(items);
        expect(next.map((item) => item.id)).toEqual([1, 3]);
        expect(items).toHaveLength(3);
    });

    it("supports string identifiers", () => {
        const items = [{ id: "x" }, { id: "y" }];
        expect(removeById(items, "x").map((item) => item.id)).toEqual(["y"]);
    });
});

describe("snapshotAndTransformQueries", () => {
    it("transforms every matching query and leaves non-matching ones untouched", async () => {
        const queryClient = createQueryClient();
        queryClient.setQueryData(["rows", "list", { page: 1 }], [{ id: 1 }, { id: 2 }]);
        queryClient.setQueryData(["rows", "list", { page: 2 }], [{ id: 2 }, { id: 3 }]);
        const untouched = [{ id: 2 }];
        queryClient.setQueryData(["other"], untouched);

        await snapshotAndTransformQueries(
            queryClient,
            { queryKey: ["rows", "list"] },
            (current) => (Array.isArray(current) ? removeById(current as Row[], 2) : current),
        );

        expect(queryClient.getQueryData(["rows", "list", { page: 1 }])).toEqual([{ id: 1 }]);
        expect(queryClient.getQueryData(["rows", "list", { page: 2 }])).toEqual([{ id: 3 }]);
        expect(queryClient.getQueryData(["other"])).toBe(untouched);
    });

    it("cancels matching in-flight queries before reading cache state", async () => {
        const queryClient = createQueryClient();
        const cancelQueries = jest.spyOn(queryClient, "cancelQueries");
        const getQueriesData = jest.spyOn(queryClient, "getQueriesData");

        await snapshotAndTransformQueries(queryClient, { queryKey: ["rows"] }, (current) => current);

        expect(cancelQueries).toHaveBeenCalled();
        expect(cancelQueries.mock.invocationCallOrder[0]).toBeLessThan(
            getQueriesData.mock.invocationCallOrder[0],
        );
    });

    it("does not write when the transform returns the same reference", async () => {
        const queryClient = createQueryClient();
        queryClient.setQueryData(["rows", "list"], [{ id: 1 }]);
        const setQueryData = jest.spyOn(queryClient, "setQueryData");

        await snapshotAndTransformQueries(
            queryClient,
            { queryKey: ["rows", "list"] },
            (current) => current,
        );

        expect(setQueryData).not.toHaveBeenCalled();
    });

    it("captures a snapshot that restoreQueries returns to exactly", async () => {
        const queryClient = createQueryClient();
        const original = [{ id: 1 }, { id: 2 }];
        queryClient.setQueryData(["rows", "list"], original);

        const snapshot = await snapshotAndTransformQueries(
            queryClient,
            { queryKey: ["rows", "list"] },
            (current) => (Array.isArray(current) ? removeById(current as Row[], 1) : current),
        );
        expect(queryClient.getQueryData(["rows", "list"])).toEqual([{ id: 2 }]);

        restoreQueries(queryClient, snapshot);

        // TanStack applies structural sharing on write, so the restored value is
        // deep-equal rather than reference-equal to the captured snapshot.
        expect(queryClient.getQueryData(["rows", "list"])).toEqual(original);
    });
});
