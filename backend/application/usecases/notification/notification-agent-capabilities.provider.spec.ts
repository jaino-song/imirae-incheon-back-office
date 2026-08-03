import { NotificationAgentCapabilitiesProvider } from "./notification-agent-capabilities.provider";

const context = {
    actionId: "action-1",
    sessionId: "session-1",
    traceId: "trace-1",
    locale: "ko",
    principal: { userId: "user-1", branchId: "branch-1", globalRole: "admin", branchRole: "admin" },
};

describe("NotificationAgentCapabilitiesProvider", () => {
    const targetUserId = "11111111-1111-4111-8111-111111111111";
    it.each(["disabled", "no-subscriptions", "partial", "failed"])("classifies %s delivery as a failed action", (status) => {
        const provider = new NotificationAgentCapabilitiesProvider({} as never, {} as never);
        const capability = provider.getCapabilities()[0]!;

        expect(capability.classifyOutcome?.({ status, subscriptions: 2, delivered: 1, failed: 1 })).toEqual(
            expect.objectContaining({ status: "failed" }),
        );
    });

    it("classifies complete delivery as success", () => {
        const provider = new NotificationAgentCapabilitiesProvider({} as never, {} as never);
        const capability = provider.getCapabilities()[0]!;

        expect(capability.classifyOutcome?.({ status: "delivered", subscriptions: 2, delivered: 2, failed: 0 })).toEqual({ status: "succeeded" });
    });

    it("preserves a persisted partial outcome during reconciliation", async () => {
        const prisma = { notification: { findFirst: jest.fn().mockResolvedValue({
            id: 9,
            data: { providerOutcome: { status: "partial", subscriptions: 2, delivered: 1, failed: 1 } },
        }) } };
        const provider = new NotificationAgentCapabilitiesProvider({} as never, prisma as never);
        const capability = provider.getCapabilities()[0]!;

        await expect(capability.reconcile?.(context, {}, null)).resolves.toEqual({
            status: "failed",
            reason: "Persisted Web Push outcome: partial",
            result: { status: "partial", notificationId: 9, subscriptions: 2, delivered: 1, failed: 1 },
        });
    });

    it("keeps a notification without a persisted provider outcome uncertain", async () => {
        const prisma = { notification: { findFirst: jest.fn().mockResolvedValue({ id: 10, data: { agentActionId: "action-1" } }) } };
        const provider = new NotificationAgentCapabilitiesProvider({} as never, prisma as never);
        const capability = provider.getCapabilities()[0]!;

        await expect(capability.reconcile?.(context, {}, null)).resolves.toEqual({
            status: "uncertain",
            reason: "Persisted Web Push outcome remains uncertain",
        });
    });

    it("requires the approved membership version at the atomic execution boundary", async () => {
        const membership = { id: "membership-1", role: "admin", joinedAt: new Date("2026-08-04T00:00:00.000Z") };
        const prisma = {
            $transaction: jest.fn(),
            notification: { findFirst: jest.fn().mockResolvedValue(null) },
            user_branch: { findFirst: jest.fn().mockResolvedValue(membership) },
            branch: { findUnique: jest.fn().mockResolvedValue({ ownerId: "owner-1" }) },
            agent_action: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
        };
        prisma.$transaction.mockImplementation(async (callback: (transaction: typeof prisma) => Promise<unknown>) => callback(prisma));
        const sendNotification = { executeWithOutcome: jest.fn() };
        const provider = new NotificationAgentCapabilitiesProvider(sendNotification as never, prisma as never);
        const capability = provider.getCapabilities()[0]!;
        const expected = await capability.inspect!(context, { userId: targetUserId, title: "테스트", body: "본문" });

        prisma.user_branch.findFirst.mockResolvedValue({ ...membership, role: "user" });
        await expect(capability.executeApprovedTarget!(context, { userId: targetUserId, title: "테스트", body: "본문" }, expected.targetVersion!))
            .rejects.toThrow("membership changed");
        expect(sendNotification.executeWithOutcome).not.toHaveBeenCalled();
    });

    it("stages membership authorization before invoking the notification provider", async () => {
        const membership = { id: "membership-1", role: "admin", joinedAt: new Date("2026-08-04T00:00:00.000Z") };
        const prisma = {
            $transaction: jest.fn(),
            notification: { findFirst: jest.fn().mockResolvedValue(null) },
            user_branch: { findFirst: jest.fn().mockResolvedValue(membership) },
            branch: { findUnique: jest.fn().mockResolvedValue({ ownerId: "owner-1" }) },
            agent_action: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
        };
        prisma.$transaction.mockImplementation(async (callback: (transaction: typeof prisma) => Promise<unknown>) => callback(prisma));
        const sendNotification = {
            executeWithOutcome: jest.fn().mockResolvedValue({
                status: "delivered", notification: { id: 8 }, subscriptions: 1, delivered: 1, failed: 0,
            }),
        };
        const provider = new NotificationAgentCapabilitiesProvider(sendNotification as never, prisma as never);
        const capability = provider.getCapabilities()[0]!;
        const expected = await capability.inspect!(context, { userId: targetUserId, title: "테스트", body: "본문" });

        await expect(capability.executeApprovedTarget!(context, { userId: targetUserId, title: "테스트", body: "본문" }, expected.targetVersion!))
            .resolves.toEqual({ status: "delivered", notificationId: 8, subscriptions: 1, delivered: 1, failed: 0 });
        expect(prisma.agent_action.updateMany.mock.invocationCallOrder[0]).toBeLessThan(sendNotification.executeWithOutcome.mock.invocationCallOrder[0]!);
    });
});
