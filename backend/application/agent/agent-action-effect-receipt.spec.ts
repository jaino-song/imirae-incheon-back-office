import { readAgentActionEffect, recordAgentActionEffect } from "./agent-action-effect-receipt";

const context = {
    actionId: "action-1",
    sessionId: "session-1",
    traceId: "trace-1",
    locale: "ko",
    principal: { userId: "user-1", branchId: "branch-1", globalRole: "admin", branchRole: "admin" },
};

describe("agent action effect receipts", () => {
    it("binds the receipt to action, user, branch, and capability identity", async () => {
        const prisma = { agent_action: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) } };

        await recordAgentActionEffect(prisma as never, context, "clients.create", "client", 7, {
            id: 7, name: "Test", status: "created",
        });

        expect(prisma.agent_action.updateMany).toHaveBeenCalledWith(expect.objectContaining({
            where: {
                id: "action-1",
                userId: "user-1",
                branchId: "branch-1",
                capability: "clients.create",
                status: "executing",
            },
            data: expect.objectContaining({ effectReceipt: expect.objectContaining({ actionId: "action-1", resourceId: 7 }) }),
        }));
    });

    it("never infers success without an exact action-bound receipt", async () => {
        const prisma = { agent_action: { findFirst: jest.fn().mockResolvedValue({ effectReceipt: null }) } };

        await expect(readAgentActionEffect(prisma as never, context, "clients.create")).resolves.toBeNull();
        expect(prisma.agent_action.findFirst).toHaveBeenCalledWith(expect.objectContaining({
            where: expect.objectContaining({ id: "action-1", capability: "clients.create" }),
        }));
    });
});
