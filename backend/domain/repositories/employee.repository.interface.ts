import { EmployeeEntity } from "domain/entities/employee.entity";
import type { Prisma } from "@prisma/client";

export interface ActiveClientByEmployee {
    clientId: number;
    clientName: string;
    role: "primary" | "secondary";
    startDate: Date | null;
    endDate: Date | null;
    serviceStatus: string | null;
}

export interface IEmployeeRepository {
    findById(branchid: string, id: number): Promise<EmployeeEntity | null>;
    /**
     * Lock one branch-owned employee row for an approval-bound mutation.
     * Callers must compare the target and mutate through the same transaction.
     */
    findByIdForUpdate(
        branchid: string,
        id: number,
        transaction: Prisma.TransactionClient,
    ): Promise<EmployeeEntity | null>;
    findByPhone(branchid: string, normalizedPhone: string): Promise<EmployeeEntity | null>;
    create(branchid: string, employee: EmployeeEntity, transaction?: Prisma.TransactionClient): Promise<EmployeeEntity>;
    update(branchid: string, employee: EmployeeEntity): Promise<EmployeeEntity>;
    /**
     * Compare the exact approval target while holding the row lock, then
     * apply the update before releasing that lock. A null result is a target
     * conflict and must not fall back to an unlocked update.
     */
    updateIfTargetVersion(
        branchid: string,
        id: number,
        expectedTargetVersion: string,
        updates: Partial<{
            name: string;
            workArea: string[];
            phone: string;
            grade: string;
            openToNextWork: boolean;
            birthday: string;
        }>,
        transaction?: Prisma.TransactionClient,
    ): Promise<EmployeeEntity | null>;
    delete(branchid: string, id: number): Promise<void>;
    hasActiveAssignments?(branchid: string, id: number): Promise<boolean>;
    findActiveClientsByEmployee?(branchid: string, id: number): Promise<ActiveClientByEmployee[]>;
    findAll(branchid: string): Promise<EmployeeEntity[]>;
    findByWorkArea(branchid: string, workArea: string): Promise<EmployeeEntity[]>;
    findByGrade(branchid: string, grade: string): Promise<EmployeeEntity[]>;
    findByOpenToNextWork(branchid: string, openToNextWork: boolean): Promise<EmployeeEntity[]>;
    findByRegisteredDate(branchid: string, registeredDate: Date): Promise<EmployeeEntity[]>;
    findByRegisteredDateRange(branchid: string, startDate: Date, endDate: Date): Promise<EmployeeEntity[]>;
    changeOpenToNextWork(branchid: string, id: number, openToNextWork: boolean): Promise<void>;
    findAllOpenToNextWork(branchid: string): Promise<EmployeeEntity[]>;
}

export const EMPLOYEE_REPOSITORY = "EMPLOYEE_REPOSITORY";
