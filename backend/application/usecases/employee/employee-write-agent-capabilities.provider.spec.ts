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

    it.each(["프리미엄", "베스트", "스탠다드"])("accepts canonical employee grade %s", (grade) => {
        const { capabilities } = setup(null);
        const create = capabilities.find((entry) => entry.meta.name === "employees.create")!;

        expect(create.inputSchema.safeParse({
            name: "홍길동",
            workArea: ["서울"],
            phone: "01012345678",
            grade,
        })).toEqual(expect.objectContaining({ success: true }));
    });

    it("normalizes the legacy standard-grade spelling before create and update execution", async () => {
        const employee = EmployeeEntity.reconstitute(7, "홍길동", ["서울"], "01012345678", "프리미엄", false, new Date(), undefined);
        const { createEmployee, updateEmployee, capabilities } = setup(employee);
        const create = capabilities.find((entry) => entry.meta.name === "employees.create")!;
        const update = capabilities.find((entry) => entry.meta.name === "employees.update")!;
        const created = EmployeeEntity.reconstitute(8, "김길동", ["서울"], "01012345679", "스탠다드", false, new Date(), undefined);
        createEmployee.execute.mockResolvedValue(created);
        updateEmployee.execute.mockResolvedValue(employee);

        expect(create.inputSchema.safeParse({
            name: "김길동",
            workArea: ["서울"],
            phone: "01012345678",
            grade: "  스텐다드 ",
        })).toMatchObject({ success: true, data: { grade: "스탠다드" } });
        await create.execute(context, {
            name: "김길동",
            workArea: ["서울"],
            phone: "01012345678",
            grade: "스텐다드",
        });
        expect(createEmployee.execute).toHaveBeenCalledWith(
            "branch-a", "김길동", ["서울"], "01012345678", "스탠다드", false, undefined, undefined, expect.anything(),
        );

        await update.execute(context, { id: 7, grade: "스텐다드" });
        expect(updateEmployee.execute).toHaveBeenCalledWith("branch-a", 7, { grade: "스탠다드" });
    });

    it.each(["", " ", "골드", "A", "스탠다드2"])("rejects invalid employee grade %j without invoking mutation or lookup usecases", async (grade) => {
        const employee = EmployeeEntity.reconstitute(7, "홍길동", ["서울"], "01012345678", "프리미엄", false, new Date(), undefined);
        const { createEmployee, updateEmployee, findEmployee, prisma, capabilities } = setup(employee);
        const create = capabilities.find((entry) => entry.meta.name === "employees.create")!;
        const update = capabilities.find((entry) => entry.meta.name === "employees.update")!;
        const createInput = { name: "김길동", workArea: ["서울"], phone: "01012345678", grade };
        const updateInput = { id: 7, grade };

        expect(create.inputSchema.safeParse(createInput).success).toBe(false);
        expect(update.inputSchema.safeParse(updateInput).success).toBe(false);
        await expect(create.execute(context, createInput)).rejects.toThrow();
        await expect(update.inspect!(context, updateInput)).rejects.toThrow();
        await expect(update.revalidate!(context, updateInput, "version")).rejects.toThrow();
        await expect(update.execute(context, updateInput)).rejects.toThrow();
        await expect(update.executeApprovedTarget!(context, updateInput, "version")).rejects.toThrow();

        expect(prisma.$transaction).not.toHaveBeenCalled();
        expect(createEmployee.execute).not.toHaveBeenCalled();
        expect(updateEmployee.execute).not.toHaveBeenCalled();
        expect(findEmployee.execute).not.toHaveBeenCalled();
    });

    it.each(["900101", "000229", "240229", "991231"])("accepts calendar-valid YYMMDD birthday %s", (birthday) => {
        const { capabilities } = setup(null);
        const create = capabilities.find((entry) => entry.meta.name === "employees.create")!;
        const update = capabilities.find((entry) => entry.meta.name === "employees.update")!;

        expect(create.inputSchema.safeParse({
            name: "홍길동",
            workArea: ["서울"],
            phone: "01012345678",
            grade: "프리미엄",
            birthday,
        })).toEqual(expect.objectContaining({ success: true }));
        expect(update.inputSchema.safeParse({ id: 7, birthday })).toEqual(expect.objectContaining({ success: true }));
    });

    it.each(["1990-01-01", "90010", "9001011", "90A101", "901300", "900231", "230229"])("rejects malformed or impossible birthday %j", (birthday) => {
        const { capabilities } = setup(null);
        const create = capabilities.find((entry) => entry.meta.name === "employees.create")!;
        const update = capabilities.find((entry) => entry.meta.name === "employees.update")!;

        expect(create.inputSchema.safeParse({
            name: "홍길동",
            workArea: ["서울"],
            phone: "01012345678",
            grade: "프리미엄",
            birthday,
        }).success).toBe(false);
        expect(update.inputSchema.safeParse({ id: 7, birthday }).success).toBe(false);
    });

    it("does not invoke create, update, or lookup usecases for invalid birthdays", async () => {
        const employee = EmployeeEntity.reconstitute(7, "홍길동", ["서울"], "01012345678", "프리미엄", false, new Date(), undefined);
        const { createEmployee, updateEmployee, findEmployee, prisma, capabilities } = setup(employee);
        const create = capabilities.find((entry) => entry.meta.name === "employees.create")!;
        const update = capabilities.find((entry) => entry.meta.name === "employees.update")!;
        const createInput = { name: "김길동", workArea: ["서울"], phone: "01012345678", grade: "프리미엄", birthday: "1990-01-01" };
        const updateInput = { id: 7, birthday: "900231" };

        await expect(create.execute(context, createInput)).rejects.toThrow();
        await expect(update.inspect!(context, updateInput)).rejects.toThrow();
        await expect(update.revalidate!(context, updateInput, "version")).rejects.toThrow();
        await expect(update.execute(context, updateInput)).rejects.toThrow();
        await expect(update.executeApprovedTarget!(context, updateInput, "version")).rejects.toThrow();

        expect(prisma.$transaction).not.toHaveBeenCalled();
        expect(createEmployee.execute).not.toHaveBeenCalled();
        expect(updateEmployee.execute).not.toHaveBeenCalled();
        expect(findEmployee.execute).not.toHaveBeenCalled();
    });

    it("describes birthday input as numeric YYMMDD text in create and update forms", () => {
        const { capabilities } = setup(null);
        const create = capabilities.find((entry) => entry.meta.name === "employees.create")!;
        const update = capabilities.find((entry) => entry.meta.name === "employees.update")!;
        const expectedBirthdayField = expect.objectContaining({
            name: "birthday",
            label: "생년월일",
            type: "text",
            inputMode: "numeric",
            placeholder: "YYMMDD",
            maxLength: 6,
        });

        expect(create.formFields).toEqual(expect.arrayContaining([expectedBirthdayField]));
        expect(update.formFields).toEqual(expect.arrayContaining([expectedBirthdayField]));
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
            grade: "프리미엄",
            openToNextWork: false,
        })).resolves.toEqual({ id: 42, name: "홍길동", status: "created" });

        expect(prisma.$transaction).toHaveBeenCalledTimes(1);
        expect(createEmployee.execute).toHaveBeenCalledWith(
            "branch-a", "홍길동", ["서울"], "01012345678", "프리미엄", false, undefined, undefined, transaction,
        );
        expect(transaction.agent_action.updateMany.mock.invocationCallOrder[0]).toBeGreaterThan(
            createEmployee.execute.mock.invocationCallOrder[0]!,
        );
    });
});
