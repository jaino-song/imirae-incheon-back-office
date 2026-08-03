import { NotificationAgentCapabilitiesProvider } from "./notification-agent-capabilities.provider";

const context = {
    actionId: "action-1",
    sessionId: "session-1",
    traceId: "trace-1",
    locale: "ko",
    principal: { userId: "user-1", branchId: "branch-1", globalRole: "admin", branchRole: "admin" },
};

describe("NotificationAgentCapabilitiesProvider", () => {
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
});
