import { DashboardAgentCapabilitiesProvider } from "./dashboard-agent-capabilities.provider";
import { PrismaClientDashboardRepository } from "infrastructure/database/repositories/prisma-client-dashboard.repository";

describe("DashboardAgentCapabilitiesProvider", () => {
    it("uses the canonical dashboard summary use case for the current branch", async () => {
        const getSummary = { execute: jest.fn().mockResolvedValue({ totalClients: 101, activeClients: 98 }) };
        const provider = new DashboardAgentCapabilitiesProvider(getSummary as never);
        const result = await provider.getCapabilities()[0]!.execute({
            principal: { userId: "user-a", branchId: "branch-a", globalRole: "admin", branchRole: "admin" },
            sessionId: "session-a", traceId: "trace-a", locale: "ko",
        }, {});

        expect(result).toEqual({ totalClients: 101, activeClients: 98 });
        expect(getSummary.execute).toHaveBeenCalledWith("branch-a");
    });

    it("counts only canonical active clients with branch-scoped database aggregates", async () => {
        const prisma = { client: { count: jest.fn().mockResolvedValueOnce(101).mockResolvedValueOnce(98) } };
        const repository = new PrismaClientDashboardRepository(prisma as never);

        await expect(repository.getSummary("branch-a")).resolves.toEqual({ totalClients: 101, activeClients: 98 });
        expect(prisma.client.count).toHaveBeenNthCalledWith(1, { where: { branchId: "branch-a" } });
        expect(prisma.client.count).toHaveBeenNthCalledWith(2, { where: { branchId: "branch-a", serviceStatus: "active" } });
    });
});
