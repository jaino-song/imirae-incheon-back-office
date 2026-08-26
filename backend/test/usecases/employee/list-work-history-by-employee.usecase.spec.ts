import { NotFoundException } from "@nestjs/common";
import {
    EmployeeWorkHistoryByEmployee,
    IEmployeeRepository,
} from "domain/repositories/employee.repository.interface";
import { ListWorkHistoryByEmployeeUsecase } from "application/usecases/employee/list-work-history-by-employee.usecase";
import { EmployeeFactory, MockEmployeeRepository } from "../../utils";

describe("ListWorkHistoryByEmployeeUsecase", () => {
    const branchId = "org-1";
    const page = 2;
    const limit = 20;
    let repository: MockEmployeeRepository & Pick<Required<IEmployeeRepository>, "findWorkHistoryByEmployee">;
    let usecase: ListWorkHistoryByEmployeeUsecase;

    beforeEach(() => {
        repository = new MockEmployeeRepository() as MockEmployeeRepository & Pick<
            Required<IEmployeeRepository>,
            "findWorkHistoryByEmployee"
        >;
        repository.findWorkHistoryByEmployee = jest.fn().mockResolvedValue({
            data: [],
            total: 0,
            page,
            limit,
            totalPages: 0,
        });
        usecase = new ListWorkHistoryByEmployeeUsecase(repository);
    });

    it("returns branch-scoped paginated history with replacement and completion states", async () => {
        const employee = EmployeeFactory.create({ id: 7 });
        const data: EmployeeWorkHistoryByEmployee[] = [
            {
                scheduleId: 22,
                clientId: 11,
                clientName: "박서연",
                role: "secondary",
                startDate: new Date("2025-01-01"),
                endDate: new Date("2025-06-30"),
                status: "replaced",
            },
            {
                scheduleId: 21,
                clientId: 10,
                clientName: "김민지",
                role: "primary",
                startDate: new Date("2024-01-01"),
                endDate: new Date("2024-12-31"),
                status: "completed",
            },
        ];
        const result = { data, total: 22, page, limit, totalPages: 2 };
        repository.setData([employee]);
        jest.mocked(repository.findWorkHistoryByEmployee).mockResolvedValue(result);

        await expect(usecase.execute(branchId, 7, page, limit)).resolves.toEqual(result);
        expect(repository.findWorkHistoryByEmployee).toHaveBeenCalledWith(branchId, 7, page, limit);
    });

    it("does not query history for an employee outside the selected branch", async () => {
        await expect(usecase.execute(branchId, 999, 1, limit)).rejects.toEqual(
            new NotFoundException("직원을 찾을 수 없습니다."),
        );
        expect(repository.findWorkHistoryByEmployee).not.toHaveBeenCalled();
    });

    it("returns a genuine empty page for a soft-deleted employee", async () => {
        const deletedEmployee = EmployeeFactory.create({ id: 7 });
        Object.defineProperty(deletedEmployee, "deletedAt", { value: new Date("2026-07-01") });
        repository.setData([deletedEmployee]);

        await expect(usecase.execute(branchId, 7, 1, limit)).resolves.toEqual({
            data: [],
            total: 0,
            page: 1,
            limit,
            totalPages: 0,
        });
        expect(repository.findWorkHistoryByEmployee).not.toHaveBeenCalled();
    });
});
