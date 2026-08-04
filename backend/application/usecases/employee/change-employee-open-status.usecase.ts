import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { EmployeeEntity } from "domain/entities/employee.entity";
import { EMPLOYEE_REPOSITORY, IEmployeeRepository } from "domain/repositories/employee.repository.interface";
import { EmployeeTargetVersionMismatchError } from "./update-employee.usecase";

@Injectable()
export class ChangeEmployeeOpenStatusUsecase {
    constructor(
        @Inject(EMPLOYEE_REPOSITORY)
        private readonly employeeRepository: IEmployeeRepository,
    ) {}

    async execute(
        branchid: string,
        id: number,
        openToNextWork: boolean
    ): Promise<EmployeeEntity> {
        const employee = await this.employeeRepository.findById(branchid, id);
        if (!employee) {
            throw new NotFoundException(`Employee with id ${id} not found`);
        }

        employee.updateOpenToNextWork(openToNextWork);

        return this.employeeRepository.update(branchid, employee);
    }

    /**
     * Approval-bound availability update. The repository performs the target
     * comparison and mutation under one row-locking transaction.
     */
    async executeApprovedTarget(
        branchid: string,
        id: number,
        openToNextWork: boolean,
        expectedTargetVersion: string,
        transaction?: Prisma.TransactionClient,
    ): Promise<EmployeeEntity> {
        const updated = await this.employeeRepository.updateIfTargetVersion(
            branchid,
            id,
            expectedTargetVersion,
            { openToNextWork },
            transaction,
        );
        if (updated) return updated;
        throw new EmployeeTargetVersionMismatchError();
    }
}
