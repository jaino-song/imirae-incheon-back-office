import { Inject, Injectable } from "@nestjs/common";
import { EmployeeScheduleEntity } from "domain/entities/employee-schedule.entity";
import { EMPLOYEE_SCHEDULE_REPOSITORY, IEmployeeScheduleRepository } from "domain/repositories/employee-schedule.repository.interface";

type CreateEmployeeScheduleParams = {
    employeeId: number;
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

    execute(params: CreateEmployeeScheduleParams): Promise<EmployeeScheduleEntity> {
        const schedule = EmployeeScheduleEntity.create(
            params.employeeId,
            params.workAddress,
            params.startDate,
            params.endDate,
            params.replaced ?? false,
        );
        return this.employeeScheduleRepository.create(schedule);
    }
}
