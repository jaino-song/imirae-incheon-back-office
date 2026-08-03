import type { BjjUIMessage } from "@babyjamjam/shared";

import { PrismaAgentSessionRepository } from "./prisma-agent-session.repository";

describe("PrismaAgentSessionRepository", () => {
    const owner = { userId: "user-a", branchId: "branch-a" };

    it("blocks physical deletion while a nonterminal action exists", async () => {
        const prisma = {
            agent_session: {
                deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
                findFirst: jest.fn().mockResolvedValue({ id: "session-a" }),
            },
        };
        const repository = new PrismaAgentSessionRepository(prisma as never);

        await expect(repository.deleteOwned("session-a", owner)).resolves.toBe("blocked");
        expect(prisma.agent_session.deleteMany).toHaveBeenCalledWith({
            where: {
                id: "session-a",
                ...owner,
                actions: { none: { status: { in: ["proposed", "approved", "executing", "uncertain"] } } },
            },
        });
    });

    it("preserves an explicit title and assigns deterministic message timestamps", async () => {
        const transaction = jest.fn().mockImplementation(async (operations: Array<Promise<unknown>>) => Promise.all(operations));
        const prisma = {
            agent_session: {
                findFirst: jest.fn().mockResolvedValue({ id: "session-a", title: "직접 지정한 제목" }),
                update: jest.fn().mockResolvedValue({}),
                updateMany: jest.fn().mockResolvedValue({ count: 0 }),
            },
            agent_message: { createMany: jest.fn().mockResolvedValue({ count: 2 }) },
            $transaction: transaction,
        };
        const repository = new PrismaAgentSessionRepository(prisma as never);
        const messages = [
            { id: "user-message", role: "user", parts: [{ type: "text", text: "첫 질문" }] },
            { id: "assistant-message", role: "assistant", parts: [{ type: "text", text: "첫 답변" }] },
        ] as BjjUIMessage[];

        await repository.appendMessages("session-a", owner, messages);

        const data = prisma.agent_message.createMany.mock.calls[0][0].data as Array<{ createdAt: Date }>;
        const [first, second] = data;
        if (!first || !second) throw new Error("Expected both messages to be persisted");
        expect(second.createdAt.getTime()).toBeGreaterThan(first.createdAt.getTime());
        expect(prisma.agent_session.updateMany).not.toHaveBeenCalled();
        expect(prisma.agent_session.update).toHaveBeenCalledWith({
            where: { id: "session-a" },
            data: { updatedAt: expect.any(Date) },
        });
    });
});
