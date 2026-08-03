import { PrismaAgentActionRepository } from "./prisma-agent-action.repository";

describe("PrismaAgentActionRepository", () => {
    const owner = { userId: "user-a", branchId: "branch-a" };
    const input = {
        ...owner,
        id: "action-a",
        sessionId: "session-a",
        capability: "clients.update",
        capabilityVersion: "1.0.0",
        risk: "reversible-write" as const,
        status: "proposed" as const,
        proposal: { input: { id: 3 }, locale: "ko" },
        proposalRevision: "revision",
        inputHash: "hash",
        targetSnapshot: { id: 3 },
        targetVersion: "target-v1",
        authorizationContext: owner,
        expiresAt: new Date("2026-08-04T01:00:00.000Z"),
        idempotencyKey: "idempotency",
        requestDedupeKey: "dedupe",
        dedupeExpiresAt: new Date("2026-08-04T01:00:00.000Z"),
    };

    function transactionFor(session: { archivedAt: Date | null; expiresAt: Date }) {
        return {
            $queryRaw: jest.fn().mockResolvedValue([{ id: "session-a", ...session }]),
            agent_action: {
                create: jest.fn().mockResolvedValue({
                    ...input,
                    createdAt: new Date("2026-08-04T00:00:00.000Z"),
                    updatedAt: new Date("2026-08-04T00:00:00.000Z"),
                    approvedBy: null,
                    approvedAt: null,
                    rejectedBy: null,
                    rejectedAt: null,
                    result: null,
                    error: null,
                    executedAt: null,
                    executionAttemptCount: 0,
                    resultPartPersistedAt: null,
                }),
            },
        };
    }

    it("locks the owner-scoped active session before inserting the action", async () => {
        const transaction = transactionFor({ archivedAt: null, expiresAt: new Date("2026-08-05T00:00:00.000Z") });
        const events: string[] = [];
        transaction.$queryRaw.mockImplementation(async () => {
            events.push("session-lock");
            return [{ id: "session-a", archivedAt: null, expiresAt: new Date("2026-08-05T00:00:00.000Z") }];
        });
        transaction.agent_action.create.mockImplementation(async () => {
            events.push("action-insert");
            return {
                ...input,
                createdAt: new Date("2026-08-04T00:00:00.000Z"),
                updatedAt: new Date("2026-08-04T00:00:00.000Z"),
                approvedBy: null,
                approvedAt: null,
                rejectedBy: null,
                rejectedAt: null,
                result: null,
                error: null,
                executedAt: null,
                executionAttemptCount: 0,
                resultPartPersistedAt: null,
            };
        });
        const prisma = {
            $transaction: jest.fn().mockImplementation(async (callback: (tx: typeof transaction) => Promise<unknown>) => callback(transaction)),
        };
        const repository = new PrismaAgentActionRepository(prisma as never);

        await expect(repository.createInActiveSession(input)).resolves.toEqual(expect.objectContaining({ status: "created" }));
        expect(transaction.$queryRaw).toHaveBeenCalledWith(expect.anything());
        expect(transaction.agent_action.create).toHaveBeenCalledWith(expect.objectContaining({
            data: expect.objectContaining({ id: input.id, sessionId: input.sessionId, userId: owner.userId, branchId: owner.branchId }),
        }));
        expect(events).toEqual(["session-lock", "action-insert"]);
    });

    it.each([
        ["not_found", []],
        ["archived", [{ id: "session-a", archivedAt: new Date(), expiresAt: new Date("2026-08-05T00:00:00.000Z") }]],
        ["expired", [{ id: "session-a", archivedAt: null, expiresAt: new Date("2026-08-03T00:00:00.000Z") }]],
    ] as const)("returns a typed %s outcome without creating an action", async (status, locked) => {
        const transaction = {
            $queryRaw: jest.fn().mockResolvedValue(locked),
            agent_action: { create: jest.fn() },
        };
        const prisma = { $transaction: jest.fn().mockImplementation(async (callback: (tx: typeof transaction) => Promise<unknown>) => callback(transaction)) };
        const repository = new PrismaAgentActionRepository(prisma as never);

        await expect(repository.createInActiveSession(input)).resolves.toEqual({ status });
        expect(transaction.agent_action.create).not.toHaveBeenCalled();
    });
});
