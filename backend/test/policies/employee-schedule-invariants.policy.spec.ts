import { BadRequestException, ConflictException } from "@nestjs/common";
import {
    assertNoActiveEmployeeScheduleOverlap,
    lockEmployeesForScheduleWrite,
} from "application/policies/employee-schedule-invariants.policy";
import { employeeScheduleDatesOverlap } from "domain/entities/employee-schedule.entity";

const range = {
    startDate: new Date("2026-08-01T00:00:00.000Z"),
    endDate: new Date("2026-08-31T00:00:00.000Z"),
};

const createTransaction = (conflict: { id: number } | null = null) => ({
    $queryRaw: jest.fn().mockResolvedValue([]),
    employee_schedule: {
        findFirst: jest.fn().mockResolvedValue(conflict),
    },
});

describe("employee schedule invariants policy", () => {
    it("treats equal DATE endpoints as overlapping and next-day ranges as adjacent", () => {
        const sameEndAndStart = new Date("2026-08-31T00:00:00.000Z");
        const nextDay = new Date("2026-09-01T00:00:00.000Z");
        expect(employeeScheduleDatesOverlap(range.startDate, sameEndAndStart, sameEndAndStart, range.endDate)).toBe(true);
        expect(employeeScheduleDatesOverlap(range.startDate, sameEndAndStart, nextDay, range.endDate)).toBe(false);
    });

    it("uses inclusive overlap bounds and branch scoping", async () => {
        const transaction = createTransaction({ id: 42 });

        await expect(assertNoActiveEmployeeScheduleOverlap(transaction as never, {
            branchId: "branch-a",
            clientId: 1,
            primaryEmployeeId: 7,
            secondaryEmployeeId: null,
            ...range,
            replaced: false,
        })).rejects.toBeInstanceOf(ConflictException);

        expect(transaction.employee_schedule.findFirst).toHaveBeenCalledWith({
            where: expect.objectContaining({
                branchId: "branch-a",
                replaced: false,
                startDate: { lte: range.endDate },
                endDate: { gte: range.startDate },
                OR: expect.arrayContaining([
                    { clientId: 1 },
                    { primaryEmployeeId: { in: [7] } },
                ]),
            }),
            orderBy: { id: "asc" },
            select: expect.any(Object),
        });
    });

    it("allows replaced schedules and excludes the schedule being updated", async () => {
        const replacedTransaction = createTransaction({ id: 42 });
        await expect(assertNoActiveEmployeeScheduleOverlap(replacedTransaction as never, {
            branchId: "branch-a",
            clientId: 1,
            primaryEmployeeId: 7,
            secondaryEmployeeId: null,
            ...range,
            replaced: true,
        })).resolves.toBeUndefined();
        expect(replacedTransaction.employee_schedule.findFirst).not.toHaveBeenCalled();

        const selfTransaction = createTransaction({ id: 42 });
        await expect(assertNoActiveEmployeeScheduleOverlap(selfTransaction as never, {
            branchId: "branch-a",
            clientId: 1,
            primaryEmployeeId: 7,
            secondaryEmployeeId: null,
            ...range,
            replaced: false,
            excludeScheduleId: 42,
        })).resolves.toBeUndefined();
    });

    it("refuses an inverted range before querying persistence", async () => {
        const transaction = createTransaction();
        await expect(assertNoActiveEmployeeScheduleOverlap(transaction as never, {
            branchId: "branch-a",
            clientId: 1,
            primaryEmployeeId: 7,
            secondaryEmployeeId: null,
            startDate: range.endDate,
            endDate: range.startDate,
            replaced: false,
        })).rejects.toBeInstanceOf(BadRequestException);
        expect(transaction.employee_schedule.findFirst).not.toHaveBeenCalled();
    });

    it("locks employee ids in sorted order for deadlock-safe concurrent writes", async () => {
        const transaction = createTransaction();

        await lockEmployeesForScheduleWrite(transaction as never, "branch-a", [12, 7, 12, null, 3]);

        expect(transaction.$queryRaw).toHaveBeenCalledTimes(1);
        const query = transaction.$queryRaw.mock.calls[0]?.[0] as { values?: unknown[] } | undefined;
        expect(query?.values?.slice(0, 3)).toEqual([3, 7, 12]);
    });
});
