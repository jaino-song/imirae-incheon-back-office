import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { EmployeeScheduleEntity } from "domain/entities/employee-schedule.entity";
import { EMPLOYEE_SCHEDULE_REPOSITORY, IEmployeeScheduleRepository } from "domain/repositories/employee-schedule.repository.interface";

type UpdateEmployeeScheduleParams = {
    primaryEmployeeId?: number;
    secondaryEmployeeId?: number | null;
    workAddress?: string;
    startDate?: Date;
    endDate?: Date;
    replaced?: boolean;
};

@Injectable()
export class UpdateEmployeeScheduleUsecase {
    constructor(
        @Inject(EMPLOYEE_SCHEDULE_REPOSITORY)
        private readonly employeeScheduleRepository: IEmployeeScheduleRepository,
    ) {}

    async execute(
        branchid: string,
        id: number,
        updates: UpdateEmployeeScheduleParams,
        transaction?: Prisma.TransactionClient,
    ): Promise<EmployeeScheduleEntity> {
        const schedule = await this.employeeScheduleRepository.findById(branchid, id, transaction);
        if (!schedule) {
            throw new NotFoundException(`Employee schedule with id ${id} not found`);
        }

        const updated = new EmployeeScheduleEntity(
            schedule.id,
            schedule.clientId, // Client cannot be changed
            updates.primaryEmployeeId ?? schedule.primaryEmployeeId,
            updates.secondaryEmployeeId !== undefined ? updates.secondaryEmployeeId : schedule.secondaryEmployeeId,
            updates.workAddress ?? schedule.workAddress,
            updates.startDate ?? schedule.startDate,
            updates.endDate ?? schedule.endDate,
            updates.replaced ?? schedule.replaced,
        );

        return this.employeeScheduleRepository.update(branchid, updated, transaction);
    }
}
