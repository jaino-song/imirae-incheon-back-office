import { Injectable } from "@nestjs/common";
import {
    ChangeEmployeeOpenStatusUsecase,
    CreateEmployeeUsecase,
    DeleteEmployeeUsecase,
    FindEmployeeByIdUsecase,
    ListEmployeesByGradeUsecase,
    ListEmployeesByOpenStatusUsecase,
    ListEmployeesByRegisteredDateRangeUsecase,
    ListEmployeesByRegisteredDateUsecase,
    ListEmployeesByWorkAreaUsecase,
    ListEmployeesOpenToNextWorkUsecase,
    ListEmployeesUsecase,
    UpdateEmployeeUsecase,
} from "application/usecases/employee";
import { EmployeeEntity } from "domain/entities/employee.entity";

export type EmployeeUpdateParams = {
    name?: string;
    workArea?: string;
    phone?: string;
    grade?: string;
    openToNextWork?: boolean;
};

@Injectable()
export class EmployeeService {
    constructor(
        private readonly createEmployeeUsecase: CreateEmployeeUsecase,
        private readonly findEmployeeByIdUsecase: FindEmployeeByIdUsecase,
        private readonly updateEmployeeUsecase: UpdateEmployeeUsecase,
        private readonly deleteEmployeeUsecase: DeleteEmployeeUsecase,
        private readonly listEmployeesUsecase: ListEmployeesUsecase,
        private readonly listEmployeesByWorkAreaUsecase: ListEmployeesByWorkAreaUsecase,
        private readonly listEmployeesByGradeUsecase: ListEmployeesByGradeUsecase,
        private readonly listEmployeesByOpenStatusUsecase: ListEmployeesByOpenStatusUsecase,
        private readonly listEmployeesByRegisteredDateUsecase: ListEmployeesByRegisteredDateUsecase,
        private readonly listEmployeesByRegisteredDateRangeUsecase: ListEmployeesByRegisteredDateRangeUsecase,
        private readonly changeEmployeeOpenStatusUsecase: ChangeEmployeeOpenStatusUsecase,
        private readonly listEmployeesOpenToNextWorkUsecase: ListEmployeesOpenToNextWorkUsecase,
    ) {}

    create(params: { name: string; workArea: string; phone: string; grade: string; openToNextWork: boolean; registeredDate?: string }): Promise<EmployeeEntity> {
        return this.createEmployeeUsecase.execute(
            params.name,
            params.workArea,
            params.phone,
            params.grade,
            params.openToNextWork,
            params.registeredDate ? new Date(params.registeredDate) : undefined,
        );
    }

    findById(id: number): Promise<EmployeeEntity | null> {
        return this.findEmployeeByIdUsecase.execute(id);
    }

    update(id: number, params: EmployeeUpdateParams): Promise<EmployeeEntity> {
        return this.updateEmployeeUsecase.execute(id, params);
    }

    delete(id: number): Promise<void> {
        return this.deleteEmployeeUsecase.execute(id);
    }

    findAll(): Promise<EmployeeEntity[]> {
        return this.listEmployeesUsecase.execute();
    }

    findByWorkArea(workArea: string): Promise<EmployeeEntity[]> {
        return this.listEmployeesByWorkAreaUsecase.execute(workArea);
    }

    findByGrade(grade: string): Promise<EmployeeEntity[]> {
        return this.listEmployeesByGradeUsecase.execute(grade);
    }

    findByOpenStatus(openToNextWork: boolean): Promise<EmployeeEntity[]> {
        return this.listEmployeesByOpenStatusUsecase.execute(openToNextWork);
    }

    findByRegisteredDate(date: Date): Promise<EmployeeEntity[]> {
        return this.listEmployeesByRegisteredDateUsecase.execute(date);
    }

    findByRegisteredDateRange(start: Date, end: Date): Promise<EmployeeEntity[]> {
        return this.listEmployeesByRegisteredDateRangeUsecase.execute(start, end);
    }

    changeOpenStatus(id: number, open: boolean): Promise<EmployeeEntity> {
        return this.changeEmployeeOpenStatusUsecase.execute(id, open);
    }

    findAllOpenToNextWork(): Promise<EmployeeEntity[]> {
        return this.listEmployeesOpenToNextWorkUsecase.execute();
    }
}

