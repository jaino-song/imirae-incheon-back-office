import { EmployeeEntity } from "domain/entities/employee.entity";
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
});
