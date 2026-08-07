import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { api } from "@/lib/api/client";
import type { CallRecordListItem, Paginated } from "@/lib/call-inbox/types";
import { useCallRecords } from "../useCallInbox";

jest.mock("@/lib/api/client", () => ({
  api: { get: jest.fn() },
}));

const mockedGet = api.get as jest.MockedFunction<typeof api.get>;

function page(
  ids: string[],
  { page: pageNumber, totalPages, total }: { page: number; totalPages: number; total: number },
): Paginated<CallRecordListItem> {
  return {
    data: ids.map((id) => ({ id }) as CallRecordListItem),
    total,
    page: pageNumber,
    limit: 20,
    totalPages,
  };
}

function wrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe("useCallRecords page accumulation", () => {
  it("drops a row the server repeats across pages", async () => {
    // A call landing between the two requests shifts every later row down by
    // one, so page 2 starts on a row page 1 already returned.
    mockedGet
      .mockResolvedValueOnce({ data: page(["a", "b", "c"], { page: 1, totalPages: 2, total: 5 }) })
      .mockResolvedValueOnce({ data: page(["c", "d", "e"], { page: 2, totalPages: 2, total: 6 }) });

    const { result } = renderHook(() => useCallRecords(), { wrapper });

    await waitFor(() => expect(result.current.records).toHaveLength(3));
    await result.current.fetchNextPage();
    await waitFor(() => expect(result.current.isFetchingNextPage).toBe(false));

    expect(result.current.records.map((r) => r.id)).toEqual(["a", "b", "c", "d", "e"]);
  });

  it("reports the count from the newest page, not the first", async () => {
    mockedGet
      .mockResolvedValueOnce({ data: page(["a"], { page: 1, totalPages: 2, total: 5 }) })
      .mockResolvedValueOnce({ data: page(["b"], { page: 2, totalPages: 2, total: 9 }) });

    const { result } = renderHook(() => useCallRecords(), { wrapper });

    await waitFor(() => expect(result.current.total).toBe(5));
    await result.current.fetchNextPage();

    await waitFor(() => expect(result.current.total).toBe(9));
  });

  it("stops offering a next page on the last one", async () => {
    mockedGet.mockResolvedValueOnce({
      data: page(["a", "b"], { page: 1, totalPages: 1, total: 2 }),
    });

    const { result } = renderHook(() => useCallRecords(), { wrapper });

    await waitFor(() => expect(result.current.isPending).toBe(false));
    expect(result.current.hasNextPage).toBe(false);
  });

  it("offers no next page when there is nothing to show", async () => {
    mockedGet.mockResolvedValueOnce({
      data: page([], { page: 1, totalPages: 0, total: 0 }),
    });

    const { result } = renderHook(() => useCallRecords(), { wrapper });

    await waitFor(() => expect(result.current.isPending).toBe(false));
    expect(result.current.records).toEqual([]);
    expect(result.current.total).toBe(0);
    expect(result.current.hasNextPage).toBe(false);
  });
});
