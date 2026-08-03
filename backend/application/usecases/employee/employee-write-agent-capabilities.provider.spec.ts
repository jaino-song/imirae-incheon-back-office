import { EmployeeEntity } from "domain/entities/employee.entity";
import { EmployeeWriteAgentCapabilitiesProvider } from "./employee-write-agent-capabilities.provider";

const context = {
    principal: { userId: "user-a", branchId: "branch-a", globalRole: "admin", branchRole: "admin" },
    sessionId: "session-a", traceId: "trace-a", locale: "ko", actionId: "action-a",
};

describe("EmployeeWriteAgentCapabilitiesProvider", () => {
    function setup(employee: EmployeeEntity | null) {
        const createEmployee = { execute: jest.fn() };
        const updateEmployee = { execute: jest.fn() };
        const changeAvailability = { execute: jest.fn() };
        const findEmployee = { execute: jest.fn().mockResolvedValue(employee) };
        const transaction = { agent_action: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) } };
        const prisma = { $transaction: jest.fn(async (operation: (tx: typeof transaction) => Promise<unknown>) => operation(transaction)), agent_action: transaction.agent_action };
        const provider = new EmployeeWriteAgentCapabilitiesProvider(
            createEmployee as never,
            updateEmployee as never,
            changeAvailability as never,
            findEmployee as never,
            prisma as never,
        );
        return { createEmployee, updateEmployee, changeAvailability, findEmployee, transaction, prisma, capabilities: provider.getCapabilities() };
    }

    it("fails soft-deleted employees closed across inspect, revalidate, execute, and reconcile", async () => {
        const deleted = EmployeeEntity.reconstitute(7, "삭제 직원", ["서울"], "01012345678", "A", false, new Date(), undefined, new Date());
        const { updateEmployee, changeAvailability, capabilities } = setup(deleted);
        const update = capabilities.find((entry) => entry.meta.name === "employees.update")!;
        const availability = capabilities.find((entry) => entry.meta.name === "employees.changeAvailability")!;

        await expect(update.inspect!(context, { id: 7, name: "변경" })).rejects.toThrow("deleted");
        await expect(update.revalidate!(context, { id: 7, name: "변경" }, "old")).resolves.toEqual(expect.objectContaining({ valid: false }));
        await expect(update.execute(context, { id: 7, name: "변경" })).rejects.toMatchObject({ name: "AgentActionCertainFailureError" });
        await expect(update.reconcile!(context, { id: 7, name: "변경" }, null)).resolves.toEqual(expect.objectContaining({ status: "failed" }));
        await expect(availability.execute(context, { id: 7, openToNextWork: true })).rejects.toMatchObject({ name: "AgentActionCertainFailureError" });
        await expect(availability.reconcile!(context, { id: 7, openToNextWork: true }, null)).resolves.toEqual(expect.objectContaining({ status: "failed" }));
        expect(updateEmployee.execute).not.toHaveBeenCalled();
        expect(changeAvailability.execute).not.toHaveBeenCalled();
    });

    it("rejects an id-only employee update", () => {
        const { capabilities } = setup(null);
        const update = capabilities.find((entry) => entry.meta.name === "employees.update")!;
        expect(update.inputSchema.safeParse({ id: 7 }).success).toBe(false);
    });

    it("records employee creation receipt in the same transaction as the canonical create", async () => {
        const { createEmployee, transaction, prisma, capabilities } = setup(null);
        const created = EmployeeEntity.reconstitute(42, "홍길동", ["서울"], "01012345678", "A", false, new Date());
        createEmployee.execute.mockResolvedValue(created);
        const create = capabilities.find((entry) => entry.meta.name === "employees.create")!;

        await expect(create.execute(context, {
            name: "홍길동",
            workArea: ["서울"],
            phone: "01012345678",
            grade: "A",
            openToNextWork: false,
        })).resolves.toEqual({ id: 42, name: "홍길동", status: "created" });

        expect(prisma.$transaction).toHaveBeenCalledTimes(1);
        expect(createEmployee.execute).toHaveBeenCalledWith(
            "branch-a", "홍길동", ["서울"], "01012345678", "A", false, undefined, undefined, transaction,
        );
        expect(transaction.agent_action.updateMany.mock.invocationCallOrder[0]).toBeGreaterThan(
            createEmployee.execute.mock.invocationCallOrder[0]!,
        );
    });
});
