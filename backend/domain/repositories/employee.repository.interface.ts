import { EmployeeEntity } from "domain/entities/employee.entity";

export interface IEmployeeRepository {
    findById(id: number): Promise<EmployeeEntity | null>;
    create(employee: EmployeeEntity): Promise<EmployeeEntity>;
    update(employee: EmployeeEntity): Promise<EmployeeEntity>;
    delete(id: number): Promise<void>;
    findAll(): Promise<EmployeeEntity[]>;
    findByWorkArea(workArea: string): Promise<EmployeeEntity[]>;
    findByGrade(grade: string): Promise<EmployeeEntity[]>;
    findByOpenToNextWork(openToNextWork: boolean): Promise<EmployeeEntity[]>;
    findByRegisteredDate(registeredDate: Date): Promise<EmployeeEntity[]>;
    findByRegisteredDateRange(startDate: Date, endDate: Date): Promise<EmployeeEntity[]>;
    changeOpenToNextWork(id: number, openToNextWork: boolean): Promise<void>;
    findAllOpenToNextWork(): Promise<EmployeeEntity[]>;
}