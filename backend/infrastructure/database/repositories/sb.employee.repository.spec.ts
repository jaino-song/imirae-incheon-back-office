import { EmployeeEntity } from "domain/entities/employee.entity";
import { employeeAgentTargetVersion } from "domain/entities/employee-agent-target";
import { SbEmployeeRepository } from "./sb.employee.repository";

describe("SbEmployeeRepository", () => {
    it("uses an active-row compare-and-set predicate for employee updates", async () => {
        const prisma = { employee: {
            updateMany: jest.fn().mockResolvedValue({ count: 0 }),
            findFirst: jest.fn(),
        } };
        const repository = new SbEmployeeRepository(prisma as never);
        const employee = EmployeeEntity.reconstitute(7, "직원", ["서울"], "01012345678", "A", true, new Date());

        await expect(repository.update("branch-a", employee)).rejects.toThrow("not found");
        expect(prisma.employee.updateMany).toHaveBeenCalledWith(expect.objectContaining({
            where: { id: 7, branchId: "branch-a", deletedAt: null },
        }));
        expect(prisma.employee.findFirst).not.toHaveBeenCalled();
    });

    function row(overrides: Partial<{
        id: number;
        name: string;
        openToNextWork: boolean;
        deletedAt: Date | null;
    }> = {}) {
        return {
            id: overrides.id ?? 7,
            name: overrides.name ?? "직원",
            workArea: ["서울"],
            phone: "01012345678",
            grade: "프리미엄",
            openToNextWork: overrides.openToNextWork ?? true,
            companyRegisteredDate: new Date("2024-01-01T00:00:00.000Z"),
            birthday: null,
            deletedAt: overrides.deletedAt ?? null,
            branchId: "branch-a",
        };
    }

    function transaction() {
        return {
            $queryRaw: jest.fn().mockResolvedValue([]),
            employee: {
                findFirst: jest.fn(),
                updateMany: jest.fn(),
            },
        };
    }

    it("locks the branch-owned row before comparing and mutating", async () => {
        const tx = transaction();
        const initial = row();
        const updated = row({ name: "변경 직원" });
        tx.employee.findFirst.mockResolvedValueOnce(initial).mockResolvedValueOnce(updated);
        tx.employee.updateMany.mockResolvedValue({ count: 1 });
        const repository = new SbEmployeeRepository({ employee: {} } as never);
        const current = EmployeeEntity.reconstitute(
            initial.id, initial.name, initial.workArea, initial.phone, initial.grade,
            initial.openToNextWork, initial.companyRegisteredDate, undefined,
        );

        await expect(repository.updateIfTargetVersion(
            "branch-a",
            initial.id,
            employeeAgentTargetVersion(current),
            { name: "변경 직원" },
            tx as never,
        )).resolves.toMatchObject({ id: initial.id, name: "변경 직원" });

        expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
        expect(tx.employee.updateMany).toHaveBeenCalledWith(expect.objectContaining({
            where: { id: initial.id, branchId: "branch-a", deletedAt: null },
            data: expect.objectContaining({ name: "변경 직원" }),
        }));
    });

    it("does not mutate when another update wins after preliminary revalidation", async () => {
        const tx = transaction();
        const approved = row({ name: "승인 당시 직원" });
        const raced = row({ name: "다른 변경" });
        tx.employee.findFirst.mockResolvedValue(raced);
        const repository = new SbEmployeeRepository({ employee: {} } as never);
        const approvedEntity = EmployeeEntity.reconstitute(
            approved.id, approved.name, approved.workArea, approved.phone, approved.grade,
            approved.openToNextWork, approved.companyRegisteredDate, undefined,
        );

        await expect(repository.updateIfTargetVersion(
            "branch-a",
            approved.id,
            employeeAgentTargetVersion(approvedEntity),
            { name: "에이전트 변경" },
            tx as never,
        )).resolves.toBeNull();
        expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
        expect(tx.employee.updateMany).not.toHaveBeenCalled();
    });

    it("does not mutate a soft-deleted row even when the target hash is stale", async () => {
        const tx = transaction();
        const deleted = row({ deletedAt: new Date("2024-02-01T00:00:00.000Z") });
        tx.employee.findFirst.mockResolvedValue(deleted);
        const repository = new SbEmployeeRepository({ employee: {} } as never);
        const activeEntity = EmployeeEntity.reconstitute(
            deleted.id, deleted.name, deleted.workArea, deleted.phone, deleted.grade,
            deleted.openToNextWork, deleted.companyRegisteredDate, undefined,
        );

        await expect(repository.updateIfTargetVersion(
            "branch-a",
            deleted.id,
            employeeAgentTargetVersion(activeEntity),
            { name: "변경 금지" },
            tx as never,
        )).resolves.toBeNull();
        expect(tx.employee.updateMany).not.toHaveBeenCalled();
    });
});
