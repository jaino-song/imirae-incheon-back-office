import { ClientWriteAgentCapabilitiesProvider } from "./client-write-agent-capabilities.provider";

describe("ClientWriteAgentCapabilitiesProvider", () => {
    function setup() {
        const createClient = { execute: jest.fn().mockResolvedValue({ id: 1, name: "홍길동" }) };
        const transaction = { agent_action: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) } };
        const prisma = {
            $transaction: jest.fn(async (operation: (tx: typeof transaction) => Promise<unknown>) => operation(transaction)),
            agent_action: transaction.agent_action,
        };
        const provider = new ClientWriteAgentCapabilitiesProvider(
            createClient as never,
            { execute: jest.fn() } as never,
            { execute: jest.fn() } as never,
            { execute: jest.fn().mockResolvedValue({ data: [] }) } as never,
            prisma as never,
        );
        return { createClient, prisma, transaction, capabilities: provider.getCapabilities() };
    }

    it("accepts date-only values emitted by date form controls", async () => {
        const { createClient, capabilities } = setup();
        const capability = capabilities.find((entry) => entry.meta.name === "clients.create")!;
        const input = { name: "홍길동", phone: "01012345678", dueDate: "2026-08-03" };

        expect(capability.inputSchema.safeParse(input).success).toBe(true);
        await capability.execute({
            principal: { userId: "user-a", branchId: "branch-a", globalRole: "admin", branchRole: "admin" },
            sessionId: "session-a", traceId: "trace-a", locale: "ko", actionId: "action-a",
        }, input);

        expect(createClient.execute).toHaveBeenCalledWith("branch-a", expect.objectContaining({
            dueDate: new Date("2026-08-03T00:00:00+09:00"),
        }), expect.objectContaining({ agent_action: expect.any(Object) }));
        expect(capability.inputSchema.safeParse({ ...input, dueDate: "2026-02-31" }).success).toBe(false);
    });

    it("rolls client creation and its action receipt through one transaction", async () => {
        const { capabilities, prisma, transaction } = setup();
        const capability = capabilities.find((entry) => entry.meta.name === "clients.create")!;

        await capability.execute({
            principal: { userId: "user-a", branchId: "branch-a", globalRole: "admin", branchRole: "admin" },
            sessionId: "session-a", traceId: "trace-a", locale: "ko", actionId: "action-a",
        }, { name: "홍길동", phone: "01012345678" });

        expect(prisma.$transaction).toHaveBeenCalledTimes(1);
        expect(transaction.agent_action.updateMany).toHaveBeenCalledWith(expect.objectContaining({
            where: expect.objectContaining({ id: "action-a", capability: "clients.create" }),
        }));
    });

    it("does not report a created client when the action receipt cannot be persisted", async () => {
        const { capabilities, transaction, createClient } = setup();
        transaction.agent_action.updateMany.mockResolvedValue({ count: 0 });
        const capability = capabilities.find((entry) => entry.meta.name === "clients.create")!;

        await expect(capability.execute({
            principal: { userId: "user-a", branchId: "branch-a", globalRole: "admin", branchRole: "admin" },
            sessionId: "session-a", traceId: "trace-a", locale: "ko", actionId: "action-a",
        }, { name: "홍길동", phone: "01012345678" })).rejects.toThrow("receipt could not be persisted");

        expect(createClient.execute).toHaveBeenCalledWith("branch-a", expect.any(Object), transaction);
    });

    it("offers every client update field without requiring unrelated values", () => {
        const { capabilities } = setup();
        const capability = capabilities.find((entry) => entry.meta.name === "clients.update")!;
        const fields = capability.formFields ?? [];

        expect(fields.find((field) => field.name === "id")?.required).toBe(true);
        expect(fields.find((field) => field.name === "phone")).toEqual(expect.objectContaining({ required: false }));
        expect(fields.find((field) => field.name === "name")).toEqual(expect.objectContaining({ required: false }));
        expect(capability.inputSchema.safeParse({ id: 1 }).success).toBe(false);
        expect(capability.inputSchema.safeParse({ id: 1, targetVersion: "v1" }).success).toBe(false);
        expect(capability.inputSchema.safeParse({ id: 1, phone: "01012345678" }).success).toBe(true);
    });
});
