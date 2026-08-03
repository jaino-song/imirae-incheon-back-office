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
                actions: {
                    none: {
                        OR: [
                            { userId: owner.userId, branchId: owner.branchId, status: { in: ["executing", "uncertain"] } },
                            {
                                userId: owner.userId,
                                branchId: owner.branchId,
                                status: { in: ["proposed", "approved"] },
                                expiresAt: { gt: expect.any(Date) },
                            },
                        ],
                    },
                },
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

    it.each(["proposed", "approved"])("does not block deletion for an expired %s action", async () => {
        const now = new Date("2026-08-04T00:00:00.000Z");
        jest.useFakeTimers().setSystemTime(now);
        try {
            const prisma = {
                agent_session: {
                    deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
                    findFirst: jest.fn(),
                },
            };
            const repository = new PrismaAgentSessionRepository(prisma as never);

            await expect(repository.deleteOwned("session-a", owner)).resolves.toBe("deleted");

            const where = prisma.agent_session.deleteMany.mock.calls[0]?.[0].where;
            expect(where.actions.none.OR).toEqual([
                { userId: owner.userId, branchId: owner.branchId, status: { in: ["executing", "uncertain"] } },
                {
                    userId: owner.userId,
                    branchId: owner.branchId,
                    status: { in: ["proposed", "approved"] },
                    expiresAt: { gt: now },
                },
            ]);
        } finally {
            jest.useRealTimers();
        }
    });

    it.each(["executing", "uncertain"])("always blocks deletion for %s regardless of expiry", async () => {
        const prisma = {
            agent_session: {
                deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
                findFirst: jest.fn().mockResolvedValue({ id: "session-a" }),
            },
        };
        const repository = new PrismaAgentSessionRepository(prisma as never);

        await expect(repository.deleteOwned("session-a", owner)).resolves.toBe("blocked");

        expect(prisma.agent_session.deleteMany).toHaveBeenCalledWith(expect.objectContaining({
            where: expect.objectContaining({
                actions: {
                    none: {
                        OR: expect.arrayContaining([
                            { userId: owner.userId, branchId: owner.branchId, status: { in: ["executing", "uncertain"] } },
                        ]),
                    },
                },
            }),
        }));
    });

    it("does not let a mismatched owner action block or identify an owned session", async () => {
        const prisma = {
            agent_session: {
                deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
                findFirst: jest.fn().mockResolvedValue(null),
            },
        };
        const repository = new PrismaAgentSessionRepository(prisma as never);

        await expect(repository.deleteOwned("session-a", owner)).resolves.toBe("not_found");
        expect(prisma.agent_session.findFirst).toHaveBeenCalledWith({ where: { id: "session-a", ...owner }, select: { id: true } });
        expect(prisma.agent_session.deleteMany).toHaveBeenCalledWith(expect.objectContaining({
            where: expect.objectContaining({
                userId: owner.userId,
                branchId: owner.branchId,
                actions: expect.objectContaining({
                    none: expect.objectContaining({
                        OR: expect.arrayContaining([
                            expect.objectContaining({ userId: owner.userId, branchId: owner.branchId }),
                        ]),
                    }),
                }),
            }),
        }));
    });

    it("uses the captured expiry time for cleanup and ignores expired approval actions", async () => {
        const now = new Date("2026-08-04T00:00:00.000Z");
        const prisma = {
            agent_session: {
                deleteMany: jest.fn().mockResolvedValue({ count: 2 }),
            },
        };
        const repository = new PrismaAgentSessionRepository(prisma as never);

        await expect(repository.deleteExpired(now)).resolves.toBe(2);
        expect(prisma.agent_session.deleteMany).toHaveBeenCalledWith({
            where: {
                expiresAt: { lte: now },
                actions: {
                    none: {
                        OR: [
                            { status: { in: ["executing", "uncertain"] } },
                            { status: { in: ["proposed", "approved"] }, expiresAt: { gt: now } },
                        ],
                    },
                },
            },
        });
    });

    it("upserts a scoped result message without changing its createdAt", async () => {
        const message = {
            id: "agent-action-result:action-a",
            role: "assistant",
            parts: [{ type: "data-action-result", data: { actionId: "action-a", status: "succeeded" } }],
        } as BjjUIMessage;
        const prisma = {
            agent_session: { findFirst: jest.fn().mockResolvedValue({ id: "session-a" }) },
            agent_message: {
                findFirst: jest.fn().mockResolvedValue({ id: message.id, createdAt: new Date("2026-08-03T00:00:00.000Z") }),
                updateMany: jest.fn().mockResolvedValue({ count: 1 }),
                create: jest.fn(),
            },
        };
        const repository = new PrismaAgentSessionRepository(prisma as never);

        await expect(repository.upsertActionResultMessage("session-a", owner, message)).resolves.toBe(true);
        expect(prisma.agent_message.create).not.toHaveBeenCalled();
        expect(prisma.agent_message.updateMany).toHaveBeenCalledWith({
            where: { id: message.id, sessionId: "session-a" },
            data: { role: "assistant", parts: message.parts },
        });
    });

    it("does not mutate messages when the session owner does not match", async () => {
        const message = { id: "agent-action-result:action-a", role: "assistant", parts: [] } as BjjUIMessage;
        const prisma = {
            agent_session: { findFirst: jest.fn().mockResolvedValue(null) },
            agent_message: {
                findFirst: jest.fn(),
                updateMany: jest.fn(),
                create: jest.fn(),
            },
        };
        const repository = new PrismaAgentSessionRepository(prisma as never);

        await expect(repository.upsertActionResultMessage("session-a", owner, message)).resolves.toBe(false);
        expect(prisma.agent_message.findFirst).not.toHaveBeenCalled();
        expect(prisma.agent_message.updateMany).not.toHaveBeenCalled();
        expect(prisma.agent_message.create).not.toHaveBeenCalled();
    });

    it("converges a concurrent deterministic insert through an owner-scoped update", async () => {
        const message = { id: "agent-action-result:action-a", role: "assistant", parts: [] } as BjjUIMessage;
        const prisma = {
            agent_session: { findFirst: jest.fn().mockResolvedValue({ id: "session-a" }) },
            agent_message: {
                findFirst: jest.fn().mockResolvedValue(null),
                create: jest.fn().mockRejectedValue({ code: "P2002" }),
                updateMany: jest.fn().mockResolvedValue({ count: 1 }),
            },
        };
        const repository = new PrismaAgentSessionRepository(prisma as never);

        await expect(repository.upsertActionResultMessage("session-a", owner, message)).resolves.toBe(true);
        expect(prisma.agent_message.updateMany).toHaveBeenCalledWith(expect.objectContaining({
            where: { id: message.id, sessionId: "session-a" },
        }));
    });
});
