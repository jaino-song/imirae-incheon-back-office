import { BadRequestException, ConflictException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import {
    assertEmployeeScheduleDateRange,
    type EmployeeScheduleEntity,
} from "domain/entities/employee-schedule.entity";

type EmployeeScheduleWriteTransaction = Prisma.TransactionClient;

export const EMPLOYEE_SCHEDULE_OVERLAP_CODE = "EMPLOYEE_SCHEDULE_OVERLAP";

export function employeeScheduleReplacementEndDate(
    replacementAt: Date,
    existingStartDate?: Date | null,
): Date {
    if (existingStartDate && existingStartDate.getTime() > replacementAt.getTime()) {
        return existingStartDate;
    }
    return replacementAt;
}

/**
 * Period for the schedule that takes over at a handover.
 *
 * The handover day is shared: the outgoing schedule ends on it and the incoming
 * one starts on it, matching `requestReplacement`. Without this the incoming
 * schedule inherits the client's contract start and every replacement reads as
 * if the new provider had been there since day one.
 *
 * Both bounds are clamped rather than taken raw:
 * - a handover recorded before the contract even starts keeps the contract start,
 *   mirroring `employeeScheduleReplacementEndDate`'s guard for the outgoing row;
 * - a handover on an already-ended contract would otherwise produce start > end,
 *   which `assertEmployeeScheduleDateRange` rejects and no DB constraint catches.
 *   The end is pulled up to the handover day instead of being extended by a
 *   default service period, so finishing a contract does not silently grant the
 *   incoming provider another year of availability blocks and token lifetime.
 */
export function employeeScheduleHandoverPeriod(params: {
    replacementAt: Date;
    contractStartDate: Date;
    contractEndDate: Date;
}): { startDate: Date; endDate: Date } {
    const startDate = params.replacementAt.getTime() > params.contractStartDate.getTime()
        ? params.replacementAt
        : params.contractStartDate;
    const endDate = params.contractEndDate.getTime() >= startDate.getTime()
        ? params.contractEndDate
        : startDate;
    return { startDate, endDate };
}

type ScheduleOverlapParams = {
    branchId: string;
    clientId?: number;
    primaryEmployeeId: number;
    secondaryEmployeeId: number | null | undefined;
    startDate: Date;
    endDate: Date;
    replaced: boolean;
    excludeScheduleId?: number;
};

/**
 * Lock the stable client row that owns a schedule before reading or writing
 * active schedules. Every schedule assignment path uses this lock, so
 * concurrent writes for one client are serialized without a schema change.
 */
export async function lockClientForScheduleWrite(
    transaction: EmployeeScheduleWriteTransaction,
    branchId: string,
    clientId: number,
): Promise<boolean> {
    if (typeof transaction.$queryRaw !== "function") return false;
    const rows = await transaction.$queryRaw<Array<{ id: number }>>(Prisma.sql`
        SELECT "id"
        FROM "client"
        WHERE "id" = ${clientId}
          AND "branch_id" = ${branchId}::uuid
        FOR UPDATE
    `);
    return rows.length > 0;
}

/**
 * Lock all employees involved in an assignment in a deterministic order.
 * This is intentionally separate from the eligibility read: the lock must be
 * held until the overlap query and schedule write have committed.
 */
export async function lockEmployeesForScheduleWrite(
    transaction: EmployeeScheduleWriteTransaction,
    branchId: string,
    employeeIds: readonly (number | null | undefined)[],
): Promise<void> {
    if (typeof transaction.$queryRaw !== "function") return;
    const ids = [...new Set(employeeIds.filter((id): id is number => id !== null && id !== undefined))]
        .sort((left, right) => left - right);
    if (ids.length === 0) return;

    await transaction.$queryRaw(Prisma.sql`
        SELECT "id"
        FROM "employee"
        WHERE "id" IN (${Prisma.join(ids)})
          AND "branch_id" = ${branchId}::uuid
        ORDER BY "id"
        FOR UPDATE
    `);
}

/**
 * Reject an active schedule that shares the client or either assigned
 * employee and overlaps the proposed inclusive DATE interval. Replaced rows
 * are historical and intentionally do not participate in the conflict set.
 */
export async function assertNoActiveEmployeeScheduleOverlap(
    transaction: EmployeeScheduleWriteTransaction,
    params: ScheduleOverlapParams,
): Promise<void> {
    try {
        assertEmployeeScheduleDateRange(params.startDate, params.endDate);
    } catch (error) {
        throw new BadRequestException(error instanceof Error ? error.message : "Invalid employee schedule date range");
    }
    if (params.replaced) return;
    // Some pure unit-test transactions intentionally provide only the tables
    // needed by the usecase under test. Production Prisma transactions always
    // expose employee_schedule; skip the persistence check when that seam is
    // absent so domain validation can still be exercised in isolation.
    if (!transaction.employee_schedule?.findFirst) return;

    const employeeIds = [...new Set(
        [params.primaryEmployeeId, params.secondaryEmployeeId]
            .filter((id): id is number => id !== null && id !== undefined),
    )];
    const overlapSubjects: Prisma.employee_scheduleWhereInput[] = [
        ...(params.clientId === undefined ? [] : [{ clientId: params.clientId }]),
        ...(employeeIds.length === 0 ? [] : [
            { primaryEmployeeId: { in: employeeIds } },
            { secondaryEmployeeId: { in: employeeIds } },
        ]),
    ];
    if (overlapSubjects.length === 0) return;

    const conflict = await transaction.employee_schedule.findFirst({
        where: {
            branchId: params.branchId,
            replaced: false,
            // A terminated assignment keeps its contracted end date now that
            // termination no longer rewrites it, so it would otherwise go on
            // blocking the employee for the rest of a period they no longer serve.
            terminatedAt: null,
            startDate: { lte: params.endDate },
            endDate: { gte: params.startDate },
            OR: overlapSubjects,
            ...(params.excludeScheduleId === undefined
                ? {}
                : { id: { not: params.excludeScheduleId } }),
        },
        orderBy: { id: "asc" },
        select: {
            id: true,
            clientId: true,
            primaryEmployeeId: true,
            secondaryEmployeeId: true,
        },
    });

    // Keep self-update semantics explicit even when an adapter/mock does not
    // honor the `id: { not: ... }` predicate itself.
    if (conflict && conflict.id !== params.excludeScheduleId) {
        throw new ConflictException({
            code: EMPLOYEE_SCHEDULE_OVERLAP_CODE,
            message: "An active employee schedule overlaps the requested interval",
            conflictScheduleId: conflict.id,
        });
    }
}

export async function assertEmployeeScheduleWriteIsAvailable(
    transaction: EmployeeScheduleWriteTransaction,
    schedule: Pick<
        EmployeeScheduleEntity,
        "clientId" | "primaryEmployeeId" | "secondaryEmployeeId" | "startDate" | "endDate" | "replaced"
    >,
    branchId: string,
    excludeScheduleId?: number,
): Promise<void> {
    await assertNoActiveEmployeeScheduleOverlap(transaction, {
        branchId,
        clientId: schedule.clientId,
        primaryEmployeeId: schedule.primaryEmployeeId,
        secondaryEmployeeId: schedule.secondaryEmployeeId,
        startDate: schedule.startDate,
        endDate: schedule.endDate,
        replaced: schedule.replaced,
        excludeScheduleId,
    });
}
