import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { EmployeeEntity } from "domain/entities/employee.entity";
import { EMPLOYEE_REPOSITORY, IEmployeeRepository } from "domain/repositories/employee.repository.interface";

export type UpdateEmployeeParams = {
    name?: string;
    workArea?: string[];
    phone?: string;
    grade?: string;
    openToNextWork?: boolean;
    birthday?: string;
};

export class EmployeeTargetVersionMismatchError extends Error {
    constructor() {
        super("Employee changed after approval; review a new proposal");
        this.name = "EmployeeTargetVersionMismatchError";
    }
}

@Injectable()
export class UpdateEmployeeUsecase {
    constructor(
        @Inject(EMPLOYEE_REPOSITORY)
        private readonly employeeRepository: IEmployeeRepository,
    ) {}

    async execute(
        branchid: string,
        id: number,
        updates: UpdateEmployeeParams
    ): Promise<EmployeeEntity> {
        const employee = await this.employeeRepository.findById(branchid, id);
        if (!employee) {
            throw new NotFoundException(`Employee with id ${id} not found`);
        }

        employee.updateProfile(
            updates.name,
            updates.workArea,
            updates.phone,
            updates.grade,
            updates.openToNextWork,
            updates.birthday,
        );

        return this.employeeRepository.update(branchid, employee);
    }

    /**
     * Approval-bound update. The repository compares and mutates while holding
     * the branch-scoped row lock; there is deliberately no unlocked fallback.
     */
    async executeApprovedTarget(
        branchid: string,
        id: number,
        updates: UpdateEmployeeParams,
        expectedTargetVersion: string,
        transaction?: Prisma.TransactionClient,
    ): Promise<EmployeeEntity> {
        const updated = await this.employeeRepository.updateIfTargetVersion(
            branchid,
            id,
            expectedTargetVersion,
            updates,
            transaction,
        );
        if (updated) return updated;
        throw new EmployeeTargetVersionMismatchError();
    }
}
