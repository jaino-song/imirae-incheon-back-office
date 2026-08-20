import { Inject, Injectable } from "@nestjs/common";
import { EmployeeScheduleEntity } from "domain/entities/employee-schedule.entity";
import { EMPLOYEE_SCHEDULE_REPOSITORY, IEmployeeScheduleRepository } from "domain/repositories/employee-schedule.repository.interface";
import type { Prisma } from "@prisma/client";

type CreateEmployeeScheduleParams = {
    clientId: number;
    primaryEmployeeId: number;
    secondaryEmployeeId: number | null;
    workAddress: string;
    startDate: Date;
    endDate: Date;
    replaced?: boolean;
};

@Injectable()
export class CreateEmployeeScheduleUsecase {
    constructor(
        @Inject(EMPLOYEE_SCHEDULE_REPOSITORY)
        private readonly employeeScheduleRepository: IEmployeeScheduleRepository,
    ) {}

    execute(
        branchid: string,
        params: CreateEmployeeScheduleParams,
        transaction?: Prisma.TransactionClient,
    ): Promise<EmployeeScheduleEntity> {
        const schedule = EmployeeScheduleEntity.create(
            params.clientId,
            params.primaryEmployeeId,
            params.secondaryEmployeeId,
            params.workAddress,
            params.startDate,
            params.endDate,
            params.replaced ?? false,
        );
        return this.employeeScheduleRepository.create(branchid, schedule, transaction);
    }
}
