import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import { EMPLOYEE_SCHEDULE_REPOSITORY, IEmployeeScheduleRepository } from "domain/repositories/employee-schedule.repository.interface";

@Injectable()
export class DeleteEmployeeScheduleUsecase {
    constructor(
        @Inject(EMPLOYEE_SCHEDULE_REPOSITORY)
        private readonly employeeScheduleRepository: IEmployeeScheduleRepository,
    ) {}

    async execute(id: number): Promise<void> {
        const schedule = await this.employeeScheduleRepository.findById(id);
        if (!schedule) {
            throw new NotFoundException(`Employee schedule with id ${id} not found`);
        }

        await this.employeeScheduleRepository.delete(id);
    }
}
