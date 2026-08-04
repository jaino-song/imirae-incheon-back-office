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
    function setup(
        findResult: EmployeeEntity | null | ((branchId: string, id: number) => EmployeeEntity | null),
        listResult: EmployeeEntity[] = [],
    ) {
        const findEmployee = {
            execute: jest.fn().mockImplementation(async (branchId: string, id: number) =>
                typeof findResult === "function" ? findResult(branchId, id) : findResult),
        };
        const listEmployees = { execute: jest.fn().mockResolvedValue(listResult) };
        const provider = new EmployeeAgentCapabilitiesProvider(listEmployees as never, findEmployee as never);
        return { findEmployee, listEmployees, capabilities: provider.getCapabilities() };
    }

    it("returns a discriminated none result for an empty search", async () => {
        const { listEmployees, capabilities } = setup(null);
        const search = capabilities.find((entry) => entry.meta.name === "employees.search")!;

        await expect(search.execute(context, { query: "없는 직원" })).resolves.toEqual({ kind: "none", query: "없는 직원" });
        expect(listEmployees.execute).toHaveBeenCalledWith("branch-a");
    });

    it("returns one matching employee as an entity result", async () => {
        const match = employee();
        match.status = "available";
        const { capabilities } = setup(null, [match]);
        const search = capabilities.find((entry) => entry.meta.name === "employees.search")!;

        await expect(search.execute(context, { query: "홍길동" })).resolves.toEqual({
            kind: "entity",
            entity: {
                id: 7,
                name: "홍길동",
                grade: "A",
                workArea: ["서울"],
                openToNextWork: true,
                status: "available",
            },
        });
    });

    it("returns choices for multiple matching employees without exposing phone numbers", async () => {
        const first = employee({ id: 7, name: "홍길동" });
        const second = employee({ id: 8, name: "김길동" });
        const { capabilities } = setup(null, [first, second]);
        const search = capabilities.find((entry) => entry.meta.name === "employees.search")!;

        await expect(search.execute(context, { query: "길동" })).resolves.toEqual({
            kind: "choices",
            prompt: "어느 직원을 말씀하시는지 선택해 주세요.",
            choices: [{ id: 7, name: "홍길동" }, { id: 8, name: "김길동" }],
        });
    });

    it("returns active employees by id within the requested branch", async () => {
        const { findEmployee, capabilities } = setup((branchId) => branchId === "branch-a" ? employee() : null);
        const get = capabilities.find((entry) => entry.meta.name === "employees.get")!;

        await expect(get.execute(context, { id: 7 })).resolves.toEqual(expect.objectContaining({
            kind: "entity",
            entity: expect.objectContaining({ id: 7, name: "홍길동" }),
        }));
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
