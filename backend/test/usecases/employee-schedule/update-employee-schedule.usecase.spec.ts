import { BadRequestException, ConflictException } from "@nestjs/common";
import { UpdateEmployeeScheduleUsecase } from "application/usecases/employee-schedule/update-employee-schedule.usecase";
import { EmployeeScheduleEntity } from "domain/entities/employee-schedule.entity";

describe("UpdateEmployeeScheduleUsecase", () => {
    it("reads and persists the update through the supplied transaction", async () => {
        const transaction = {};
        const existing = new EmployeeScheduleEntity(
            72,
            31,
            30,
            null,
            "서울",
            new Date("2026-08-01T00:00:00.000Z"),
            new Date("2026-08-31T00:00:00.000Z"),
            false,
        );
        const updated = new EmployeeScheduleEntity(
            72,
            31,
            30,
            null,
            "부산",
            new Date("2026-08-02T00:00:00.000Z"),
            new Date("2026-09-01T00:00:00.000Z"),
            true,
        );
        const repository = {
            findById: jest.fn().mockResolvedValue(existing),
            update: jest.fn().mockResolvedValue(updated),
        };
        const usecase = new UpdateEmployeeScheduleUsecase(repository as never);

        await expect(usecase.execute("branch-1", 72, {
            workAddress: "부산",
            startDate: new Date("2026-08-02T00:00:00.000Z"),
            endDate: new Date("2026-09-01T00:00:00.000Z"),
            replaced: true,
        }, transaction as never)).resolves.toBe(updated);

        expect(repository.findById).toHaveBeenCalledWith("branch-1", 72, transaction);
        expect(repository.update).toHaveBeenCalledWith(
            "branch-1",
            expect.objectContaining({
                id: 72,
                clientId: 31,
                workAddress: "부산",
                startDate: new Date("2026-08-02T00:00:00.000Z"),
                endDate: new Date("2026-09-01T00:00:00.000Z"),
                replaced: true,
            }),
            transaction,
        );
    });

    const createInvariantHarness = (overlap: { id: number } | null = null) => {
        const transaction = {
            $queryRaw: jest.fn().mockResolvedValue([]),
            client: {},
            employee: {
                findMany: jest.fn().mockResolvedValue([{
                    id: 30,
                    branchId: "branch-1",
                    deletedAt: null,
                    openToNextWork: true,
                }]),
            },
            employee_schedule: {
                findFirst: jest.fn().mockResolvedValue(overlap),
            },
        };
        const existing = new EmployeeScheduleEntity(
            72,
            31,
            30,
            null,
            "서울",
            new Date("2026-08-01T00:00:00.000Z"),
            new Date("2026-08-31T00:00:00.000Z"),
            false,
        );
        const repository = {
            findById: jest.fn().mockResolvedValue(existing),
            update: jest.fn().mockResolvedValue(existing),
        };
        return {
            transaction,
            repository,
            usecase: new UpdateEmployeeScheduleUsecase(repository as never),
        };
    };

    it("refuses an inverted date range at the application boundary", async () => {
        const { usecase, transaction, repository } = createInvariantHarness();

        await expect(usecase.execute("branch-1", 72, {
            startDate: new Date("2026-09-01T00:00:00.000Z"),
            endDate: new Date("2026-08-31T00:00:00.000Z"),
        }, transaction as never)).rejects.toBeInstanceOf(BadRequestException);

        expect(repository.update).not.toHaveBeenCalled();
    });

    it("rejects an overlapping active schedule while excluding itself", async () => {
        const { usecase, transaction, repository } = createInvariantHarness({ id: 99 });

        await expect(usecase.execute("branch-1", 72, {}, transaction as never))
            .rejects.toBeInstanceOf(ConflictException);
        expect(repository.update).not.toHaveBeenCalled();

        const { usecase: selfUsecase, transaction: selfTransaction, repository: selfRepository } = createInvariantHarness({ id: 72 });
        await expect(selfUsecase.execute("branch-1", 72, {}, selfTransaction as never))
            .resolves.toBeDefined();
        expect(selfRepository.update).toHaveBeenCalledTimes(1);
        expect(selfTransaction.employee_schedule.findFirst).toHaveBeenCalledWith(expect.objectContaining({
            where: expect.objectContaining({ id: { not: 72 } }),
        }));
    });

    it("rejects an unavailable newly assigned employee but preserves retained eligibility", async () => {
        const { usecase, transaction, repository } = createInvariantHarness();
        transaction.employee.findMany.mockResolvedValue([
            {
                id: 30,
                branchId: "branch-1",
                deletedAt: null,
                openToNextWork: true,
            },
            {
                id: 31,
                branchId: "branch-1",
                deletedAt: null,
                openToNextWork: false,
            },
        ]);

        await expect(usecase.execute("branch-1", 72, {
            primaryEmployeeId: 31,
        }, transaction as never)).rejects.toBeInstanceOf(BadRequestException);
        expect(repository.update).not.toHaveBeenCalled();
    });
});
