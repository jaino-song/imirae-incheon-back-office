import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { api } from "@/lib/api/client";
import { useEmployeeWorkHistory } from "../useEmployees";

jest.mock("@/lib/api/client", () => ({
    api: { get: jest.fn() },
}));

const mockGet = api.get as jest.MockedFunction<typeof api.get>;

function createWrapper() {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return function Wrapper({ children }: { children: ReactNode }) {
        return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
    };
}

describe("useEmployeeWorkHistory", () => {
    beforeEach(() => mockGet.mockReset());

    it("loads paginated history and preserves completed/replaced state", async () => {
        mockGet.mockResolvedValue({
            data: {
                data: [{
                    scheduleId: 22,
                    clientId: 11,
                    clientName: "박서연",
                    role: "secondary",
                    startDate: "2025-01-01",
                    endDate: "2025-06-30",
                    status: "replaced",
                }],
                total: 1,
                page: 1,
                limit: 10,
                totalPages: 1,
            },
        });

        const { result } = renderHook(() => useEmployeeWorkHistory(7, 10), {
            wrapper: createWrapper(),
        });

        await waitFor(() => expect(result.current.history[0]?.status).toBe("replaced"));
        expect(mockGet).toHaveBeenCalledWith("/employees/7/work-history?page=1&limit=10");
    });

    it("fetches the next page only when the response has more history", async () => {
        mockGet
            .mockResolvedValueOnce({
                data: {
                    data: [{
                        scheduleId: 22,
                        clientId: 11,
                        clientName: "박서연",
                        role: "secondary",
                        startDate: "2025-01-01",
                        endDate: "2025-06-30",
                        status: "replaced",
                    }],
                    total: 2,
                    page: 1,
                    limit: 1,
                    totalPages: 2,
                },
            })
            .mockResolvedValueOnce({
                data: {
                    data: [{
                        scheduleId: 23,
                        clientId: 12,
                        clientName: "이하늘",
                        role: "primary",
                        startDate: "2024-01-01",
                        endDate: "2024-12-31",
                        status: "completed",
                    }],
                    total: 2,
                    page: 2,
                    limit: 1,
                    totalPages: 2,
                },
            });

        const { result } = renderHook(() => useEmployeeWorkHistory(7, 1), {
            wrapper: createWrapper(),
        });

        await waitFor(() => expect(result.current.hasNextPage).toBe(true));
        await result.current.fetchNextPage();
        await waitFor(() => expect(result.current.history).toHaveLength(2));

        expect(mockGet).toHaveBeenNthCalledWith(2, "/employees/7/work-history?page=2&limit=1");
        expect(result.current.history[1]?.status).toBe("completed");
    });

    it("does not fetch for an invalid employee id", async () => {
        renderHook(() => useEmployeeWorkHistory(0), { wrapper: createWrapper() });
        await Promise.resolve();
        expect(mockGet).not.toHaveBeenCalled();
    });
});
