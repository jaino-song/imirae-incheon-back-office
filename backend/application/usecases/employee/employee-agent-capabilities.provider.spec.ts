import { EmployeeEntity } from "domain/entities/employee.entity";
import { EmployeeAgentCapabilitiesProvider } from "./employee-agent-capabilities.provider";

const context = {
    principal: { userId: "user-a", branchId: "branch-a", globalRole: "admin", branchRole: "admin" },
    sessionId: "session-a", traceId: "trace-a", locale: "ko",
};

function employee(overrides: Partial<{
    id: number;
    name: string;
    deletedAt: Date;
}> = {}) {
    return EmployeeEntity.reconstitute(
        overrides.id ?? 7,
        overrides.name ?? "홍길동",
        ["서울"],
        "01012345678",
        "A",
        true,
        new Date("2024-01-01T00:00:00.000Z"),
        undefined,
        overrides.deletedAt,
    );
}

describe("EmployeeAgentCapabilitiesProvider", () => {
    function setup(findResult: EmployeeEntity | null | ((branchId: string, id: number) => EmployeeEntity | null)) {
        const findEmployee = {
            execute: jest.fn().mockImplementation(async (branchId: string, id: number) =>
                typeof findResult === "function" ? findResult(branchId, id) : findResult),
        };
        const listEmployees = { execute: jest.fn().mockResolvedValue([]) };
        const provider = new EmployeeAgentCapabilitiesProvider(listEmployees as never, findEmployee as never);
        return { findEmployee, capabilities: provider.getCapabilities() };
    }

    it("returns active employees by id within the requested branch", async () => {
        const { findEmployee, capabilities } = setup((branchId) => branchId === "branch-a" ? employee() : null);
        const get = capabilities.find((entry) => entry.meta.name === "employees.get")!;

        await expect(get.execute(context, { id: 7 })).resolves.toEqual(expect.objectContaining({ id: 7, name: "홍길동" }));
        expect(findEmployee.execute).toHaveBeenCalledWith("branch-a", 7);
    });

    it.each([
        ["missing", null],
        ["soft-deleted", employee({ deletedAt: new Date("2024-02-01T00:00:00.000Z") })],
    ])("fails closed for %s employees", async (_label, result) => {
        const { capabilities } = setup(result);
        const get = capabilities.find((entry) => entry.meta.name === "employees.get")!;

        await expect(get.execute(context, { id: 7 })).rejects.toThrow("Employee not found");
    });

    it("fails closed when the employee belongs to another branch", async () => {
        const { findEmployee, capabilities } = setup((branchId) => branchId === "branch-b" ? employee() : null);
        const get = capabilities.find((entry) => entry.meta.name === "employees.get")!;

        await expect(get.execute(context, { id: 7 })).rejects.toThrow("Employee not found");
        expect(findEmployee.execute).toHaveBeenCalledWith("branch-a", 7);
    });
});
