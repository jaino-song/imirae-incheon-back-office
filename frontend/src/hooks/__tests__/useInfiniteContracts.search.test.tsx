import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { eformsignApi } from "@/services/api";
import {
  infiniteContractsQueryKeys,
  useInfiniteContracts,
} from "../useInfiniteContracts";

jest.mock("@/services/api", () => ({
  eformsignApi: {
    getAllDocuments: jest.fn(),
    getInProgressDocuments: jest.fn(),
    getCompletedDocuments: jest.fn(),
    getExpiredDocuments: jest.fn(),
  },
}));

const mockedApi = eformsignApi as jest.Mocked<typeof eformsignApi>;

function wrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

function wrapperFor(queryClient: QueryClient) {
  return function QueryWrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
  };
}

function emptyPage() {
  return { documents: [], total_rows: 0, limit: 20, skip: 0 };
}

describe("useInfiniteContracts — server-side search", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedApi.getAllDocuments.mockResolvedValue(emptyPage() as never);
    mockedApi.getInProgressDocuments.mockResolvedValue(emptyPage() as never);
    mockedApi.getCompletedDocuments.mockResolvedValue(emptyPage() as never);
    mockedApi.getExpiredDocuments.mockResolvedValue(emptyPage() as never);
  });

  // While the search was client-side, the server kept paginating the
  // unfiltered table and hasNextPage never went false — the runaway load-more
  // loop. Sending the term server-side is what makes the pagination metadata
  // describe the searched set.
  it("sends the search term to the All tab endpoint", async () => {
    renderHook(
      () => useInfiniteContracts({ filterType: null, search: "김현아" }),
      { wrapper },
    );

    await waitFor(() => expect(mockedApi.getAllDocuments).toHaveBeenCalled());

    expect(mockedApi.getAllDocuments).toHaveBeenCalledWith(
      expect.objectContaining({ search: "김현아" }),
    );
  });

  it.each([
    ["in-progress", () => mockedApi.getInProgressDocuments],
    ["completed", () => mockedApi.getCompletedDocuments],
    ["expired", () => mockedApi.getExpiredDocuments],
  ] as const)(
    "sends the search term to the %s endpoint",
    async (filterType, getMock) => {
      renderHook(
        () => useInfiniteContracts({ filterType, search: "홍길동" }),
        { wrapper },
      );

      await waitFor(() => expect(getMock()).toHaveBeenCalled());

      expect(getMock()).toHaveBeenCalledWith(
        expect.objectContaining({ search: "홍길동" }),
      );
    },
  );

  it("trims the term before sending it", async () => {
    renderHook(
      () => useInfiniteContracts({ filterType: null, search: "  김현아  " }),
      { wrapper },
    );

    await waitFor(() => expect(mockedApi.getAllDocuments).toHaveBeenCalled());

    expect(mockedApi.getAllDocuments).toHaveBeenCalledWith(
      expect.objectContaining({ search: "김현아" }),
    );
  });

  it.each([
    ["an omitted search", undefined],
    ["an empty search", ""],
    ["a whitespace-only search", "   "],
  ])("sends no search param for %s", async (_description, search) => {
    renderHook(
      () => useInfiniteContracts({ filterType: null, search }),
      { wrapper },
    );

    await waitFor(() => expect(mockedApi.getAllDocuments).toHaveBeenCalled());

    expect(mockedApi.getAllDocuments.mock.calls[0][0]).not.toHaveProperty(
      "search",
    );
  });

  it("keys the cache by search term so two terms never share pages", async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0 } },
    });
    const { rerender } = renderHook(
      ({ search }: { search: string }) =>
        useInfiniteContracts({ filterType: null, search }),
      { wrapper: wrapperFor(queryClient), initialProps: { search: "김" } },
    );

    await waitFor(() =>
      expect(mockedApi.getAllDocuments).toHaveBeenCalledTimes(1),
    );
    expect(mockedApi.getAllDocuments).toHaveBeenLastCalledWith(
      expect.objectContaining({ search: "김" }),
    );

    // Same normalized term (only whitespace differs) → same key, no refetch.
    rerender({ search: "김 " });
    await waitFor(() =>
      expect(mockedApi.getAllDocuments).toHaveBeenCalledTimes(1),
    );

    // Different term → different key → its own fetch, not the cached "김" pages.
    rerender({ search: "이" });
    await waitFor(() =>
      expect(mockedApi.getAllDocuments).toHaveBeenCalledTimes(2),
    );
    expect(mockedApi.getAllDocuments).toHaveBeenLastCalledWith(
      expect.objectContaining({ search: "이" }),
    );
  });
});

describe("infiniteContractsQueryKeys — search segment", () => {
  it("separates result sets for different search terms", () => {
    const kim = infiniteContractsQueryKeys.documents(null, undefined, "김");
    const lee = infiniteContractsQueryKeys.documents(null, undefined, "이");

    expect(kim).not.toEqual(lee);
  });

  it("treats an omitted search and an empty search as the same key", () => {
    expect(infiniteContractsQueryKeys.documents(null, undefined)).toEqual(
      infiniteContractsQueryKeys.documents(null, undefined, ""),
    );
  });
});
