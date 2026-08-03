import { ClientWriteAgentCapabilitiesProvider } from "./client-write-agent-capabilities.provider";

describe("ClientWriteAgentCapabilitiesProvider", () => {
    function setup() {
        const createClient = { execute: jest.fn().mockResolvedValue({ id: 1, name: "홍길동" }) };
        const provider = new ClientWriteAgentCapabilitiesProvider(
            createClient as never,
            { execute: jest.fn() } as never,
            { execute: jest.fn() } as never,
            { execute: jest.fn().mockResolvedValue({ data: [] }) } as never,
            { agent_action: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) } } as never,
        );
        return { createClient, capabilities: provider.getCapabilities() };
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
        }));
        expect(capability.inputSchema.safeParse({ ...input, dueDate: "2026-02-31" }).success).toBe(false);
    });
});
