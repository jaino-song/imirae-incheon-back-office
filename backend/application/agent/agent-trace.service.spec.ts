import { AgentTraceService } from "./agent-trace.service";

describe("AgentTraceService", () => {
    it("keeps trace completion scoped to the originating user and branch", async () => {
        const prisma = {
            agent_trace: {
                create: jest.fn().mockResolvedValue(undefined),
                updateMany: jest.fn().mockResolvedValue({ count: 1 }),
            },
        };
        const service = new AgentTraceService(prisma as never);
        const trace = await service.start("session-a", {
            userId: "user-a",
            branchId: "branch-a",
            globalRole: "admin",
            branchRole: "admin",
        }, "gemini-3.5-flash-lite", "release-a.1", ["clients"]);

        await service.finish(trace, "succeeded");

        expect(prisma.agent_trace.updateMany).toHaveBeenCalledWith(expect.objectContaining({
            where: { id: trace.id, userId: "user-a", branchId: "branch-a" },
        }));
    });
});
