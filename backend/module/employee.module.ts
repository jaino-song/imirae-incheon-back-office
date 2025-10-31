import { Module } from "@nestjs/common";
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
import { EmployeeService } from "application/services/employee.service";
import { EMPLOYEE_REPOSITORY } from "domain/repositories/employee.repository.interface";
import { PrismaService } from "infrastructure/database/prisma.service";
import { SbEmployeeRepository } from "infrastructure/database/repositories/sb.employee.repository";
import { EmployeeController } from "interface/controllers/employee.controller";

@Module({
    controllers: [EmployeeController],
    providers: [
        CreateEmployeeUsecase,
        FindEmployeeByIdUsecase,
        UpdateEmployeeUsecase,
        DeleteEmployeeUsecase,
        ListEmployeesUsecase,
        ListEmployeesByWorkAreaUsecase,
        ListEmployeesByGradeUsecase,
        ListEmployeesByOpenStatusUsecase,
        ListEmployeesByRegisteredDateUsecase,
        ListEmployeesByRegisteredDateRangeUsecase,
        ChangeEmployeeOpenStatusUsecase,
        ListEmployeesOpenToNextWorkUsecase,
        EmployeeService,
        PrismaService,
        {
            provide: EMPLOYEE_REPOSITORY,
            useClass: SbEmployeeRepository,
        },
    ],
    exports: [EmployeeService],
})
export class EmployeeModule {}

