import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { api } from "@/lib/api/client";
import { clientQueryKeys, useDeleteClient } from "../useClients";

jest.mock("@/lib/api/client", () => ({
  api: {
    get: jest.fn(),
    delete: jest.fn(),
  },
}));

const mockedApiDelete = api.delete as jest.MockedFunction<typeof api.delete>;

type CachedClient = { id: number; name: string };

function setup() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  queryClient.setQueryData(clientQueryKeys.all, [
    { id: 1, name: "one" },
    { id: 2, name: "two" },
    { id: 3, name: "three" },
  ]);

  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );

  const { result } = renderHook(() => useDeleteClient(), { wrapper });
  return { queryClient, result };
}

function cachedIds(queryClient: QueryClient): number[] {
  return (queryClient.getQueryData<CachedClient[]>(clientQueryKeys.all) ?? []).map((c) => c.id);
}

// Snapshot-based rollback restores the whole cache entry, so an overlapping
// deletion that starts before the first settles is the one case that can undo
// another in-flight removal. These tests document the real behaviour.
//
// Every delete confirmation in the app (clients page, FilteredClientsDialog,
// EmployeesTable, files page) disables its confirm control via the shared
// mutation's `isPending`, so a second deletion cannot be started from the UI
// while one is in flight. Overlap is therefore not reachable today; these tests
// pin the semantics in case a future surface drops that guard or a screen gains
// multi-select deletion.
describe("useDeleteClient overlapping deletions", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("keeps both clients removed when two deletions overlap and both succeed", async () => {
    const resolvers: Record<number, () => void> = {};
    mockedApiDelete.mockImplementation((url: string) => {
      const id = Number(url.split("/").pop());
      return new Promise((resolve) => {
        resolvers[id] = () => resolve({ data: undefined } as never);
      });
    });

    const { queryClient, result } = setup();

    result.current.mutate(1);
    await waitFor(() => expect(cachedIds(queryClient)).toEqual([2, 3]));

    result.current.mutate(2);
    await waitFor(() => expect(cachedIds(queryClient)).toEqual([3]));

    resolvers[1]?.();
    resolvers[2]?.();

    await waitFor(() => expect(mockedApiDelete).toHaveBeenCalledTimes(2));
    expect(cachedIds(queryClient)).toEqual([3]);
  });

  it("resurrects the first client when a later overlapping deletion fails", async () => {
    const resolvers: Record<number, () => void> = {};
    const rejecters: Record<number, () => void> = {};
    mockedApiDelete.mockImplementation((url: string) => {
      const id = Number(url.split("/").pop());
      return new Promise((resolve, reject) => {
        resolvers[id] = () => resolve({ data: undefined } as never);
        rejecters[id] = () => reject(new Error("boom"));
      });
    });

    const { queryClient, result } = setup();

    result.current.mutate(1);
    await waitFor(() => expect(cachedIds(queryClient)).toEqual([2, 3]));

    // Starts while #1 is still in flight, so its snapshot already excludes #1.
    result.current.mutate(2);
    await waitFor(() => expect(cachedIds(queryClient)).toEqual([3]));

    rejecters[2]?.();
    await waitFor(() => expect(cachedIds(queryClient)).toEqual([2, 3]));

    // #1 stays absent because #2's snapshot was taken after #1 was removed.
    // The settlement refetch that follows is what reconciles the list.
    expect(cachedIds(queryClient)).not.toContain(1);

    resolvers[1]?.();
  });

  it("momentarily resurrects a still-deleting client when the earlier deletion fails", async () => {
    const resolvers: Record<number, () => void> = {};
    const rejecters: Record<number, () => void> = {};
    mockedApiDelete.mockImplementation((url: string) => {
      const id = Number(url.split("/").pop());
      return new Promise((resolve, reject) => {
        resolvers[id] = () => resolve({ data: undefined } as never);
        rejecters[id] = () => reject(new Error("boom"));
      });
    });

    const { queryClient, result } = setup();

    result.current.mutate(1);
    await waitFor(() => expect(cachedIds(queryClient)).toEqual([2, 3]));

    result.current.mutate(2);
    await waitFor(() => expect(cachedIds(queryClient)).toEqual([3]));

    // The earlier deletion fails last. Its snapshot predates BOTH removals, so
    // restoring it also brings back #2, which is still being deleted.
    rejecters[1]?.();

    await waitFor(() => expect(cachedIds(queryClient)).toContain(1));
    expect(cachedIds(queryClient)).toEqual([1, 2, 3]);

    // #2 is transiently visible again. Its own settlement invalidation refetches
    // the list from the server, which is what removes it for good.
    resolvers[2]?.();
    await waitFor(() => expect(result.current.isPending).toBe(false));
  });
});
