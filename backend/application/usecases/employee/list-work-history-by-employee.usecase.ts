import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import {
    EMPLOYEE_REPOSITORY,
    IEmployeeRepository,
    PaginatedEmployeeWorkHistory,
} from "domain/repositories/employee.repository.interface";

@Injectable()
export class ListWorkHistoryByEmployeeUsecase {
    constructor(
        @Inject(EMPLOYEE_REPOSITORY)
        private readonly employeeRepository: IEmployeeRepository,
    ) {}

    async execute(
        branchid: string,
        employeeId: number,
        page: number,
        limit: number,
    ): Promise<PaginatedEmployeeWorkHistory> {
        const employee = await this.employeeRepository.findById(branchid, employeeId);
        if (!employee) {
            throw new NotFoundException("직원을 찾을 수 없습니다.");
        }
        if (employee.deletedAt) {
            return { data: [], total: 0, page, limit, totalPages: 0 };
        }
        if (!this.employeeRepository.findWorkHistoryByEmployee) {
            throw new Error("Employee repository does not support work history lookups");
        }
        return this.employeeRepository.findWorkHistoryByEmployee(branchid, employeeId, page, limit);
    }
}
