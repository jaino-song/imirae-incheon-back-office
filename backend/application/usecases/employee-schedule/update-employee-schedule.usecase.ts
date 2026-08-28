import { BadRequestException, Inject, Injectable, NotFoundException, Optional } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import {
    assertEmployeeAssignmentEligibility,
    assertEmployeeAssignmentShape,
    type EmployeeAssignmentCandidate,
} from "application/policies/employee-assignment-eligibility.policy";
import {
    assertEmployeeScheduleWriteIsAvailable,
    lockClientForScheduleWrite,
    lockEmployeesForScheduleWrite,
} from "application/policies/employee-schedule-invariants.policy";
import {
    EmployeeScheduleDateRangeError,
    EmployeeScheduleEntity,
    EmployeeScheduleRoleError,
} from "domain/entities/employee-schedule.entity";
import { EMPLOYEE_SCHEDULE_REPOSITORY, IEmployeeScheduleRepository } from "domain/repositories/employee-schedule.repository.interface";
import { PrismaService } from "infrastructure/database/prisma.service";

type UpdateEmployeeScheduleParams = {
    primaryEmployeeId?: number;
    secondaryEmployeeId?: number | null;
    workAddress?: string;
    startDate?: Date;
    endDate?: Date;
    replaced?: boolean;
};

@Injectable()
export class UpdateEmployeeScheduleUsecase {
    constructor(
        @Inject(EMPLOYEE_SCHEDULE_REPOSITORY)
        private readonly employeeScheduleRepository: IEmployeeScheduleRepository,
        @Optional()
        private readonly prismaService?: PrismaService,
    ) {}

    async execute(
        branchid: string,
        id: number,
        updates: UpdateEmployeeScheduleParams,
        transaction?: Prisma.TransactionClient,
    ): Promise<EmployeeScheduleEntity> {
        const persist = async (tx?: Prisma.TransactionClient): Promise<EmployeeScheduleEntity> => {
            const schedule = await this.employeeScheduleRepository.findById(branchid, id, tx);
            if (!schedule) {
                throw new NotFoundException(`Employee schedule with id ${id} not found`);
            }

            const primaryEmployeeId = updates.primaryEmployeeId ?? schedule.primaryEmployeeId;
            const secondaryEmployeeId = updates.secondaryEmployeeId !== undefined
                ? updates.secondaryEmployeeId
                : schedule.secondaryEmployeeId;
            assertEmployeeAssignmentShape(primaryEmployeeId, secondaryEmployeeId);

            let updated: EmployeeScheduleEntity;
            try {
                updated = new EmployeeScheduleEntity(
                    schedule.id,
                    schedule.clientId, // Client cannot be changed
                    primaryEmployeeId,
                    secondaryEmployeeId,
                    updates.workAddress ?? schedule.workAddress,
                    updates.startDate ?? schedule.startDate,
                    updates.endDate ?? schedule.endDate,
                    updates.replaced ?? schedule.replaced,
                );
            } catch (error) {
                if (error instanceof EmployeeScheduleDateRangeError || error instanceof EmployeeScheduleRoleError) {
                    throw new BadRequestException(error.message);
                }
                throw error;
            }

            // The transaction seam is optional only for legacy unit callers.
            // The application module always supplies Prisma, so production
            // updates lock the client/employees and validate eligibility and
            // overlap before the repository write.
            if (tx && tx.employee?.findMany) {
                await lockClientForScheduleWrite(tx, branchid, updated.clientId);
                await lockEmployeesForScheduleWrite(tx, branchid, [
                    schedule.primaryEmployeeId,
                    schedule.secondaryEmployeeId,
                    updated.primaryEmployeeId,
                    updated.secondaryEmployeeId,
                ]);
                const employeeIds = [...new Set(
                    [updated.primaryEmployeeId, updated.secondaryEmployeeId]
                        .filter((employeeId): employeeId is number => employeeId !== null),
                )];
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
                const retainedEmployeeIds = new Set(
                    [schedule.primaryEmployeeId, schedule.secondaryEmployeeId]
                        .filter((employeeId): employeeId is number => employeeId !== null),
                );
                assertEmployeeAssignmentEligibility(
                    branchid,
                    updated.primaryEmployeeId,
                    updated.secondaryEmployeeId,
                    employees,
                    retainedEmployeeIds,
                );
                await assertEmployeeScheduleWriteIsAvailable(tx, updated, branchid, updated.id);
            }

            return this.employeeScheduleRepository.update(branchid, updated, tx);
        };

        if (transaction) return persist(transaction);
        if (this.prismaService) {
            return this.prismaService.$transaction((tx) => persist(tx));
        }
        return persist();
    }
}
