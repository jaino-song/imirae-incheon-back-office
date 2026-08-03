import { Inject, Injectable } from "@nestjs/common";
import { EmployeeEntity } from "domain/entities/employee.entity";
import { EMPLOYEE_REPOSITORY, IEmployeeRepository } from "domain/repositories/employee.repository.interface";
import type { Prisma } from "@prisma/client";

@Injectable()
export class CreateEmployeeUsecase {
    constructor(
        @Inject(EMPLOYEE_REPOSITORY)
        private readonly employeeRepository: IEmployeeRepository,
    ) {}

    execute(
        branchid: string,
        name: string,
        workArea: string[],
        phone: string,
        grade: string,
        openToNextWork: boolean,
        registeredDate?: Date,
        birthday?: string,
        transaction?: Prisma.TransactionClient,
    ): Promise<EmployeeEntity> {
        const employee = EmployeeEntity.create(name, workArea, phone, grade, openToNextWork, registeredDate, birthday);
        return this.employeeRepository.create(branchid, employee, transaction);
    }
}
