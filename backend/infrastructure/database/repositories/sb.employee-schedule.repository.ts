import { Injectable } from "@nestjs/common";
import { EmployeeScheduleEntity } from "domain/entities/employee-schedule.entity";
import { IEmployeeScheduleRepository } from "domain/repositories/employee-schedule.repository.interface";
import { PrismaService } from "infrastructure/database/prisma.service";
import { EmployeeScheduleMapper } from "infrastructure/database/mapper/employee-schedule.mapper";
import {
    RetentionDeleteBlockedError,
    SCHEDULE_RETENTION_BLOCKED,
    SCHEDULE_RETENTION_BLOCKED_MESSAGE,
    ScopedDeleteNotFoundError,
} from "domain/errors/retention-delete-blocked.error";
import type { Prisma } from "@prisma/client";

@Injectable()
export class SbEmployeeScheduleRepository implements IEmployeeScheduleRepository {
    constructor(private readonly prismaService: PrismaService) {}

    async findById(
        branchid: string,
        id: number,
        transaction?: Prisma.TransactionClient,
    ): Promise<EmployeeScheduleEntity | null> {
        const schedule = await (transaction ?? this.prismaService).employee_schedule.findFirst({
            where: { id, branchId: branchid },
        });
        return schedule ? EmployeeScheduleMapper.toDomain(schedule) : null;
    }

    async findByClientId(branchid: string, clientId: number): Promise<EmployeeScheduleEntity[]> {
        const schedules = await this.prismaService.employee_schedule.findMany({
            where: { clientId: clientId, branchId: branchid },
            orderBy: { id: 'desc' },
        });
        return schedules.map(EmployeeScheduleMapper.toDomain);
    }

    async findByPrimaryEmployeeId(
        branchid: string,
        primaryEmployeeId: number
    ): Promise<EmployeeScheduleEntity[]> {
        const schedules = await this.prismaService.employee_schedule.findMany({
            where: { primaryEmployeeId: primaryEmployeeId, branchId: branchid },
        });
        return schedules.map(EmployeeScheduleMapper.toDomain);
    }

    async findBySecondaryEmployeeId(
        branchid: string,
        secondaryEmployeeId: number
    ): Promise<EmployeeScheduleEntity[]> {
        const schedules = await this.prismaService.employee_schedule.findMany({
            where: { secondaryEmployeeId: secondaryEmployeeId, branchId: branchid },
        });
        return schedules.map(EmployeeScheduleMapper.toDomain);
    }

    async findAll(branchid: string): Promise<EmployeeScheduleEntity[]> {
        const schedules = await this.prismaService.employee_schedule.findMany({
            where: { branchId: branchid },
        });
        return schedules.map(EmployeeScheduleMapper.toDomain);
    }

    async create(
        branchid: string,
        schedule: EmployeeScheduleEntity,
        transaction?: Prisma.TransactionClient,
    ): Promise<EmployeeScheduleEntity> {
        const created = await (transaction ?? this.prismaService).employee_schedule.create({
            data: {
                ...EmployeeScheduleMapper.toPrismaCreate(schedule),
                branchId: branchid,
            },
        });
        return EmployeeScheduleMapper.toDomain(created);
    }

    async update(
        branchid: string,
        schedule: EmployeeScheduleEntity,
        transaction?: Prisma.TransactionClient,
    ): Promise<EmployeeScheduleEntity> {
        const client = transaction ?? this.prismaService;
        const result = await client.employee_schedule.updateMany({
            where: { id: schedule.id, branchId: branchid },
            data: EmployeeScheduleMapper.toPrismaUpdate(schedule),
        });
        if (result.count === 0) {
            throw new Error("Employee schedule not found for branch");
        }
        const updated = await client.employee_schedule.findFirst({
            where: { id: schedule.id, branchId: branchid },
        });
        if (!updated) {
            throw new Error("Employee schedule not found after update");
        }
        return EmployeeScheduleMapper.toDomain(updated);
    }

    async delete(branchid: string, id: number): Promise<void> {
        await this.prismaService.$transaction(async (transaction) => {
            // Hold the branch-scoped schedule row while checking and deleting
            // so child inserts that honour the FK cannot race this guard.
            const lockedRows = await transaction.$queryRaw<Array<{ id: number }>>`
                SELECT "id"
                FROM "employee_schedule"
                WHERE "id" = ${id} AND "branch_id" = ${branchid}::uuid
                FOR UPDATE
            `;
            if (lockedRows.length === 0) {
                throw new ScopedDeleteNotFoundError("schedule", id);
            }

            const dependencyRows = await transaction.$queryRaw<Array<{ count: number }>>`
                SELECT COUNT(*)::int AS "count"
                FROM (
                    SELECT 1 FROM "employee_schedule"
                    WHERE "id" = ${id}
                      AND "start_date" <= (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Seoul')::date
                    UNION ALL
                    SELECT 1 FROM "service_record"
                    WHERE "schedule_id" = ${id}
                    UNION ALL
                    SELECT 1 FROM "service_record_day"
                    WHERE "schedule_id" = ${id}
                    UNION ALL
                    SELECT 1 FROM "service_record_token"
                    WHERE "schedule_id" = ${id}
                    UNION ALL
                    SELECT 1 FROM "service_record_assignment"
                    WHERE "schedule_id" = ${id}
                    UNION ALL
                    SELECT 1 FROM "schedule_change_request"
                    WHERE "schedule_id" = ${id}
                    UNION ALL
                    SELECT 1 FROM "eformsign_doc"
                    WHERE "employee_schedule_id" = ${id}
                    UNION ALL
                    SELECT 1 FROM "message_trigger_job"
                    WHERE "employee_schedule_id" = ${id}
                ) AS "dependencies"
            `;

            if (Number(dependencyRows[0]?.count ?? 0) > 0) {
                throw new RetentionDeleteBlockedError(
                    SCHEDULE_RETENTION_BLOCKED,
                    SCHEDULE_RETENTION_BLOCKED_MESSAGE,
                );
            }

            const result = await transaction.employee_schedule.deleteMany({
                where: { id, branchId: branchid },
            });
            if (result.count !== 1) {
                throw new ScopedDeleteNotFoundError("schedule", id);
            }
        });
    }
}
