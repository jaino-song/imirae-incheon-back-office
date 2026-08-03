import { ClientWriteAgentCapabilitiesProvider } from "./client-write-agent-capabilities.provider";

describe("ClientWriteAgentCapabilitiesProvider", () => {
    function setup() {
        const createClient = { execute: jest.fn().mockResolvedValue({ id: 1, name: "홍길동" }) };
        const updateClient = {
            execute: jest.fn().mockResolvedValue({ id: 1, name: "홍길동" }),
            executeApprovedTarget: jest.fn().mockResolvedValue({ id: 1, name: "홍길동" }),
        };
        const existingClient = {
            id: 1,
            name: "홍길동",
            startDate: new Date("2024-01-01T00:00:00.000Z"),
            endDate: new Date("2024-06-01T00:00:00.000Z"),
            serviceStatus: "active",
            areaId: "global",
        };
        const findClient = { execute: jest.fn().mockResolvedValue(existingClient) };
        const clientRepository = { findByPhone: jest.fn().mockResolvedValue(null) };
        const transaction = { agent_action: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) } };
        const prisma = {
            $transaction: jest.fn(async (operation: (tx: typeof transaction) => Promise<unknown>) => operation(transaction)),
            agent_action: transaction.agent_action,
            area: { findFirst: jest.fn().mockResolvedValue({ id: "global" }) },
        };
        const provider = new ClientWriteAgentCapabilitiesProvider(
            createClient as never,
            updateClient as never,
            findClient as never,
            clientRepository as never,
            prisma as never,
        );
        return { createClient, updateClient, findClient, clientRepository, existingClient, prisma, transaction, capabilities: provider.getCapabilities() };
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
            dueDate: new Date("2026-08-03T00:00:00.000Z"),
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

    it("uses the approval-bound client hook instead of the unlocked update path", async () => {
        const { capabilities, updateClient } = setup();
        const capability = capabilities.find((entry) => entry.meta.name === "clients.update")!;
        const context = {
            principal: { userId: "user-a", branchId: "branch-a", globalRole: "admin", branchRole: "admin" },
            sessionId: "session-a", traceId: "trace-a", locale: "ko", actionId: "action-a",
        } as const;

        const result = await capability.executeApprovedTarget!(context, {
            id: 1,
            startDate: "2024-02-29",
            endDate: "2024-03-01",
            dueDate: "2024-02-29",
            birthDate: "1990-02-28T23:30:00-09:00",
        }, "approved-target");

        expect(result).toEqual({ id: 1, name: "홍길동", status: "updated" });
        expect(updateClient.executeApprovedTarget).toHaveBeenCalledWith(
            "branch-a",
            1,
            expect.objectContaining({
                startDate: new Date("2024-02-29T00:00:00.000Z"),
                endDate: new Date("2024-03-01T00:00:00.000Z"),
                dueDate: new Date("2024-02-29T00:00:00.000Z"),
                birthDate: new Date("1990-02-28T00:00:00.000Z"),
            }),
            "approved-target",
        );
        expect(updateClient.execute).not.toHaveBeenCalled();
    });

    it("rejects invalid dates and preserves leap-day calendar dates", async () => {
        const { capabilities, createClient } = setup();
        const capability = capabilities.find((entry) => entry.meta.name === "clients.create")!;
        const context = {
            principal: { userId: "user-a", branchId: "branch-a", globalRole: "admin", branchRole: "admin" },
            sessionId: "session-a", traceId: "trace-a", locale: "ko", actionId: "action-a",
        } as const;

        expect(capability.inputSchema.safeParse({
            name: "홍길동", phone: "01012345678", dueDate: "2024-02-30",
        }).success).toBe(false);

        await capability.execute(context, {
            name: "홍길동",
            phone: "01012345678",
            startDate: "2024-02-29",
            endDate: "2024-03-01",
            dueDate: "2024-02-29",
            birthDate: "1990-02-28T23:30:00-09:00",
        });

        expect(createClient.execute).toHaveBeenCalledWith("branch-a", expect.objectContaining({
            startDate: new Date("2024-02-29T00:00:00.000Z"),
            endDate: new Date("2024-03-01T00:00:00.000Z"),
            dueDate: new Date("2024-02-29T00:00:00.000Z"),
            birthDate: new Date("1990-02-28T00:00:00.000Z"),
        }), expect.anything());
    });

    it("restricts serviceStatus to canonical values and does not invoke create on invalid input", async () => {
        const { capabilities, createClient } = setup();
        const capability = capabilities.find((entry) => entry.meta.name === "clients.create")!;
        const context = {
            principal: { userId: "user-a", branchId: "branch-a", globalRole: "admin", branchRole: "admin" },
            sessionId: "session-a", traceId: "trace-a", locale: "ko", actionId: "action-a",
        } as const;

        expect(capability.inputSchema.safeParse({
            name: "홍길동", phone: "01012345678", serviceStatus: "not-a-status",
        }).success).toBe(false);
        await expect(capability.execute(context, {
            name: "홍길동", phone: "01012345678", serviceStatus: "not-a-status",
        })).rejects.toThrow();
        expect(createClient.execute).not.toHaveBeenCalled();
    });

    it("accepts branch-local and global areas while rejecting foreign areas without enumeration", async () => {
        const { capabilities, createClient, prisma } = setup();
        const capability = capabilities.find((entry) => entry.meta.name === "clients.create")!;
        const context = {
            principal: { userId: "user-a", branchId: "branch-a", globalRole: "admin", branchRole: "admin" },
            sessionId: "session-a", traceId: "trace-a", locale: "ko", actionId: "action-a",
        } as const;

        prisma.area.findFirst
            .mockResolvedValueOnce({ id: "local" })
            .mockResolvedValueOnce({ id: "global" })
            .mockResolvedValueOnce(null);
        await capability.execute(context, { name: "홍길동", phone: "01011112222", areaId: "local" });
        await capability.execute(context, { name: "김영희", phone: "01033334444", areaId: "global" });
        await expect(capability.execute(context, {
            name: "박철수", phone: "01055556666", areaId: "foreign",
        })).rejects.toThrow("areaId must reference an available area");

        expect(prisma.area.findFirst).toHaveBeenNthCalledWith(1, expect.objectContaining({
            where: { id: "local", OR: [{ branchId: "branch-a" }, { branchId: null }] },
        }));
        expect(createClient.execute).toHaveBeenCalledTimes(2);
    });

    it("normalizes formatted phones and allows the current target to retain its own phone", async () => {
        const { capabilities, clientRepository, existingClient, updateClient, createClient } = setup();
        const createCapability = capabilities.find((entry) => entry.meta.name === "clients.create")!;
        const updateCapability = capabilities.find((entry) => entry.meta.name === "clients.update")!;
        const context = {
            principal: { userId: "user-a", branchId: "branch-a", globalRole: "admin", branchRole: "admin" },
            sessionId: "session-a", traceId: "trace-a", locale: "ko", actionId: "action-a",
        } as const;

        clientRepository.findByPhone.mockResolvedValueOnce(existingClient);
        await expect(createCapability.execute(context, {
            name: "신규", phone: "010-1234-5678",
        })).rejects.toThrow("phone");
        expect(clientRepository.findByPhone).toHaveBeenLastCalledWith("branch-a", "01012345678");
        expect(createClient.execute).not.toHaveBeenCalled();

        clientRepository.findByPhone.mockResolvedValueOnce(existingClient);
        await updateCapability.execute(context, { id: 1, phone: "010-1234-5678" });
        expect(updateClient.execute).toHaveBeenCalledWith("branch-a", 1, expect.objectContaining({ phone: "010-1234-5678" }));

        clientRepository.findByPhone.mockResolvedValueOnce({ ...existingClient, id: 2 });
        await expect(updateCapability.execute(context, { id: 1, phone: "010 1234 5678" })).rejects.toThrow("phone");
        expect(updateClient.execute).toHaveBeenCalledTimes(1);
    });

    it("merges partial dates before direct and approved updates, allowing equal or null dates", async () => {
        const { capabilities, updateClient } = setup();
        const capability = capabilities.find((entry) => entry.meta.name === "clients.update")!;
        const context = {
            principal: { userId: "user-a", branchId: "branch-a", globalRole: "admin", branchRole: "admin" },
            sessionId: "session-a", traceId: "trace-a", locale: "ko", actionId: "action-a",
        } as const;

        await expect(capability.execute(context, { id: 1, endDate: "2023-12-31" })).rejects.toThrow("서비스 시작일은 종료일보다 늦을 수 없습니다.");
        expect(updateClient.execute).not.toHaveBeenCalled();

        await capability.execute(context, { id: 1, endDate: "2024-01-01" });
        await capability.execute(context, { id: 1, startDate: null });
        expect(updateClient.execute).toHaveBeenCalledTimes(2);
        expect(updateClient.execute).toHaveBeenLastCalledWith("branch-a", 1, expect.objectContaining({ startDate: null }));

        await expect(capability.executeApprovedTarget!(context, { id: 1, startDate: "2025-01-01", endDate: "2024-01-01" }, "approved-target"))
            .rejects.toThrow("서비스 시작일은 종료일보다 늦을 수 없습니다.");
        expect(updateClient.executeApprovedTarget).not.toHaveBeenCalled();

        await capability.executeApprovedTarget!(context, { id: 1, startDate: null }, "approved-target");
        expect(updateClient.executeApprovedTarget).toHaveBeenCalledWith("branch-a", 1, expect.objectContaining({ startDate: null }), "approved-target");
    });
});
