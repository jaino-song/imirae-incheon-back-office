import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { eformsignApi } from "@/services/api";
import { useInfiniteContracts } from "../useInfiniteContracts";

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

function emptyPage() {
  return { documents: [], total_rows: 0, limit: 20, skip: 0 };
}

describe("useInfiniteContracts — the All tab and deletion tombstones", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedApi.getAllDocuments.mockResolvedValue(emptyPage() as never);
    mockedApi.getExpiredDocuments.mockResolvedValue(emptyPage() as never);
  });

  it("asks the server to leave deleted contracts out of the All tab", async () => {
    // A permanent delete scrubs the contract and leaves a 049 tombstone behind.
    // Without this flag the All tab renders that emptied row straight back at the
    // user after they deleted it. Mobile has always sent it; this is the desktop
    // side of the same contract.
    renderHook(() => useInfiniteContracts({ filterType: null }), { wrapper });

    await waitFor(() => expect(mockedApi.getAllDocuments).toHaveBeenCalled());

    expect(mockedApi.getAllDocuments).toHaveBeenCalledWith(
      expect.objectContaining({ excludeDeleted: true }),
    );
  });

  it("leaves the 기간 만료 tab alone, which is where deleted contracts belong", async () => {
    renderHook(() => useInfiniteContracts({ filterType: "expired" }), { wrapper });

    await waitFor(() => expect(mockedApi.getExpiredDocuments).toHaveBeenCalled());

    expect(mockedApi.getExpiredDocuments).not.toHaveBeenCalledWith(
      expect.objectContaining({ excludeDeleted: true }),
    );
  });
});
