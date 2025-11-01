import { Inject, Injectable } from "@nestjs/common";
import { EmployeeScheduleEntity } from "domain/entities/employee-schedule.entity";
import { EMPLOYEE_SCHEDULE_REPOSITORY, IEmployeeScheduleRepository } from "domain/repositories/employee-schedule.repository.interface";

@Injectable()
export class FindEmployeeScheduleByIdUsecase {
    constructor(
        @Inject(EMPLOYEE_SCHEDULE_REPOSITORY)
        private readonly employeeScheduleRepository: IEmployeeScheduleRepository,
    ) {}

    execute(id: number): Promise<EmployeeScheduleEntity | null> {
        return this.employeeScheduleRepository.findById(id);
    }
}
