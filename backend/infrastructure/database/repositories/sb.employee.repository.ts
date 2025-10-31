import { Injectable } from "@nestjs/common";
import { EmployeeEntity } from "domain/entities/employee.entity";
import { EMPLOYEE_REPOSITORY, IEmployeeRepository } from "domain/repositories/employee.repository.interface";
import { PrismaService } from "infrastructure/database/prisma.service";
import { EmployeeMapper } from "infrastructure/database/mapper/employee.mapper";

@Injectable()
export class SbEmployeeRepository implements IEmployeeRepository {
    constructor(private readonly prismaService: PrismaService) {}

    async findById(id: number): Promise<EmployeeEntity | null> {
        const employee = await this.prismaService.employee.findUnique({
            where: { id },
        });
        return employee ? EmployeeMapper.toDomain(employee) : null;
    }

    async create(employee: EmployeeEntity): Promise<EmployeeEntity> {
        const created = await this.prismaService.employee.create({
            data: EmployeeMapper.toPrismaCreate(employee),
        });
        return EmployeeMapper.toDomain(created);
    }

    async update(employee: EmployeeEntity): Promise<EmployeeEntity> {
        const updated = await this.prismaService.employee.update({
            where: { id: employee.id },
            data: EmployeeMapper.toPrismaUpdate(employee),
        });
        return EmployeeMapper.toDomain(updated);
    }

    async delete(id: number): Promise<void> {
        await this.prismaService.employee.delete({
            where: { id },
        });
    }

    async findAll(): Promise<EmployeeEntity[]> {
        const employees = await this.prismaService.employee.findMany();
        return employees.map(EmployeeMapper.toDomain);
    }

    async findByWorkArea(workArea: string): Promise<EmployeeEntity[]> {
        const employees = await this.prismaService.employee.findMany({
            where: { work_area: workArea },
        });
        return employees.map(EmployeeMapper.toDomain);
    }

    async findByGrade(grade: string): Promise<EmployeeEntity[]> {
        const employees = await this.prismaService.employee.findMany({
            where: { grade },
        });
        return employees.map(EmployeeMapper.toDomain);
    }

    async findByOpenToNextWork(openToNextWork: boolean): Promise<EmployeeEntity[]> {
        const employees = await this.prismaService.employee.findMany({
            where: { open_to_next_work: openToNextWork },
        });
        return employees.map(EmployeeMapper.toDomain);
    }

    async findByRegisteredDate(registeredDate: Date): Promise<EmployeeEntity[]> {
        const start = new Date(registeredDate);
        start.setHours(0, 0, 0, 0);
        const end = new Date(registeredDate);
        end.setHours(23, 59, 59, 999);

        const employees = await this.prismaService.employee.findMany({
            where: {
                registered_date: {
                    gte: start,
                    lte: end,
                },
            },
        });
        return employees.map(EmployeeMapper.toDomain);
    }

    async findByRegisteredDateRange(startDate: Date, endDate: Date): Promise<EmployeeEntity[]> {
        const employees = await this.prismaService.employee.findMany({
            where: {
                registered_date: {
                    gte: startDate,
                    lte: endDate,
                },
            },
        });
        return employees.map(EmployeeMapper.toDomain);
    }

    async changeOpenToNextWork(id: number, openToNextWork: boolean): Promise<void> {
        await this.prismaService.employee.update({
            where: { id },
            data: { open_to_next_work: openToNextWork },
        });
    }

    async findAllOpenToNextWork(): Promise<EmployeeEntity[]> {
        const employees = await this.prismaService.employee.findMany({
            where: { open_to_next_work: true },
        });
        return employees.map(EmployeeMapper.toDomain);
    }
}

