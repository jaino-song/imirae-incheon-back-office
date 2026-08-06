import type { QueryClient, QueryFilters, QueryKey } from "@tanstack/react-query";

export type QuerySnapshot = ReadonlyArray<readonly [QueryKey, unknown]>;

/**
 * Cancels matching in-flight queries, snapshots every matching cache entry, then
 * applies `transform` to each one. The returned snapshot restores the exact
 * pre-mutation state via `restoreQueries`.
 *
 * The utility never infers list shape or entity identity — each caller supplies a
 * domain adapter that returns the value unchanged for shapes it does not handle.
 */
export async function snapshotAndTransformQueries(
    queryClient: QueryClient,
    filters: QueryFilters,
    transform: (current: unknown, queryKey: QueryKey) => unknown,
): Promise<QuerySnapshot> {
    await queryClient.cancelQueries(filters);

    const snapshot = queryClient.getQueriesData(filters);

    for (const [queryKey, current] of snapshot) {
        const next = transform(current, queryKey);
        if (!Object.is(next, current)) {
            queryClient.setQueryData(queryKey, next);
        }
    }

    return snapshot;
}

/** Restores each captured query key to its exact previous value. Never refetches. */
export function restoreQueries(queryClient: QueryClient, snapshot: QuerySnapshot): void {
    for (const [queryKey, previous] of snapshot) {
        queryClient.setQueryData(queryKey, previous);
    }
}

/**
 * Returns the original array reference when `id` is absent, so callers can treat
 * reference equality as "nothing was removed" and skip dependent updates such as
 * decrementing a paginated total.
 */
export function removeById<TItem extends { id: string | number }>(
    items: TItem[],
    id: TItem["id"],
): TItem[] {
    const index = items.findIndex((item) => item.id === id);
    if (index === -1) return items;

    return [...items.slice(0, index), ...items.slice(index + 1)];
}
