import { QueryClient } from "@tanstack/react-query";

import { messageTriggerKeys } from "./keys";
import { restoreQueries, snapshotAndTransformQueries, removeById } from "@/lib/query/optimistic-list-cache";

// Mirrors the adapter + filter that `useDeleteMessageTriggerRule` applies, so the
// isolation guarantee is asserted against the exact key it uses in production.
function removeTriggerRuleFromCacheData(current: unknown, id: string): unknown {
    if (!Array.isArray(current)) return current;
    return removeById(current as { id: string }[], id);
}

function optimisticallyDeleteRule(queryClient: QueryClient, id: string) {
    return snapshotAndTransformQueries(
        queryClient,
        { queryKey: messageTriggerKeys.list() },
        (current) => removeTriggerRuleFromCacheData(current, id),
    );
}

describe("message trigger rule optimistic delete", () => {
    const SHARED_ID = "shared-id";

    function seed() {
        const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
        const upcoming = [{ id: SHARED_ID, kind: "job" }];
        const history = [{ id: SHARED_ID, kind: "log" }];
        const templates = [{ id: SHARED_ID, kind: "template" }];
        const detail = { id: SHARED_ID, kind: "rule-detail" };

        queryClient.setQueryData(messageTriggerKeys.list(), [
            { id: SHARED_ID, name: "rule" },
            { id: "other", name: "keep" },
        ]);
        queryClient.setQueryData(messageTriggerKeys.upcoming(), upcoming);
        queryClient.setQueryData(messageTriggerKeys.history(), history);
        queryClient.setQueryData(messageTriggerKeys.templates("aligo"), templates);
        queryClient.setQueryData(messageTriggerKeys.detail(SHARED_ID), detail);

        return { queryClient, upcoming, history, templates, detail };
    }

    it("removes the rule without touching upcoming, history, template or detail caches", async () => {
        const { queryClient, upcoming, history, templates, detail } = seed();

        await optimisticallyDeleteRule(queryClient, SHARED_ID);

        expect(queryClient.getQueryData(messageTriggerKeys.list())).toEqual([
            { id: "other", name: "keep" },
        ]);
        // A broad `messageTriggerKeys.all` filter would have stripped SHARED_ID
        // from each of these too.
        expect(queryClient.getQueryData(messageTriggerKeys.upcoming())).toBe(upcoming);
        expect(queryClient.getQueryData(messageTriggerKeys.history())).toBe(history);
        expect(queryClient.getQueryData(messageTriggerKeys.templates("aligo"))).toBe(templates);
        expect(queryClient.getQueryData(messageTriggerKeys.detail(SHARED_ID))).toBe(detail);
    });

    it("restores the rule list on failure", async () => {
        const { queryClient } = seed();

        const previous = await optimisticallyDeleteRule(queryClient, SHARED_ID);
        restoreQueries(queryClient, previous);

        expect(queryClient.getQueryData(messageTriggerKeys.list())).toEqual([
            { id: SHARED_ID, name: "rule" },
            { id: "other", name: "keep" },
        ]);
    });
});
