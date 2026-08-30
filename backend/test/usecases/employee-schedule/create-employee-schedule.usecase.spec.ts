import { BadRequestException, ConflictException } from "@nestjs/common";
import { CreateEmployeeScheduleUsecase } from "application/usecases/employee-schedule/create-employee-schedule.usecase";
import { EmployeeScheduleEntity } from "domain/entities/employee-schedule.entity";

type EmployeeCandidate = {
    id: number;
    branchId: string;
    deletedAt: Date | null;
    openToNextWork: boolean;
};

describe("CreateEmployeeScheduleUsecase assignment eligibility", () => {
    const branchId = "branch-a";
    const baseParams = {
        clientId: 100,
        primaryEmployeeId: 2,
        secondaryEmployeeId: null as number | null,
        workAddress: "서울",
        startDate: new Date("2026-08-01T00:00:00.000Z"),
        endDate: new Date("2026-08-31T00:00:00.000Z"),
    };

    const eligible = (id = 2): EmployeeCandidate => ({
        id,
        branchId,
        deletedAt: null,
        openToNextWork: true,
    });

    const createHarness = (employees: EmployeeCandidate[]) => {
        const transaction = {
            $queryRaw: jest.fn().mockResolvedValue([]),
            client: {
                findFirst: jest.fn().mockResolvedValue({ id: baseParams.clientId }),
            },
            employee: {
                findMany: jest.fn().mockResolvedValue(employees),
            },
            employee_schedule: {
                findFirst: jest.fn().mockResolvedValue(null),
            },
        };
        const prisma = {
            employee: transaction.employee,
            $transaction: jest.fn(async (callback: (tx: typeof transaction) => Promise<unknown>) => callback(transaction)),
        };
        const schedule = new EmployeeScheduleEntity(
            10,
            baseParams.clientId,
            baseParams.primaryEmployeeId,
            baseParams.secondaryEmployeeId,
            baseParams.workAddress,
            baseParams.startDate,
            baseParams.endDate,
            false,
        );
        const employeeScheduleRepository = {
            create: jest.fn().mockResolvedValue(schedule),
        };

        const usecase = new CreateEmployeeScheduleUsecase(
            employeeScheduleRepository as never,
            prisma as never,
        );

        return { usecase, transaction, employeeScheduleRepository };
    };

    const invalidCases: Array<[
        string,
        EmployeeCandidate[],
        Partial<typeof baseParams>,
    ]> = [
        ["wrong branch", [{ ...eligible(), branchId: "branch-b" }], {}],
        ["soft deleted", [{ ...eligible(), deletedAt: new Date("2026-01-01T00:00:00.000Z") }], {}],
        ["unavailable", [{ ...eligible(), openToNextWork: false }], {}],
        ["missing", [], {}],
        ["wrong branch secondary", [eligible(), { ...eligible(3), branchId: "branch-b" }], { secondaryEmployeeId: 3 }],
        ["soft deleted secondary", [eligible(), { ...eligible(3), deletedAt: new Date("2026-01-01T00:00:00.000Z") }], { secondaryEmployeeId: 3 }],
        ["unavailable secondary", [eligible(), { ...eligible(3), openToNextWork: false }], { secondaryEmployeeId: 3 }],
        ["missing secondary", [eligible()], { secondaryEmployeeId: 999 }],
        ["same employee in both roles", [eligible()], { secondaryEmployeeId: 2 }],
    ];

    it.each(invalidCases)(
        "refuses %s before creating a schedule",
        async (_label, employees, overrides) => {
            const { usecase, transaction, employeeScheduleRepository } = createHarness(employees);

            await expect(usecase.execute(branchId, {
                ...baseParams,
                ...overrides,
            }, transaction as never)).rejects.toBeInstanceOf(BadRequestException);

            expect(transaction.employee.findMany).toHaveBeenCalled();
            expect(employeeScheduleRepository.create).not.toHaveBeenCalled();
        },
    );

    it("creates a schedule for eligible employees in the supplied transaction", async () => {
        const { usecase, transaction, employeeScheduleRepository } = createHarness([eligible()]);

        await expect(usecase.execute(branchId, baseParams, transaction as never)).resolves.toBeDefined();

        expect(employeeScheduleRepository.create).toHaveBeenCalledWith(
            branchId,
            expect.any(EmployeeScheduleEntity),
            transaction,
        );
    });

    it("refuses a client outside the authenticated branch before locking employees or creating a schedule", async () => {
        const { usecase, transaction, employeeScheduleRepository } = createHarness([eligible()]);
        transaction.client.findFirst.mockResolvedValue(null);

        await expect(usecase.execute(branchId, baseParams, transaction as never))
            .rejects.toThrow("Client not found for branch");

        expect(transaction.client.findFirst).toHaveBeenCalledWith({
            where: { id: baseParams.clientId, branchId },
            select: { id: true },
        });
        expect(transaction.$queryRaw).not.toHaveBeenCalled();
        expect(transaction.employee.findMany).not.toHaveBeenCalled();
        expect(employeeScheduleRepository.create).not.toHaveBeenCalled();
    });

    it("creates a schedule when both eligible employees are assigned", async () => {
        const { usecase, transaction, employeeScheduleRepository } = createHarness([eligible(), eligible(3)]);

        await expect(usecase.execute(branchId, {
            ...baseParams,
            secondaryEmployeeId: 3,
        }, transaction as never)).resolves.toBeDefined();

        expect(employeeScheduleRepository.create).toHaveBeenCalledTimes(1);
    });

    it("refuses an inverted date range before creating a schedule", async () => {
        const { usecase, employeeScheduleRepository } = createHarness([eligible()]);

        await expect(usecase.execute(branchId, {
            ...baseParams,
            startDate: new Date("2026-09-01T00:00:00.000Z"),
            endDate: new Date("2026-08-31T00:00:00.000Z"),
        })).rejects.toBeInstanceOf(BadRequestException);

        expect(employeeScheduleRepository.create).not.toHaveBeenCalled();
    });

    it("refuses an active overlapping schedule in the same branch", async () => {
        const { usecase, transaction, employeeScheduleRepository } = createHarness([eligible()]);
        transaction.employee_schedule.findFirst.mockResolvedValue({ id: 77 });

        await expect(usecase.execute(branchId, baseParams, transaction as never))
            .rejects.toBeInstanceOf(ConflictException);

        expect(transaction.employee_schedule.findFirst).toHaveBeenCalledWith(expect.objectContaining({
            where: expect.objectContaining({
                branchId,
                replaced: false,
                startDate: { lte: baseParams.endDate },
                endDate: { gte: baseParams.startDate },
                OR: expect.arrayContaining([
                    { clientId: baseParams.clientId },
                    { primaryEmployeeId: { in: [baseParams.primaryEmployeeId] } },
                ]),
            }),
        }));
        expect(employeeScheduleRepository.create).not.toHaveBeenCalled();
    });

    it("allows a replaced schedule even when its dates overlap", async () => {
        const { usecase, transaction, employeeScheduleRepository } = createHarness([eligible()]);
        transaction.employee_schedule.findFirst.mockResolvedValue({ id: 77 });

        await expect(usecase.execute(branchId, {
            ...baseParams,
            replaced: true,
        }, transaction as never)).resolves.toBeDefined();

        expect(transaction.employee_schedule.findFirst).not.toHaveBeenCalled();
        expect(employeeScheduleRepository.create).toHaveBeenCalledTimes(1);
    });
});
