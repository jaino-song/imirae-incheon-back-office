import { MessageTemplateWriteAgentCapabilitiesProvider } from "./message-template-write-agent-capabilities.provider";

describe("MessageTemplateWriteAgentCapabilitiesProvider", () => {
    function setup() {
        const createTemplate = { execute: jest.fn().mockResolvedValue({ id: "template-a", name: "안내" }) };
        const transaction = { agent_action: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) } };
        const prisma = {
            $transaction: jest.fn(),
            agent_action: transaction.agent_action,
        };
        prisma.$transaction.mockImplementation(async (operation: (tx: typeof transaction) => Promise<unknown>) => operation(transaction));
        const provider = new MessageTemplateWriteAgentCapabilitiesProvider(
            createTemplate as never,
            { execute: jest.fn() } as never,
            { execute: jest.fn() } as never,
            prisma as never,
        );
        return { createTemplate, transaction, prisma, capabilities: provider.getCapabilities() };
    }

    const context = {
        principal: { userId: "user-a", branchId: "branch-a", globalRole: "admin", branchRole: "admin" },
        sessionId: "session-a", traceId: "trace-a", locale: "ko", actionId: "action-a",
    };

    it("persists template creation and its action receipt through one transaction", async () => {
        const { capabilities, createTemplate, transaction, prisma } = setup();
        const capability = capabilities.find((entry) => entry.meta.name === "messages.createTemplate")!;
        const input = { name: "안내", content: "안녕하세요", variables: [] };

        await expect(capability.execute(context, input)).resolves.toEqual({ id: "template-a", name: "안내", status: "created" });

        expect(prisma.$transaction).toHaveBeenCalledTimes(1);
        expect(createTemplate.execute).toHaveBeenCalledWith("branch-a", input, transaction);
        expect(transaction.agent_action.updateMany).toHaveBeenCalledWith(expect.objectContaining({
            where: expect.objectContaining({ id: "action-a", capability: "messages.createTemplate" }),
        }));
    });

    it("does not report success when the action receipt cannot be persisted", async () => {
        const { capabilities, transaction } = setup();
        transaction.agent_action.updateMany.mockResolvedValue({ count: 0 });
        const capability = capabilities.find((entry) => entry.meta.name === "messages.createTemplate")!;

        await expect(capability.execute(context, { name: "안내", content: "안녕하세요", variables: [] }))
            .rejects.toThrow("receipt could not be persisted");
    });

    it("rejects an id-only template update", () => {
        const { capabilities } = setup();
        const capability = capabilities.find((entry) => entry.meta.name === "messages.updateTemplate")!;

        expect(capability.inputSchema.safeParse({ id: "template-a" }).success).toBe(false);
    });
});
