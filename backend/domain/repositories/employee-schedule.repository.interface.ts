import { EmployeeScheduleEntity } from "domain/entities/employee-schedule.entity";
import type { Prisma } from "@prisma/client";

export interface IEmployeeScheduleRepository {
    findById(branchid: string, id: number): Promise<EmployeeScheduleEntity | null>;
    findByClientId(branchid: string, clientId: number): Promise<EmployeeScheduleEntity[]>;
    findByPrimaryEmployeeId(
        branchid: string,
        primaryEmployeeId: number
    ): Promise<EmployeeScheduleEntity[]>;
    findBySecondaryEmployeeId(
        branchid: string,
        secondaryEmployeeId: number
    ): Promise<EmployeeScheduleEntity[]>;
    findAll(branchid: string): Promise<EmployeeScheduleEntity[]>;
    create(
        branchid: string,
        schedule: EmployeeScheduleEntity,
        transaction?: Prisma.TransactionClient,
    ): Promise<EmployeeScheduleEntity>;
    update(branchid: string, schedule: EmployeeScheduleEntity): Promise<EmployeeScheduleEntity>;
    delete(branchid: string, id: number): Promise<void>;
}

export const EMPLOYEE_SCHEDULE_REPOSITORY = "EMPLOYEE_SCHEDULE_REPOSITORY";
