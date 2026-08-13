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

function seedCache(queryClient: QueryClient) {
  queryClient.setQueryData(clientQueryKeys.all, [
    { id: 1, name: "target" },
    { id: 2, name: "keep" },
  ]);
  queryClient.setQueryData(clientQueryKeys.list(1, 10), {
    data: [
      { id: 1, name: "target" },
      { id: 2, name: "keep" },
    ],
    total: 2,
    page: 1,
    limit: 10,
    totalPages: 1,
  });
}

function setup() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  seedCache(queryClient);

  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );

  const { result } = renderHook(() => useDeleteClient(), { wrapper });
  return { queryClient, result };
}

function cachedIds(queryClient: QueryClient): number[] {
  return (queryClient.getQueryData<CachedClient[]>(clientQueryKeys.all) ?? []).map((c) => c.id);
}

describe("useDeleteClient lifecycle", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("removes the client before the request resolves and keeps it absent on success", async () => {
    let resolveDelete: (() => void) | undefined;
    mockedApiDelete.mockImplementation(
      () => new Promise((resolve) => {
        resolveDelete = () => resolve({ data: undefined } as never);
      }),
    );

    const { queryClient, result } = setup();
    result.current.mutate(1);

    // Optimistic removal happens while the DELETE is still in flight.
    await waitFor(() => expect(cachedIds(queryClient)).toEqual([2]));
    expect(result.current.isPending).toBe(true);

    resolveDelete?.();

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(cachedIds(queryClient)).toEqual([2]);
  });

  it("restores the exact previous cache when the request fails", async () => {
    let rejectDelete: (() => void) | undefined;
    mockedApiDelete.mockImplementation(
      () => new Promise((_resolve, reject) => {
        rejectDelete = () => reject(new Error("boom"));
      }),
    );

    const { queryClient, result } = setup();
    result.current.mutate(1);

    await waitFor(() => expect(cachedIds(queryClient)).toEqual([2]));

    rejectDelete?.();

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(cachedIds(queryClient)).toEqual([1, 2]);
    expect(queryClient.getQueryData(clientQueryKeys.list(1, 10))).toMatchObject({
      data: [{ id: 1, name: "target" }, { id: 2, name: "keep" }],
      total: 2,
    });
  });
});
