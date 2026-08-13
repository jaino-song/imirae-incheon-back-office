import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { eformsignApi } from "@/services/api";
import { useDeleteEformsignDocument } from "../useEformsignDocuments";

jest.mock("@/services/api", () => ({
  eformsignApi: {
    deleteDocument: jest.fn(),
  },
  withEformsignReauth: jest.fn((fn: () => Promise<unknown>) => fn()),
}));

const mockedDeleteDocument = eformsignApi.deleteDocument as jest.MockedFunction<
  typeof eformsignApi.deleteDocument
>;

const LIST_KEY = ["eformsign-documents", "all"] as const;

function documentIds(queryClient: QueryClient): string[] {
  const cached = queryClient.getQueryData<{ documents: { id: string }[] }>(LIST_KEY);
  return (cached?.documents ?? []).map((doc) => doc.id);
}

function setup() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  queryClient.setQueryData(LIST_KEY, {
    documents: [{ id: "doc-1" }, { id: "doc-2" }],
    total_rows: 2,
  });

  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );

  const { result } = renderHook(() => useDeleteEformsignDocument(), { wrapper });
  return { queryClient, result };
}

// Unlike every other delete hook, this one must NOT roll back: the backend can
// purge the document locally and still report an error, so restoring the
// pre-delete snapshot would resurrect a document that is already gone.
describe("useDeleteEformsignDocument", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("removes the document optimistically", async () => {
    let resolveDelete: (() => void) | undefined;
    mockedDeleteDocument.mockImplementation(
      () => new Promise((resolve) => {
        resolveDelete = () => resolve({ result: { success_result: ["doc-1"], fail_result: [] } } as never);
      }),
    );

    const { queryClient, result } = setup();
    result.current.mutate("doc-1");

    await waitFor(() => expect(documentIds(queryClient)).toEqual(["doc-2"]));

    resolveDelete?.();
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
  });

  it("does not restore the removed document when the request fails", async () => {
    mockedDeleteDocument.mockRejectedValue(new Error("vendor failure"));

    const { queryClient, result } = setup();
    result.current.mutate("doc-1");

    await waitFor(() => expect(result.current.isError).toBe(true));

    // The stale snapshot must not come back; the settlement refetch decides.
    expect(documentIds(queryClient)).toEqual(["doc-2"]);
  });
});
