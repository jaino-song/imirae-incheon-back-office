import { Injectable } from "@nestjs/common";
import { EmployeeScheduleEntity } from "domain/entities/employee-schedule.entity";
import { IEmployeeScheduleRepository } from "domain/repositories/employee-schedule.repository.interface";
import { PrismaService } from "infrastructure/database/prisma.service";
import { EmployeeScheduleMapper } from "infrastructure/database/mapper/employee-schedule.mapper";
import type { Prisma } from "@prisma/client";

@Injectable()
export class SbEmployeeScheduleRepository implements IEmployeeScheduleRepository {
    constructor(private readonly prismaService: PrismaService) {}

    async findById(branchid: string, id: number): Promise<EmployeeScheduleEntity | null> {
        const schedule = await this.prismaService.employee_schedule.findFirst({
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

    async update(branchid: string, schedule: EmployeeScheduleEntity): Promise<EmployeeScheduleEntity> {
        const result = await this.prismaService.employee_schedule.updateMany({
            where: { id: schedule.id, branchId: branchid },
            data: EmployeeScheduleMapper.toPrismaUpdate(schedule),
        });
        if (result.count === 0) {
            throw new Error("Employee schedule not found for branch");
        }
        const updated = await this.prismaService.employee_schedule.findFirst({
            where: { id: schedule.id, branchId: branchid },
        });
        if (!updated) {
            throw new Error("Employee schedule not found after update");
        }
        return EmployeeScheduleMapper.toDomain(updated);
    }

    async delete(branchid: string, id: number): Promise<void> {
        const result = await this.prismaService.employee_schedule.deleteMany({
            where: { id, branchId: branchid },
        });
        if (result.count === 0) {
            throw new Error("Employee schedule not found for branch");
        }
    }
}
