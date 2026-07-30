import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { eformsignApi } from "@/services/api";
import {
  eformsignQueryKeys,
  useDeleteEformsignDocument,
} from "../useEformsignDocuments";

jest.mock("@/services/api", () => ({
  eformsignApi: {
    deleteDocument: jest.fn(),
  },
  withEformsignReauth: (operation: () => Promise<unknown>) => operation(),
}));

const mockDeleteDocument = eformsignApi.deleteDocument as jest.MockedFunction<
  typeof eformsignApi.deleteDocument
>;

describe("useDeleteEformsignDocument", () => {
  it("keeps a failed permanent purge out of the optimistic cache and invalidates local document truth", async () => {
    const queryClient = new QueryClient({
      defaultOptions: { mutations: { retry: false } },
    });
    const invalidateQueries = jest.spyOn(queryClient, "invalidateQueries");
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
    queryClient.setQueryData(eformsignQueryKeys.allDocuments(), {
      documents: [{ id: "purge-pending-document" }],
      total_rows: 1,
    });
    mockDeleteDocument.mockRejectedValueOnce(new Error("local purge failed"));

    const { result } = renderHook(() => useDeleteEformsignDocument(), { wrapper });

    await act(async () => {
      await expect(result.current.mutateAsync("purge-pending-document")).rejects.toThrow(
        "local purge failed",
      );
    });

    expect(queryClient.getQueryData(eformsignQueryKeys.allDocuments())).toEqual({
      documents: [],
      total_rows: 0,
    });
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: eformsignQueryKeys.documents(),
    });
  });
});
