import { Prisma } from "@prisma/client";
import { EmployeeEntity } from "domain/entities/employee.entity";
import { AgentActionCertainFailureError } from "application/agent/action-coordinator.service";
import { EmployeeWriteAgentCapabilitiesProvider } from "./employee-write-agent-capabilities.provider";

const context = {
    principal: { userId: "user-a", branchId: "branch-a", globalRole: "admin", branchRole: "admin" },
    sessionId: "session-a", traceId: "trace-a", locale: "ko", actionId: "action-a",
};

describe("EmployeeWriteAgentCapabilitiesProvider", () => {
    function setup(employee: EmployeeEntity | null) {
        const createEmployee = { execute: jest.fn() };
        const updateEmployee = { execute: jest.fn(), executeApprovedTarget: jest.fn() };
        const changeAvailability = { execute: jest.fn() };
        const findEmployee = { execute: jest.fn().mockResolvedValue(employee) };
        const employeeRepository = { findByPhone: jest.fn().mockResolvedValue(null) };
        const triggerService = { syncEmployeeAssignmentRulesForEmployee: jest.fn().mockResolvedValue(undefined) };
        const transaction = { agent_action: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) } };
        const prisma = { $transaction: jest.fn(async (operation: (tx: typeof transaction) => Promise<unknown>) => operation(transaction)), agent_action: transaction.agent_action };
        const provider = new EmployeeWriteAgentCapabilitiesProvider(
            createEmployee as never,
            updateEmployee as never,
            changeAvailability as never,
            findEmployee as never,
            employeeRepository as never,
            prisma as never,
            triggerService as never,
        );
        return { createEmployee, updateEmployee, changeAvailability, findEmployee, employeeRepository, triggerService, transaction, prisma, capabilities: provider.getCapabilities() };
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

    it.each([
        ["constraint name", "employee_branch_id_phone_key"],
        ["branchId target fields", ["branchId", "phone"]],
        ["branch_id target fields", ["branch_id", "phone"]],
    ])("converts employee phone conflicts from %s into a certain failure without recording an effect", async (_label, target) => {
        const { createEmployee, transaction, capabilities } = setup(null);
        const conflict = new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
            code: "P2002",
            clientVersion: "test",
            meta: { target },
        });
        createEmployee.execute.mockRejectedValue(conflict);
        const create = capabilities.find((entry) => entry.meta.name === "employees.create")!;

        const error = await create.execute(context, {
            name: "홍길동",
            workArea: ["서울"],
            phone: "01012345678",
            grade: "프리미엄",
        }).catch((caught) => caught);

        expect(error).toBeInstanceOf(AgentActionCertainFailureError);
        expect(transaction.agent_action.updateMany).not.toHaveBeenCalled();
    });

    it.each([
        ["unrelated unique constraint", new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
            code: "P2002",
            clientVersion: "test",
            meta: { target: ["email"] },
        })],
        ["different composite unique constraint", new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
            code: "P2002",
            clientVersion: "test",
            meta: { target: ["branchId", "phone", "name"] },
        })],
        ["unrelated database error", new Error("database unavailable")],
    ])("passes through %s unchanged", async (_label, error) => {
        const { createEmployee, capabilities } = setup(null);
        createEmployee.execute.mockRejectedValue(error);
        const create = capabilities.find((entry) => entry.meta.name === "employees.create")!;

        await expect(create.execute(context, {
            name: "홍길동",
            workArea: ["서울"],
            phone: "01012345678",
            grade: "프리미엄",
        })).rejects.toBe(error);
    });

    it("persists a normalized phone on employee creation", async () => {
        const { createEmployee, employeeRepository, capabilities } = setup(null);
        createEmployee.execute.mockResolvedValue(EmployeeEntity.reconstitute(42, "홍길동", ["서울"], "01012345678", "A", false, new Date()));
        const create = capabilities.find((entry) => entry.meta.name === "employees.create")!;

        await create.execute(context, {
            name: "홍길동", workArea: ["서울"], phone: "010-1234-5678", grade: "프리미엄",
        });

        expect(employeeRepository.findByPhone).toHaveBeenCalledWith("branch-a", "01012345678");
        expect(createEmployee.execute).toHaveBeenCalledWith(
            "branch-a", "홍길동", ["서울"], "01012345678", "프리미엄", false, undefined, undefined, expect.anything(),
        );
    });

    it.each([
        ["010-1234-5678", "01012345678"],
        ["01012345678", "01012345678"],
    ])("rejects a create preflight duplicate for formatted/raw phone %s", async (inputPhone, normalizedPhone) => {
        const existing = EmployeeEntity.reconstitute(8, "기존 직원", ["서울"], normalizedPhone, "A", true, new Date());
        const { createEmployee, employeeRepository, capabilities } = setup(null);
        employeeRepository.findByPhone.mockResolvedValue(existing);
        const create = capabilities.find((entry) => entry.meta.name === "employees.create")!;

        await expect(create.execute(context, {
            name: "신규 직원", workArea: ["서울"], phone: inputPhone, grade: "프리미엄",
        })).rejects.toBeInstanceOf(AgentActionCertainFailureError);

        expect(employeeRepository.findByPhone).toHaveBeenCalledWith("branch-a", normalizedPhone);
        expect(createEmployee.execute).not.toHaveBeenCalled();
    });

    it.each([
        ["010-1234-5678", "01012345678"],
        ["01012345678", "01012345678"],
    ])("persists a normalized phone on direct updates for formatted/raw input %s", async (inputPhone, normalizedPhone) => {
        const existing = EmployeeEntity.reconstitute(7, "홍길동", ["서울"], normalizedPhone, "A", true, new Date());
        const { updateEmployee, employeeRepository, capabilities } = setup(existing);
        updateEmployee.execute.mockResolvedValue(existing);
        const update = capabilities.find((entry) => entry.meta.name === "employees.update")!;

        await update.execute(context, { id: 7, phone: inputPhone });

        expect(employeeRepository.findByPhone).toHaveBeenCalledWith("branch-a", normalizedPhone);
        expect(updateEmployee.execute).toHaveBeenCalledWith("branch-a", 7, { phone: normalizedPhone });
    });

    it.each([
        ["name", { name: "김길동" }, { name: "김길동" }],
        ["phone", { phone: "010-9999-0000" }, { phone: "01099990000" }],
    ])("refreshes assignment jobs after a direct employee %s update", async (_label, input, persisted) => {
        const existing = EmployeeEntity.reconstitute(7, "홍길동", ["서울"], "01012345678", "A", true, new Date());
        const persistedProfile = persisted as { name?: string; phone?: string };
        const updated = EmployeeEntity.reconstitute(7, persistedProfile.name ?? existing.name, ["서울"], persistedProfile.phone ?? existing.phone, "A", true, new Date());
        const { updateEmployee, triggerService, capabilities } = setup(existing);
        updateEmployee.execute.mockResolvedValue(updated);
        const update = capabilities.find((entry) => entry.meta.name === "employees.update")!;

        await update.execute(context, { id: 7, ...input });

        expect(triggerService.syncEmployeeAssignmentRulesForEmployee).toHaveBeenCalledTimes(1);
        expect(triggerService.syncEmployeeAssignmentRulesForEmployee).toHaveBeenCalledWith("branch-a", 7);
    });

    it.each([
        ["unrelated field", { grade: "프리미엄" }],
        ["same name", { name: "홍길동" }],
        ["same normalized phone", { phone: "010-1234-5678" }],
    ])("does not refresh assignment jobs for %s on a direct employee update", async (_label, input) => {
        const existing = EmployeeEntity.reconstitute(7, "홍길동", ["서울"], "01012345678", "A", true, new Date());
        const { updateEmployee, triggerService, capabilities } = setup(existing);
        updateEmployee.execute.mockResolvedValue(existing);
        const update = capabilities.find((entry) => entry.meta.name === "employees.update")!;

        await update.execute(context, { id: 7, ...input });

        expect(triggerService.syncEmployeeAssignmentRulesForEmployee).not.toHaveBeenCalled();
    });

    it("does not duplicate assignment refreshes across repeated identical direct updates", async () => {
        const existing = EmployeeEntity.reconstitute(7, "홍길동", ["서울"], "01012345678", "A", true, new Date());
        const updated = EmployeeEntity.reconstitute(7, "김길동", ["서울"], "01012345678", "A", true, new Date());
        const { findEmployee, updateEmployee, triggerService, capabilities } = setup(existing);
        findEmployee.execute.mockResolvedValueOnce(existing).mockResolvedValue(updated);
        updateEmployee.execute.mockResolvedValue(updated);
        const update = capabilities.find((entry) => entry.meta.name === "employees.update")!;

        await update.execute(context, { id: 7, name: "김길동" });
        await update.execute(context, { id: 7, name: "김길동" });

        expect(triggerService.syncEmployeeAssignmentRulesForEmployee).toHaveBeenCalledTimes(1);
    });

    it.each([
        ["name", { name: "김길동" }, { name: "김길동" }],
        ["phone", { phone: "010-9999-0000" }, { phone: "01099990000" }],
    ])("refreshes assignment jobs after an approval-bound employee %s update", async (_label, input, persisted) => {
        const existing = EmployeeEntity.reconstitute(7, "홍길동", ["서울"], "01012345678", "A", true, new Date());
        const persistedProfile = persisted as { name?: string; phone?: string };
        const updated = EmployeeEntity.reconstitute(7, persistedProfile.name ?? existing.name, ["서울"], persistedProfile.phone ?? existing.phone, "A", true, new Date());
        const { updateEmployee, triggerService, capabilities } = setup(existing);
        updateEmployee.executeApprovedTarget.mockResolvedValue(updated);
        const update = capabilities.find((entry) => entry.meta.name === "employees.update")!;

        await update.executeApprovedTarget!(context, { id: 7, ...input }, "approved-target");

        expect(triggerService.syncEmployeeAssignmentRulesForEmployee).toHaveBeenCalledTimes(1);
        expect(triggerService.syncEmployeeAssignmentRulesForEmployee).toHaveBeenCalledWith("branch-a", 7);
    });

    it("persists a normalized phone on approval-bound updates", async () => {
        const existing = EmployeeEntity.reconstitute(7, "홍길동", ["서울"], "01012345678", "A", true, new Date());
        const { updateEmployee, employeeRepository, capabilities } = setup(existing);
        updateEmployee.executeApprovedTarget.mockResolvedValue(existing);
        const update = capabilities.find((entry) => entry.meta.name === "employees.update")!;

        await update.executeApprovedTarget!(context, { id: 7, phone: "010-1234-5678" }, "approved-target");

        expect(employeeRepository.findByPhone).toHaveBeenCalledWith("branch-a", "01012345678");
        expect(updateEmployee.executeApprovedTarget).toHaveBeenCalledWith(
            "branch-a", 7, { phone: "01012345678" }, "approved-target",
        );
    });

    it("reconciles formatted phone input against the normalized persisted value", async () => {
        const existing = EmployeeEntity.reconstitute(7, "홍길동", ["서울"], "01012345678", "A", true, new Date());
        const { capabilities } = setup(existing);
        const update = capabilities.find((entry) => entry.meta.name === "employees.update")!;

        await expect(update.reconcile!(context, { id: 7, phone: "010-1234-5678" }, null)).resolves.toEqual({
            status: "succeeded",
            result: { id: 7, name: "홍길동", status: "updated" },
        });
    });

    it.each([
        ["direct update", "execute"],
        ["approval-bound update", "executeApprovedTarget"],
    ])("allows %s to retain its own normalized phone", async (_label, updateMethod) => {
        const existing = EmployeeEntity.reconstitute(7, "홍길동", ["서울"], "01012345678", "A", true, new Date());
        const { updateEmployee, employeeRepository, capabilities } = setup(existing);
        employeeRepository.findByPhone.mockResolvedValue(existing);
        updateEmployee[updateMethod as "execute" | "executeApprovedTarget"].mockResolvedValue(existing);
        const update = capabilities.find((entry) => entry.meta.name === "employees.update")!;

        const result = updateMethod === "execute"
            ? update.execute(context, { id: 7, phone: "010-1234-5678" })
            : update.executeApprovedTarget!(context, { id: 7, phone: "010-1234-5678" }, "approved-target");

        await expect(result).resolves.toEqual({ id: 7, name: "홍길동", status: "updated" });
        expect(employeeRepository.findByPhone).toHaveBeenCalledWith("branch-a", "01012345678");
    });

    it.each([
        ["create", "execute"],
        ["direct update", "execute"],
        ["approval-bound update", "executeApprovedTarget"],
    ])("rejects an empty normalized phone before the %s write", async (_label, operation) => {
        const existing = EmployeeEntity.reconstitute(7, "홍길동", ["서울"], "01012345678", "A", true, new Date());
        const { createEmployee, updateEmployee, employeeRepository, capabilities } = setup(operation === "create" ? null : existing);
        const create = capabilities.find((entry) => entry.meta.name === "employees.create")!;
        const update = capabilities.find((entry) => entry.meta.name === "employees.update")!;

        const result = operation === "create"
            ? create.execute(context, { name: "홍길동", workArea: ["서울"], phone: "---", grade: "프리미엄" })
            : operation === "execute"
                ? update.execute(context, { id: 7, phone: "---" })
                : update.executeApprovedTarget!(context, { id: 7, phone: "---" }, "approved-target");

        await expect(result).rejects.toBeInstanceOf(AgentActionCertainFailureError);
        expect(employeeRepository.findByPhone).not.toHaveBeenCalled();
        expect(createEmployee.execute).not.toHaveBeenCalled();
        expect(updateEmployee.execute).not.toHaveBeenCalled();
        expect(updateEmployee.executeApprovedTarget).not.toHaveBeenCalled();
    });

    it.each([
        ["create", "employee_branch_id_phone_key"],
        ["create", ["branchId", "phone"]],
        ["create", ["branch_id", "phone"]],
        ["direct update", "employee_branch_id_phone_key"],
        ["direct update", ["branchId", "phone"]],
        ["direct update", ["branch_id", "phone"]],
        ["approval-bound update", "employee_branch_id_phone_key"],
        ["approval-bound update", ["branchId", "phone"]],
        ["approval-bound update", ["branch_id", "phone"]],
    ])("maps concurrent %s phone conflicts to a certain failure", async (operation, target) => {
        const existing = EmployeeEntity.reconstitute(7, "홍길동", ["서울"], "01012345678", "A", true, new Date());
        const { createEmployee, updateEmployee, employeeRepository, capabilities } = setup(operation === "create" ? null : existing);
        const conflict = new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
            code: "P2002", clientVersion: "test", meta: { target },
        });
        employeeRepository.findByPhone.mockResolvedValue(null);
        createEmployee.execute.mockRejectedValue(conflict);
        updateEmployee.execute.mockRejectedValue(conflict);
        updateEmployee.executeApprovedTarget.mockRejectedValue(conflict);
        const create = capabilities.find((entry) => entry.meta.name === "employees.create")!;
        const update = capabilities.find((entry) => entry.meta.name === "employees.update")!;

        const result = operation === "create"
            ? create.execute(context, { name: "홍길동", workArea: ["서울"], phone: "010-1234-5678", grade: "프리미엄" })
            : operation === "direct update"
                ? update.execute(context, { id: 7, phone: "010-1234-5678" })
                : update.executeApprovedTarget!(context, { id: 7, phone: "010-1234-5678" }, "approved-target");

        await expect(result).rejects.toBeInstanceOf(AgentActionCertainFailureError);
    });

    it.each([
        ["create", new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
            code: "P2002", clientVersion: "test", meta: { target: ["email"] },
        })],
        ["direct update", new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
            code: "P2002", clientVersion: "test", meta: { target: ["branchId", "phone", "name"] },
        })],
        ["approval-bound update", new Error("database unavailable")],
    ])("preserves unrelated %s write errors", async (operation, error) => {
        const existing = EmployeeEntity.reconstitute(7, "홍길동", ["서울"], "01012345678", "A", true, new Date());
        const { createEmployee, updateEmployee, capabilities } = setup(operation === "create" ? null : existing);
        createEmployee.execute.mockRejectedValue(error);
        updateEmployee.execute.mockRejectedValue(error);
        updateEmployee.executeApprovedTarget.mockRejectedValue(error);
        const create = capabilities.find((entry) => entry.meta.name === "employees.create")!;
        const update = capabilities.find((entry) => entry.meta.name === "employees.update")!;

        const result = operation === "create"
            ? create.execute(context, { name: "홍길동", workArea: ["서울"], phone: "01012345678", grade: "프리미엄" })
            : operation === "direct update"
                ? update.execute(context, { id: 7, phone: "01012345678" })
                : update.executeApprovedTarget!(context, { id: 7, phone: "01012345678" }, "approved-target");

        await expect(result).rejects.toBe(error);
    });
});
