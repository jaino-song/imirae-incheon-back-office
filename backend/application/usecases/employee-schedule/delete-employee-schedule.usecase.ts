import { ConflictException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { EMPLOYEE_SCHEDULE_REPOSITORY, IEmployeeScheduleRepository } from "domain/repositories/employee-schedule.repository.interface";
import {
    RetentionDeleteBlockedError,
    SCHEDULE_RETENTION_BLOCKED,
    SCHEDULE_RETENTION_BLOCKED_MESSAGE,
    ScopedDeleteNotFoundError,
} from "domain/errors/retention-delete-blocked.error";

@Injectable()
export class DeleteEmployeeScheduleUsecase {
    constructor(
        @Inject(EMPLOYEE_SCHEDULE_REPOSITORY)
        private readonly employeeScheduleRepository: IEmployeeScheduleRepository,
    ) {}

    async execute(branchid: string, id: number): Promise<void> {
        const schedule = await this.employeeScheduleRepository.findById(branchid, id);
        if (!schedule) {
            throw new NotFoundException(`Employee schedule with id ${id} not found`);
        }

        try {
            await this.employeeScheduleRepository.delete(branchid, id);
        } catch (error) {
            if (error instanceof ScopedDeleteNotFoundError) {
                throw new NotFoundException(`Employee schedule with id ${id} not found`);
            }
            if (error instanceof RetentionDeleteBlockedError) {
                throw new ConflictException({
                    code: SCHEDULE_RETENTION_BLOCKED,
                    message: SCHEDULE_RETENTION_BLOCKED_MESSAGE,
                });
            }
            throw error;
        }
    }
}
