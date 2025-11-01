import { Injectable } from "@nestjs/common";
import {
    CreateEmployeeScheduleUsecase,
    DeleteEmployeeScheduleUsecase,
    FindEmployeeScheduleByIdUsecase,
    ListEmployeeSchedulesByEmployeeIdUsecase,
    ListEmployeeSchedulesUsecase,
    UpdateEmployeeScheduleUsecase,
} from "application/usecases/employee-schedule";
import { EmployeeScheduleEntity } from "domain/entities/employee-schedule.entity";

@Injectable()
export class EmployeeScheduleService {
    constructor(
        private readonly createEmployeeScheduleUsecase: CreateEmployeeScheduleUsecase,
        private readonly findEmployeeScheduleByIdUsecase: FindEmployeeScheduleByIdUsecase,
        private readonly listEmployeeSchedulesUsecase: ListEmployeeSchedulesUsecase,
        private readonly listEmployeeSchedulesByEmployeeIdUsecase: ListEmployeeSchedulesByEmployeeIdUsecase,
        private readonly updateEmployeeScheduleUsecase: UpdateEmployeeScheduleUsecase,
        private readonly deleteEmployeeScheduleUsecase: DeleteEmployeeScheduleUsecase,
    ) {}

    create(params: {
        employeeId: number;
        workAddress: string;
        startDate: string;
        endDate: string;
        replaced?: boolean;
    }): Promise<EmployeeScheduleEntity> {
        return this.createEmployeeScheduleUsecase.execute({
            employeeId: params.employeeId,
            workAddress: params.workAddress,
            startDate: new Date(params.startDate),
            endDate: new Date(params.endDate),
            replaced: params.replaced,
        });
    }

    findAll(): Promise<EmployeeScheduleEntity[]> {
        return this.listEmployeeSchedulesUsecase.execute();
    }

    findById(id: number): Promise<EmployeeScheduleEntity | null> {
        return this.findEmployeeScheduleByIdUsecase.execute(id);
    }

    findByEmployeeId(employeeId: number): Promise<EmployeeScheduleEntity[]> {
        return this.listEmployeeSchedulesByEmployeeIdUsecase.execute(employeeId);
    }

    update(id: number, params: {
        workAddress?: string;
        startDate?: string;
        endDate?: string;
        replaced?: boolean;
    }): Promise<EmployeeScheduleEntity> {
        return this.updateEmployeeScheduleUsecase.execute(id, {
            workAddress: params.workAddress,
            startDate: params.startDate ? new Date(params.startDate) : undefined,
            endDate: params.endDate ? new Date(params.endDate) : undefined,
            replaced: params.replaced,
        });
    }

    delete(id: number): Promise<void> {
        return this.deleteEmployeeScheduleUsecase.execute(id);
    }
}
