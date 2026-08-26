import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import { EmployeeScheduleEntity } from "domain/entities/employee-schedule.entity";
import { EMPLOYEE_SCHEDULE_REPOSITORY, IEmployeeScheduleRepository } from "domain/repositories/employee-schedule.repository.interface";
import { Prisma } from "@prisma/client";
import { assertEmployeeAssignmentEligibility, type EmployeeAssignmentCandidate } from "application/policies/employee-assignment-eligibility.policy";
import { PrismaService } from "infrastructure/database/prisma.service";

type CreateEmployeeScheduleParams = {
    clientId: number;
    primaryEmployeeId: number;
    secondaryEmployeeId: number | null;
    workAddress: string;
    startDate: Date;
    endDate: Date;
    replaced?: boolean;
};

@Injectable()
export class CreateEmployeeScheduleUsecase {
    constructor(
        @Inject(EMPLOYEE_SCHEDULE_REPOSITORY)
        private readonly employeeScheduleRepository: IEmployeeScheduleRepository,
        private readonly prismaService: PrismaService,
    ) {}

    async execute(
        branchid: string,
        params: CreateEmployeeScheduleParams,
        transaction?: Prisma.TransactionClient,
    ): Promise<EmployeeScheduleEntity> {
        const persist = async (tx: Prisma.TransactionClient): Promise<EmployeeScheduleEntity> => {
            const client = await tx.client.findFirst({
                where: { id: params.clientId, branchId: branchid },
                select: { id: true },
            });
            if (!client) {
                throw new NotFoundException("Client not found for branch");
            }

            const employeeIds = [params.primaryEmployeeId, params.secondaryEmployeeId]
                .filter((employeeId): employeeId is number => employeeId !== null);
            const employeeIdsToLock = [...new Set(employeeIds)].sort((left, right) => left - right);
            await tx.$queryRaw(Prisma.sql`
                SELECT "id"
                FROM "employee"
                WHERE "id" IN (${Prisma.join(employeeIdsToLock)})
                  AND "branch_id" = ${branchid}::uuid
                ORDER BY "id"
                FOR UPDATE
            `);
            const employees: EmployeeAssignmentCandidate[] = await tx.employee.findMany({
                where: {
                    id: { in: employeeIds },
                    branchId: branchid,
                },
                select: {
                    id: true,
                    branchId: true,
                    deletedAt: true,
                    openToNextWork: true,
                },
            });
            assertEmployeeAssignmentEligibility(
                branchid,
                params.primaryEmployeeId,
                params.secondaryEmployeeId,
                employees,
            );

            const schedule = EmployeeScheduleEntity.create(
                params.clientId,
                params.primaryEmployeeId,
                params.secondaryEmployeeId,
                params.workAddress,
                params.startDate,
                params.endDate,
                params.replaced ?? false,
            );
            return this.employeeScheduleRepository.create(branchid, schedule, tx);
        };

        return transaction ? persist(transaction) : this.prismaService.$transaction(persist);
    }
}
