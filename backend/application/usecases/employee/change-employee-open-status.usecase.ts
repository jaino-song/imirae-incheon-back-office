import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import { EmployeeEntity } from "domain/entities/employee.entity";
import { EMPLOYEE_REPOSITORY, IEmployeeRepository } from "domain/repositories/employee.repository.interface";

@Injectable()
export class ChangeEmployeeOpenStatusUsecase {
    constructor(
        @Inject(EMPLOYEE_REPOSITORY)
        private readonly employeeRepository: IEmployeeRepository,
    ) {}

    async execute(id: number, openToNextWork: boolean): Promise<EmployeeEntity> {
        const employee = await this.employeeRepository.findById(id);
        if (!employee) {
            throw new NotFoundException(`Employee with id ${id} not found`);
        }

        employee.updateOpenToNextWork(openToNextWork);

        return this.employeeRepository.update(employee);
    }
}

