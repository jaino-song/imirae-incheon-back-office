import { Module } from "@nestjs/common";
import {
    CreateEmployeeScheduleUsecase,
    DeleteEmployeeScheduleUsecase,
    FindEmployeeScheduleByIdUsecase,
    ListEmployeeSchedulesByEmployeeIdUsecase,
    ListEmployeeSchedulesUsecase,
    UpdateEmployeeScheduleUsecase,
} from "application/usecases/employee-schedule";
import { EMPLOYEE_SCHEDULE_REPOSITORY } from "domain/repositories/employee-schedule.repository.interface";
import { SbEmployeeScheduleRepository } from "infrastructure/database/repositories/sb.employee-schedule.repository";
import { PrismaService } from "infrastructure/database/prisma.service";
import { EmployeeScheduleService } from "application/services/employee-schedule.service";
import { EmployeeScheduleController } from "interface/controllers/employee-schedule.controller";

@Module({
    controllers: [EmployeeScheduleController],
    providers: [
        CreateEmployeeScheduleUsecase,
        DeleteEmployeeScheduleUsecase,
        FindEmployeeScheduleByIdUsecase,
        ListEmployeeSchedulesByEmployeeIdUsecase,
        ListEmployeeSchedulesUsecase,
        UpdateEmployeeScheduleUsecase,
        EmployeeScheduleService,
        PrismaService,
        {
            provide: EMPLOYEE_SCHEDULE_REPOSITORY,
            useClass: SbEmployeeScheduleRepository,
        },
    ],
    exports: [EmployeeScheduleService],
})
export class EmployeeScheduleModule {}
