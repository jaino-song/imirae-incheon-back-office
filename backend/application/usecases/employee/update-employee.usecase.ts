import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import { EmployeeEntity } from "domain/entities/employee.entity";
import { EMPLOYEE_REPOSITORY, IEmployeeRepository } from "domain/repositories/employee.repository.interface";

export type UpdateEmployeeParams = {
    name?: string;
    workArea?: string;
    phone?: string;
    grade?: string;
    openToNextWork?: boolean;
};

@Injectable()
export class UpdateEmployeeUsecase {
    constructor(
        @Inject(EMPLOYEE_REPOSITORY)
        private readonly employeeRepository: IEmployeeRepository,
    ) {}

    async execute(id: number, updates: UpdateEmployeeParams): Promise<EmployeeEntity> {
        const employee = await this.employeeRepository.findById(id);
        if (!employee) {
            throw new NotFoundException(`Employee with id ${id} not found`);
        }

        employee.updateProfile(
            updates.name,
            updates.workArea,
            updates.phone,
            updates.grade,
            updates.openToNextWork,
        );

        return this.employeeRepository.update(employee);
    }
}

