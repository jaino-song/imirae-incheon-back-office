import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import { EmployeeScheduleEntity } from "domain/entities/employee-schedule.entity";
import { EMPLOYEE_SCHEDULE_REPOSITORY, IEmployeeScheduleRepository } from "domain/repositories/employee-schedule.repository.interface";

type UpdateEmployeeScheduleParams = {
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

    async execute(id: number, updates: UpdateEmployeeScheduleParams): Promise<EmployeeScheduleEntity> {
        const schedule = await this.employeeScheduleRepository.findById(id);
        if (!schedule) {
            throw new NotFoundException(`Employee schedule with id ${id} not found`);
        }

        const updated = new EmployeeScheduleEntity(
            schedule.id,
            schedule.employeeId,
            updates.workAddress ?? schedule.workAddress,
            updates.startDate ?? schedule.startDate,
            updates.endDate ?? schedule.endDate,
            updates.replaced ?? schedule.replaced,
        );

        return this.employeeScheduleRepository.update(updated);
    }
}
