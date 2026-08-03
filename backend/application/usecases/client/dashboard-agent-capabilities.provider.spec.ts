import { DashboardAgentCapabilitiesProvider } from "./dashboard-agent-capabilities.provider";

describe("DashboardAgentCapabilitiesProvider", () => {
    it("counts active clients across every paginated page", async () => {
        const list = {
            execute: jest.fn()
                .mockResolvedValueOnce({ total: 101, totalPages: 2, page: 1, limit: 100, data: Array.from({ length: 100 }, () => ({ serviceStatus: "active" })) })
                .mockResolvedValueOnce({ total: 101, totalPages: 2, page: 2, limit: 100, data: [{ serviceStatus: "completed" }] }),
        };
        const provider = new DashboardAgentCapabilitiesProvider(list as never);
        const result = await provider.getCapabilities()[0]!.execute({
            principal: { userId: "user-a", branchId: "branch-a", globalRole: "admin", branchRole: "admin" },
            sessionId: "session-a", traceId: "trace-a", locale: "ko",
        }, {});

        expect(result).toEqual({ totalClients: 101, activeClients: 100 });
        expect(list.execute).toHaveBeenNthCalledWith(2, "branch-a", 2, 100);
    });
});
