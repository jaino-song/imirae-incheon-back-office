import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

import type {
  EformsignDocument,
  EformsignDocumentsResponse,
} from "@/lib/eformsign/types";
import { eformsignApi } from "@/services/api";
import { useGetAuthUser } from "@/hooks/useGetAuthUser";
import { useInfiniteContracts } from "../useInfiniteContracts";

jest.mock("@/services/api", () => ({
  eformsignApi: {
    getAllDocuments: jest.fn(),
  },
}));

jest.mock("@/hooks/useGetAuthUser", () => ({
  useGetAuthUser: jest.fn(),
}));

const mockedGetAllDocuments = eformsignApi.getAllDocuments as jest.MockedFunction<
  typeof eformsignApi.getAllDocuments
>;
const mockedUseGetAuthUser = useGetAuthUser as jest.MockedFunction<typeof useGetAuthUser>;

interface PageOptions {
  ids: string[];
  totalRows: number;
  limit: number;
  skip: number;
  hasMore?: boolean;
  snapshotVersion?: string;
}

function createDocument(id: string): EformsignDocument {
  return { id } as EformsignDocument;
}

function createPage({
  ids,
  totalRows,
  limit,
  skip,
  hasMore,
  snapshotVersion,
}: PageOptions): EformsignDocumentsResponse {
  return {
    documents: ids.map(createDocument),
    total_rows: totalRows,
    limit,
    skip,
    ...(hasMore === undefined ? {} : { has_more: hasMore }),
    ...(snapshotVersion === undefined ? {} : { snapshot_version: snapshotVersion }),
  };
}

function documentIds(start: number, count: number): string[] {
  return Array.from({ length: count }, (_, index) => `doc-${start + index}`);
}

function authResult(branchId: string | null) {
  return {
    data: {
      id: "user-1",
      name: "테스트 사용자",
      branchId,
    },
  } as ReturnType<typeof useGetAuthUser>;
}

function createWrapper(queryClient: QueryClient) {
  return function HookWrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

describe("useInfiniteContracts", () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
        },
      },
    });
    mockedGetAllDocuments.mockReset();
    mockedUseGetAuthUser.mockReset();
    mockedUseGetAuthUser.mockReturnValue(authResult("branch-1"));
  });

  afterEach(() => {
    queryClient.clear();
  });

  it("requests 9 documents first and advances subsequent offsets by loaded page sizes", async () => {
    mockedGetAllDocuments
      .mockResolvedValueOnce(
        createPage({
          ids: documentIds(1, 9),
          totalRows: 21,
          limit: 9,
          skip: 0,
          hasMore: true,
        }),
      )
      .mockResolvedValueOnce(
        createPage({
          ids: documentIds(10, 6),
          totalRows: 21,
          limit: 6,
          skip: 9,
          hasMore: true,
        }),
      )
      .mockResolvedValueOnce(
        createPage({
          ids: documentIds(16, 6),
          totalRows: 21,
          limit: 6,
          skip: 15,
          hasMore: false,
        }),
      );

    const { result } = renderHook(() => useInfiniteContracts(), {
      wrapper: createWrapper(queryClient),
    });

    await waitFor(() => expect(result.current.loadedCount).toBe(9));

    await act(async () => {
      await result.current.fetchNextPage();
    });
    await waitFor(() => expect(result.current.loadedCount).toBe(15));

    await act(async () => {
      await result.current.fetchNextPage();
    });
    await waitFor(() => expect(result.current.loadedCount).toBe(21));

    expect(mockedGetAllDocuments).toHaveBeenNthCalledWith(1, {
      limit: 9,
      skip: 0,
      statusCategory: undefined,
      search: undefined,
      excludeDeleted: true,
    });
    expect(mockedGetAllDocuments).toHaveBeenNthCalledWith(2, {
      limit: 6,
      skip: 9,
      statusCategory: undefined,
      search: undefined,
      excludeDeleted: true,
    });
    expect(mockedGetAllDocuments).toHaveBeenNthCalledWith(3, {
      limit: 6,
      skip: 15,
      statusCategory: undefined,
      search: undefined,
      excludeDeleted: true,
    });
    expect(result.current.totalRows).toBe(21);
  });

  it("stops requesting pages when has_more is false", async () => {
    mockedGetAllDocuments.mockResolvedValue(
      createPage({
        ids: documentIds(1, 9),
        totalRows: 20,
        limit: 9,
        skip: 0,
        hasMore: false,
      }),
    );

    const { result } = renderHook(() => useInfiniteContracts(), {
      wrapper: createWrapper(queryClient),
    });

    await waitFor(() => expect(result.current.hasNextPage).toBe(false));

    await act(async () => {
      await result.current.fetchNextPage();
    });

    expect(mockedGetAllDocuments).toHaveBeenCalledTimes(1);
  });

  it("falls back to offset math when has_more is absent and stops at the total boundary", async () => {
    mockedGetAllDocuments
      .mockResolvedValueOnce(
        createPage({
          ids: documentIds(1, 9),
          totalRows: 15,
          limit: 9,
          skip: 0,
        }),
      )
      .mockResolvedValueOnce(
        createPage({
          ids: documentIds(10, 6),
          totalRows: 15,
          limit: 6,
          skip: 9,
        }),
      );

    const { result } = renderHook(() => useInfiniteContracts(), {
      wrapper: createWrapper(queryClient),
    });

    await waitFor(() => expect(result.current.hasNextPage).toBe(true));

    await act(async () => {
      await result.current.fetchNextPage();
    });

    await waitFor(() => expect(result.current.hasNextPage).toBe(false));
    expect(mockedGetAllDocuments).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ limit: 6, skip: 9 }),
    );
    expect(mockedGetAllDocuments).toHaveBeenCalledTimes(2);
  });

  it("restarts from the first page when status, search, or branch changes", async () => {
    let branchId = "branch-1";
    const initialProps: {
      statusCategory: "drafting" | "completed";
      search: string;
    } = {
      statusCategory: "drafting",
      search: "alpha",
    };
    mockedUseGetAuthUser.mockImplementation(() => authResult(branchId));
    mockedGetAllDocuments.mockImplementation(async (params) =>
      createPage({
        ids: [`${branchId}-${params?.statusCategory ?? "all"}-${params?.search ?? "empty"}`],
        totalRows: 1,
        limit: params?.limit ?? 9,
        skip: params?.skip ?? 0,
        hasMore: false,
      }),
    );

    const { result, rerender } = renderHook(
      ({ statusCategory, search }) => useInfiniteContracts({ statusCategory, search }),
      {
        initialProps,
        wrapper: createWrapper(queryClient),
      },
    );

    await waitFor(() => expect(mockedGetAllDocuments).toHaveBeenCalledTimes(1));

    rerender({ statusCategory: "completed", search: "alpha" });
    await waitFor(() => expect(mockedGetAllDocuments).toHaveBeenCalledTimes(2));

    rerender({ statusCategory: "completed", search: "beta" });
    await waitFor(() => expect(mockedGetAllDocuments).toHaveBeenCalledTimes(3));

    branchId = "branch-2";
    rerender({ statusCategory: "completed", search: "beta" });
    await waitFor(() => expect(mockedGetAllDocuments).toHaveBeenCalledTimes(4));

    for (const call of mockedGetAllDocuments.mock.calls) {
      expect(call[0]).toEqual(expect.objectContaining({ limit: 9, skip: 0 }));
    }
    expect(queryClient.getQueryState([
      "eformsign-documents",
      "paginated",
      "branch-1",
      "drafting",
      "alpha",
      "any-template",
      "include",
    ])).toBeDefined();
    expect(queryClient.getQueryState([
      "eformsign-documents",
      "paginated",
      "branch-1",
      "completed",
      "alpha",
      "any-template",
      "include",
    ])).toBeDefined();
    expect(queryClient.getQueryState([
      "eformsign-documents",
      "paginated",
      "branch-1",
      "completed",
      "beta",
      "any-template",
      "include",
    ])).toBeDefined();
    expect(result.current.queryKey).toEqual([
      "eformsign-documents",
      "paginated",
      "branch-2",
      "completed",
      "beta",
      "any-template",
      "include",
    ]);
  });

  it("stops after an empty page even when has_more remains true", async () => {
    mockedGetAllDocuments
      .mockResolvedValueOnce(
        createPage({
          ids: documentIds(1, 9),
          totalRows: 20,
          limit: 9,
          skip: 0,
          hasMore: true,
        }),
      )
      .mockResolvedValueOnce(
        createPage({
          ids: [],
          totalRows: 20,
          limit: 6,
          skip: 9,
          hasMore: true,
        }),
      );

    const { result } = renderHook(() => useInfiniteContracts(), {
      wrapper: createWrapper(queryClient),
    });

    await waitFor(() => expect(result.current.hasNextPage).toBe(true));

    await act(async () => {
      await result.current.fetchNextPage();
    });
    await waitFor(() => expect(result.current.hasNextPage).toBe(false));

    await act(async () => {
      await result.current.fetchNextPage();
    });

    expect(mockedGetAllDocuments).toHaveBeenCalledTimes(2);
    expect(result.current.loadedCount).toBe(9);
  });

  it("re-arms the snapshot drift guard after a coherent refetch", async () => {
    const firstPage = createPage({
      ids: documentIds(1, 9),
      totalRows: 15,
      limit: 9,
      skip: 0,
      hasMore: true,
      snapshotVersion: "1:100",
    });
    const conflictingPage = createPage({
      ids: documentIds(10, 6),
      totalRows: 15,
      limit: 6,
      skip: 9,
      hasMore: false,
      snapshotVersion: "2:200",
    });
    mockedGetAllDocuments
      .mockResolvedValueOnce(firstPage)
      .mockResolvedValueOnce(conflictingPage)
      .mockResolvedValueOnce(firstPage)
      .mockResolvedValueOnce(conflictingPage)
      .mockResolvedValue(firstPage);
    const resetQueriesSpy = jest.spyOn(queryClient, "resetQueries");

    const { result } = renderHook(() => useInfiniteContracts(), {
      wrapper: createWrapper(queryClient),
    });

    await waitFor(() => expect(result.current.hasNextPage).toBe(true));

    await act(async () => {
      await result.current.fetchNextPage();
    });

    await waitFor(() => expect(resetQueriesSpy).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(mockedGetAllDocuments).toHaveBeenCalledTimes(3));
    expect(mockedGetAllDocuments).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({ limit: 9, skip: 0 }),
    );
    expect(result.current.snapshotVersion).toBe("1:100");

    await waitFor(() => expect(result.current.hasNextPage).toBe(true));
    await act(async () => {
      await result.current.fetchNextPage();
    });
    await waitFor(() => expect(mockedGetAllDocuments).toHaveBeenCalledTimes(4));

    await waitFor(() => expect(resetQueriesSpy).toHaveBeenCalledTimes(2));
    resetQueriesSpy.mockRestore();
  });

  it.each([
    ["the later page omits it", "1:100", undefined],
    ["the first page omits it", undefined, "1:100"],
  ])(
    "resets mobile offset pagination when %s",
    async (_description, firstSnapshotVersion, laterSnapshotVersion) => {
      const firstPage = createPage({
        ids: documentIds(1, 9),
        totalRows: 15,
        limit: 9,
        skip: 0,
        hasMore: true,
        snapshotVersion: firstSnapshotVersion,
      });
      const laterPage = createPage({
        ids: documentIds(10, 6),
        totalRows: 15,
        limit: 6,
        skip: 9,
        hasMore: false,
        snapshotVersion: laterSnapshotVersion,
      });
      mockedGetAllDocuments
        .mockResolvedValueOnce(firstPage)
        .mockResolvedValueOnce(laterPage)
        .mockResolvedValue(firstPage);
      const resetQueriesSpy = jest.spyOn(queryClient, "resetQueries");

      const { result } = renderHook(() => useInfiniteContracts(), {
        wrapper: createWrapper(queryClient),
      });

      await waitFor(() => expect(result.current.hasNextPage).toBe(true));
      await act(async () => {
        await result.current.fetchNextPage();
      });

      await waitFor(() => expect(resetQueriesSpy).toHaveBeenCalledTimes(1));
      resetQueriesSpy.mockRestore();
    },
  );

  it("keeps loaded documents and exposes a load-more error when the next page fails", async () => {
    mockedGetAllDocuments
      .mockResolvedValueOnce(
        createPage({
          ids: documentIds(1, 9),
          totalRows: 15,
          limit: 9,
          skip: 0,
          hasMore: true,
        }),
      )
      .mockRejectedValueOnce(new Error("next page failed"));

    const { result } = renderHook(() => useInfiniteContracts(), {
      wrapper: createWrapper(queryClient),
    });

    await waitFor(() => expect(result.current.loadedCount).toBe(9));

    await act(async () => {
      await result.current.fetchNextPage();
    });

    await waitFor(() => expect(result.current.isLoadMoreError).toBe(true));
    expect(result.current.documents.map((document) => document.id)).toEqual(documentIds(1, 9));
    expect(result.current.loadedCount).toBe(9);
  });

  it("does not request documents until branchId is available", async () => {
    mockedUseGetAuthUser.mockReturnValue(authResult(null));

    const { result } = renderHook(() => useInfiniteContracts(), {
      wrapper: createWrapper(queryClient),
    });

    await act(async () => {
      await Promise.resolve();
    });

    expect(result.current.isBranchPending).toBe(true);
    expect(mockedGetAllDocuments).not.toHaveBeenCalled();
  });

  it("de-duplicates documents with the same id across pages", async () => {
    mockedGetAllDocuments
      .mockResolvedValueOnce(
        createPage({
          ids: documentIds(1, 9),
          totalRows: 15,
          limit: 9,
          skip: 0,
          hasMore: true,
        }),
      )
      .mockResolvedValueOnce(
        createPage({
          ids: ["doc-9", ...documentIds(10, 5)],
          totalRows: 15,
          limit: 6,
          skip: 9,
          hasMore: false,
        }),
      );

    const { result } = renderHook(() => useInfiniteContracts(), {
      wrapper: createWrapper(queryClient),
    });

    await waitFor(() => expect(result.current.loadedCount).toBe(9));
    await act(async () => {
      await result.current.fetchNextPage();
    });

    await waitFor(() => expect(result.current.loadedCount).toBe(14));
    expect(result.current.documents.filter((document) => document.id === "doc-9")).toHaveLength(1);
  });
});
