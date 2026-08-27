import { Injectable } from "@nestjs/common";
import { deriveEmployeeStatus, EmployeeEntity } from "domain/entities/employee.entity";
import { isoDateInKorea } from "domain/utils/business-days";
import {
    ActiveClientByEmployee,
    EmployeeWorkHistoryByEmployee,
    IEmployeeRepository,
    PaginatedEmployeeWorkHistory,
} from "domain/repositories/employee.repository.interface";
import { PrismaService } from "infrastructure/database/prisma.service";
import { EmployeeMapper } from "infrastructure/database/mapper/employee.mapper";
import { normalizePhone } from "application/utils/normalize-phone";
import type { Prisma } from "@prisma/client";
import { employeeAgentTargetVersion } from "domain/entities/employee-agent-target";

@Injectable()
export class SbEmployeeRepository implements IEmployeeRepository {
    constructor(private readonly prismaService: PrismaService) {}

    async findById(branchid: string, id: number): Promise<EmployeeEntity | null> {
        const employee = await this.prismaService.employee.findFirst({
            where: { id, branchId: branchid },
        });
        return employee ? EmployeeMapper.toDomain(employee) : null;
    }

    async findByIdForUpdate(
        branchid: string,
        id: number,
        transaction: Prisma.TransactionClient,
    ): Promise<EmployeeEntity | null> {
        await transaction.$queryRaw`
            SELECT "id"
            FROM "employee"
            WHERE "id" = ${id} AND "branch_id" = ${branchid}::uuid
            FOR UPDATE
        `;
        const employee = await transaction.employee.findFirst({
            where: { id, branchId: branchid },
        });
        return employee ? EmployeeMapper.toDomain(employee) : null;
    }

    async findByPhone(branchid: string, normalizedPhone: string): Promise<EmployeeEntity | null> {
        const candidates = await this.prismaService.employee.findMany({
            where: { branchId: branchid },
            select: { id: true, phone: true },
        });
        const matched = candidates.find(
            (row) => normalizePhone(row.phone) === normalizedPhone,
        );
        if (!matched) return null;
        return this.findById(branchid, matched.id);
    }

    async create(branchid: string, employee: EmployeeEntity, transaction?: Prisma.TransactionClient): Promise<EmployeeEntity> {
        const data = EmployeeMapper.toPrismaCreate(employee);
        const created = await (transaction ?? this.prismaService).employee.create({
            data: { ...data, branchId: branchid },
        });
        return EmployeeMapper.toDomain(created);
    }

    async update(branchid: string, employee: EmployeeEntity): Promise<EmployeeEntity> {
        const result = await this.prismaService.employee.updateMany({
            where: { id: employee.id, branchId: branchid, deletedAt: null },
            data: EmployeeMapper.toPrismaUpdate(employee),
        });
        if (result.count === 0) {
            throw new Error("Employee not found for branch");
        }
        const updated = await this.prismaService.employee.findFirst({
            where: { id: employee.id, branchId: branchid, deletedAt: null },
        });
        if (!updated) {
            throw new Error("Employee not found after update");
        }
        return EmployeeMapper.toDomain(updated);
    }

    async updateIfTargetVersion(
        branchid: string,
        id: number,
        expectedTargetVersion: string,
        updates: Parameters<IEmployeeRepository["updateIfTargetVersion"]>[3],
        transaction?: Prisma.TransactionClient,
    ): Promise<EmployeeEntity | null> {
        const apply = async (tx: Prisma.TransactionClient): Promise<EmployeeEntity | null> => {
            const current = await this.findByIdForUpdate(branchid, id, tx);
            if (!current || current.deletedAt || employeeAgentTargetVersion(current) !== expectedTargetVersion) {
                return null;
            }

            current.updateProfile(
                updates.name,
                updates.workArea,
                updates.phone,
                updates.grade,
                updates.openToNextWork,
                updates.birthday,
            );
            const updated = await tx.employee.updateMany({
                where: { id, branchId: branchid, deletedAt: null },
                data: EmployeeMapper.toPrismaUpdate(current),
            });
            if (updated.count !== 1) return null;

            const row = await tx.employee.findFirst({
                where: { id, branchId: branchid, deletedAt: null },
            });
            return row ? EmployeeMapper.toDomain(row) : null;
        };

        return transaction ? apply(transaction) : this.prismaService.$transaction(apply);
    }

    async delete(branchid: string, id: number): Promise<void> {
        const result = await this.prismaService.employee.updateMany({
            where: { id, branchId: branchid, deletedAt: null },
            data: { deletedAt: new Date() },
        });
        if (result.count === 0) {
            throw new Error("Employee not found for branch");
        }
    }

    async hasActiveAssignments(branchid: string, id: number): Promise<boolean> {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const count = await this.prismaService.employee_schedule.count({
            where: {
                branchId: branchid,
                replaced: false,
                endDate: { gte: today },
                OR: [
                    { primaryEmployeeId: id },
                    { secondaryEmployeeId: id },
                ],
            },
        });
        return count > 0;
    }

    async findActiveClientsByEmployee(branchid: string, id: number): Promise<ActiveClientByEmployee[]> {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const schedules = await this.prismaService.employee_schedule.findMany({
            where: {
                branchId: branchid,
                replaced: false,
                endDate: { gte: today },
                OR: [
                    { primaryEmployeeId: id },
                    { secondaryEmployeeId: id },
                ],
            },
            select: {
                primaryEmployeeId: true,
                secondaryEmployeeId: true,
                client: {
                    select: {
                        id: true,
                        name: true,
                        serviceStatus: true,
                        startDate: true,
                        endDate: true,
                    },
                },
            },
            orderBy: { startDate: "asc" },
        });

        return schedules.map((schedule) => ({
            clientId: schedule.client.id,
            clientName: schedule.client.name,
            role: schedule.primaryEmployeeId === id ? "primary" : "secondary",
            startDate: schedule.client.startDate,
            endDate: schedule.client.endDate,
            serviceStatus: schedule.client.serviceStatus,
        }));
    }

    async findWorkHistoryByEmployee(
        branchid: string,
        id: number,
        page: number,
        limit: number,
    ): Promise<PaginatedEmployeeWorkHistory> {
        // employee_schedule.endDate is a PostgreSQL DATE represented at UTC midnight by Prisma.
        const today = new Date(`${isoDateInKorea()}T00:00:00.000Z`);
        const where: Prisma.employee_scheduleWhereInput = {
            branchId: branchid,
            client: { branchId: branchid },
            OR: [
                { primaryEmployeeId: id },
                { secondaryEmployeeId: id },
            ],
            AND: [{ OR: [{ replaced: true }, { endDate: { lt: today } }] }],
        };
        const [schedules, total] = await Promise.all([
            this.prismaService.employee_schedule.findMany({
                where,
                skip: (page - 1) * limit,
                take: limit,
                select: {
                    id: true,
                    primaryEmployeeId: true,
                    secondaryEmployeeId: true,
                    startDate: true,
                    endDate: true,
                    replaced: true,
                    client: {
                        select: {
                            id: true,
                            name: true,
                        },
                    },
                },
                orderBy: [{ startDate: "desc" }, { id: "desc" }],
            }),
            this.prismaService.employee_schedule.count({ where }),
        ]);

        return {
            data: schedules.map((schedule): EmployeeWorkHistoryByEmployee => ({
                scheduleId: schedule.id,
                clientId: schedule.client.id,
                clientName: schedule.client.name,
                role: schedule.primaryEmployeeId === id ? "primary" : "secondary",
                startDate: schedule.startDate,
                endDate: schedule.endDate,
                status: schedule.replaced ? "replaced" : "completed",
            })),
            total,
            page,
            limit,
            totalPages: Math.ceil(total / limit),
        };
    }

    async findAll(branchid: string): Promise<EmployeeEntity[]> {
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const employees = await this.prismaService.employee.findMany({
            where: { branchId: branchid, deletedAt: null },
            include: {
                primaryEmployeeSchedules: {
                    where: {
                        startDate: { lte: today },
                        endDate: { gte: today },
                        replaced: false,
                    },
                    take: 1,
                },
                secondaryEmployeeSchedules: {
                    where: {
                        startDate: { lte: today },
                        endDate: { gte: today },
                        replaced: false,
                    },
                    take: 1,
                },
            },
        });

        return employees.map((emp) => {
            const entity = EmployeeMapper.toDomain(emp);

            const hasActiveAssignment =
                emp.primaryEmployeeSchedules.length > 0 ||
                emp.secondaryEmployeeSchedules.length > 0;
            entity.status = deriveEmployeeStatus(
                hasActiveAssignment,
                entity.openToNextWork,
            );

            return entity;
        });
    }

    async findByWorkArea(branchid: string, workArea: string): Promise<EmployeeEntity[]> {
        const employees = await this.prismaService.employee.findMany({
            where: { workArea: { has: workArea }, branchId: branchid, deletedAt: null },
        });
        return employees.map((employee) => EmployeeMapper.toDomain(employee));
    }

    async findByGrade(branchid: string, grade: string): Promise<EmployeeEntity[]> {
        const employees = await this.prismaService.employee.findMany({
            where: {
                grade,
                branchId: branchid,
                deletedAt: null,
            },
        });
        return employees.map((employee) => EmployeeMapper.toDomain(employee));
    }

    async findByOpenToNextWork(branchid: string, openToNextWork: boolean): Promise<EmployeeEntity[]> {
        const employees = await this.prismaService.employee.findMany({
            where: { openToNextWork: openToNextWork, branchId: branchid, deletedAt: null },
        });
        return employees.map((employee) => EmployeeMapper.toDomain(employee));
    }

    async findByRegisteredDate(branchid: string, registeredDate: Date): Promise<EmployeeEntity[]> {
        const start = new Date(registeredDate);
        start.setHours(0, 0, 0, 0);
        const end = new Date(registeredDate);
        end.setHours(23, 59, 59, 999);

        const employees = await this.prismaService.employee.findMany({
            where: {
                branchId: branchid,
                deletedAt: null,
                companyRegisteredDate: {
                    gte: start,
                    lte: end,
                },
            },
        });
        return employees.map((employee) => EmployeeMapper.toDomain(employee));
    }

    async findByRegisteredDateRange(
        branchid: string,
        startDate: Date,
        endDate: Date
    ): Promise<EmployeeEntity[]> {
        const employees = await this.prismaService.employee.findMany({
            where: {
                branchId: branchid,
                deletedAt: null,
                companyRegisteredDate: {
                    gte: startDate,
                    lte: endDate,
                },
            },
        });
        return employees.map((employee) => EmployeeMapper.toDomain(employee));
    }

    async changeOpenToNextWork(
        branchid: string,
        id: number,
        openToNextWork: boolean
    ): Promise<void> {
        const result = await this.prismaService.employee.updateMany({
            where: { id, branchId: branchid, deletedAt: null },
            data: { openToNextWork: openToNextWork },
        });
        if (result.count === 0) {
            throw new Error("Employee not found for branch");
        }
    }

    async findAllOpenToNextWork(branchid: string): Promise<EmployeeEntity[]> {
        const employees = await this.prismaService.employee.findMany({
            where: { openToNextWork: true, branchId: branchid, deletedAt: null },
        });
        return employees.map((employee) => EmployeeMapper.toDomain(employee));
    }
}
