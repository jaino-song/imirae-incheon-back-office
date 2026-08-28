import { Module } from "@nestjs/common";
import {
    ChangeEmployeeOpenStatusUsecase,
    CreateEmployeeUsecase,
    DeleteEmployeeUsecase,
    FindEmployeeByIdUsecase,
    ListActiveClientsByEmployeeUsecase,
    ListWorkHistoryByEmployeeUsecase,
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
import { DatabaseModule } from "infrastructure/database/database.module";
import { SbEmployeeRepository } from "infrastructure/database/repositories/sb.employee.repository";
import { EmployeeController } from "interface/controllers/employee.controller";
import { EmployeeAgentCapabilitiesProvider } from "application/usecases/employee/employee-agent-capabilities.provider";
import { EmployeeWriteAgentCapabilitiesProvider } from "application/usecases/employee/employee-write-agent-capabilities.provider";
import { ServiceRecordEntryModule } from "./service-record-entry.module";
import { MessageModule } from "./message.module";

@Module({
    imports: [DatabaseModule, MessageModule, ServiceRecordEntryModule],
    controllers: [EmployeeController],
    providers: [
        CreateEmployeeUsecase,
        FindEmployeeByIdUsecase,
        ListActiveClientsByEmployeeUsecase,
        ListWorkHistoryByEmployeeUsecase,
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
        EmployeeAgentCapabilitiesProvider,
        EmployeeWriteAgentCapabilitiesProvider,
        {
            provide: EMPLOYEE_REPOSITORY,
            useClass: SbEmployeeRepository,
        },
    ],
    exports: [EmployeeService],
})
export class EmployeeModule {}
