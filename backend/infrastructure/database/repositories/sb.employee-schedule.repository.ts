import { Injectable } from "@nestjs/common";
import { EmployeeScheduleEntity } from "domain/entities/employee-schedule.entity";
import { EMPLOYEE_SCHEDULE_REPOSITORY, IEmployeeScheduleRepository } from "domain/repositories/employee-schedule.repository.interface";
import { PrismaService } from "infrastructure/database/prisma.service";
import { EmployeeScheduleMapper } from "infrastructure/database/mapper/employee-schedule.mapper";

@Injectable()
export class SbEmployeeScheduleRepository implements IEmployeeScheduleRepository {
    constructor(private readonly prismaService: PrismaService) {}

    async findById(id: number): Promise<EmployeeScheduleEntity | null> {
        const schedule = await this.prismaService.employee_schedule.findUnique({
            where: { id },
        });
        return schedule ? EmployeeScheduleMapper.toDomain(schedule) : null;
    }

    async findByEmployeeId(employeeId: number): Promise<EmployeeScheduleEntity[]> {
        const schedules = await this.prismaService.employee_schedule.findMany({
            where: { employee_id: employeeId },
        });
        return schedules.map(EmployeeScheduleMapper.toDomain);
    }

    async findAll(): Promise<EmployeeScheduleEntity[]> {
        const schedules = await this.prismaService.employee_schedule.findMany();
        return schedules.map(EmployeeScheduleMapper.toDomain);
    }

    async create(schedule: EmployeeScheduleEntity): Promise<EmployeeScheduleEntity> {
        const created = await this.prismaService.employee_schedule.create({
            data: EmployeeScheduleMapper.toPrismaCreate(schedule),
        });
        return EmployeeScheduleMapper.toDomain(created);
    }

    async update(schedule: EmployeeScheduleEntity): Promise<EmployeeScheduleEntity> {
        const updated = await this.prismaService.employee_schedule.update({
            where: { id: schedule.id },
            data: EmployeeScheduleMapper.toPrismaUpdate(schedule),
        });
        return EmployeeScheduleMapper.toDomain(updated);
    }

    async delete(id: number): Promise<void> {
        await this.prismaService.employee_schedule.delete({
            where: { id },
        });
    }
}
