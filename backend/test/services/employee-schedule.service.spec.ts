import { EmployeeScheduleService } from "application/services/employee-schedule.service";
import { CreateEmployeeScheduleUsecase } from "application/usecases/employee-schedule/create-employee-schedule.usecase";
import { EmployeeScheduleEntity } from "domain/entities/employee-schedule.entity";

describe("EmployeeScheduleService", () => {
    const createService = () => {
        const createUsecase = { execute: jest.fn() };
        const findByIdUsecase = { execute: jest.fn() };
        const listUsecase = { execute: jest.fn() };
        const listByPrimaryUsecase = { execute: jest.fn() };
        const listBySecondaryUsecase = { execute: jest.fn() };
        const updateUsecase = { execute: jest.fn() };
        const deleteUsecase = { execute: jest.fn() };
        const serviceRecordLinkService = {
            scheduleForServiceStart: jest.fn().mockResolvedValue(undefined),
            extendExpiryForEndDate: jest.fn().mockResolvedValue(undefined),
        };
        const transaction = {};
        let transactionCommitted = false;
        const prisma = {
            $transaction: jest.fn(async (callback: (tx: unknown) => Promise<unknown>) => {
                const result = await callback(transaction);
                transactionCommitted = true;
                return result;
            }),
        };
        const messageAutomationIntentService = {
            persistScheduleIntent: jest.fn().mockResolvedValue(undefined),
            fulfillScheduleIntent: jest.fn().mockImplementation(
                ({ scheduleId }: { scheduleId: number }) =>
                    serviceRecordLinkService.scheduleForServiceStart(scheduleId),
            ),
        };

        return {
            service: new EmployeeScheduleService(
                createUsecase as never,
                findByIdUsecase as never,
                listUsecase as never,
                listByPrimaryUsecase as never,
                listBySecondaryUsecase as never,
                updateUsecase as never,
                deleteUsecase as never,
                prisma as never,
                messageAutomationIntentService as never,
                serviceRecordLinkService as never,
            ),
            createUsecase,
            updateUsecase,
            transaction,
            wasTransactionCommitted: () => transactionCommitted,
            prisma,
            messageAutomationIntentService,
            serviceRecordLinkService,
        };
    };

    it("schedules the service-record link SMS when a service schedule is created", async () => {
        const { service, createUsecase, serviceRecordLinkService } = createService();
        createUsecase.execute.mockResolvedValue({ id: 10, clientId: 1 } as EmployeeScheduleEntity);

        await service.create("branch-1", {
            clientId: 1,
            primaryEmployeeId: 2,
            secondaryEmployeeId: null,
            workAddress: "서울",
            startDate: "2026-07-03",
            endDate: "2026-07-12",
        });

        expect(serviceRecordLinkService.scheduleForServiceStart).toHaveBeenCalledWith(10);
    });

    it("stores the retry intent in the same transaction before attempting message generation", async () => {
        const {
            service,
            createUsecase,
            transaction,
            messageAutomationIntentService,
        } = createService();
        createUsecase.execute.mockResolvedValue({ id: 10, clientId: 1 } as EmployeeScheduleEntity);

        await service.create("branch-1", {
            clientId: 1,
            primaryEmployeeId: 2,
            secondaryEmployeeId: null,
            workAddress: "서울",
            startDate: "2026-07-03",
            endDate: "2026-07-12",
        });

        expect(createUsecase.execute).toHaveBeenCalledWith(
            "branch-1",
            expect.any(Object),
            transaction,
        );
        expect(messageAutomationIntentService.persistScheduleIntent).toHaveBeenCalledWith(
            transaction,
            expect.objectContaining({
                branchId: "branch-1",
                clientId: 1,
                scheduleId: 10,
            }),
        );
        expect(messageAutomationIntentService.fulfillScheduleIntent).toHaveBeenCalledWith({
            branchId: "branch-1",
            scheduleId: 10,
            includePast: true,
            intentAt: expect.any(Date),
        });
    });

    it("rolls back schedule creation when its durable retry intent cannot be stored", async () => {
        const { service, createUsecase, messageAutomationIntentService } = createService();
        createUsecase.execute.mockResolvedValue({ id: 10, clientId: 1 } as EmployeeScheduleEntity);
        messageAutomationIntentService.persistScheduleIntent.mockRejectedValue(
            new Error("intent storage failed"),
        );

        await expect(service.create("branch-1", {
            clientId: 1,
            primaryEmployeeId: 2,
            secondaryEmployeeId: null,
            workAddress: "서울",
            startDate: "2026-07-03",
            endDate: "2026-07-12",
        })).rejects.toThrow("intent storage failed");

        expect(messageAutomationIntentService.fulfillScheduleIntent).not.toHaveBeenCalled();
    });

    it("does not complete schedule creation until its message jobs have been attempted", async () => {
        const { service, createUsecase, serviceRecordLinkService } = createService();
        createUsecase.execute.mockResolvedValue({
            id: 10,
            clientId: 1,
        } as EmployeeScheduleEntity);
        let finishScheduling: (() => void) | undefined;
        serviceRecordLinkService.scheduleForServiceStart.mockImplementation(
            () => new Promise<void>((resolve) => {
                finishScheduling = resolve;
            }),
        );
        let creationCompleted = false;

        const creation = service.create("branch-1", {
            clientId: 1,
            primaryEmployeeId: 2,
            secondaryEmployeeId: null,
            workAddress: "서울",
            startDate: "2026-07-03",
            endDate: "2026-07-12",
        }).then(() => {
            creationCompleted = true;
        });

        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(creationCompleted).toBe(false);

        finishScheduling?.();
        await creation;
        expect(creationCompleted).toBe(true);
    });

    it("extends service-record token expiry when a service schedule end date changes", async () => {
        const { service, updateUsecase, serviceRecordLinkService } = createService();
        const endDate = new Date("2026-07-20T00:00:00.000Z");
        updateUsecase.execute.mockResolvedValue({
            id: 10,
            endDate,
        } as EmployeeScheduleEntity);

        await service.update("branch-1", 10, {
            endDate: "2026-07-20",
        });

        expect(serviceRecordLinkService.extendExpiryForEndDate).toHaveBeenCalledWith(10, endDate);
    });

    it("does not touch service-record token expiry when end date is unchanged", async () => {
        const { service, updateUsecase, serviceRecordLinkService } = createService();
        updateUsecase.execute.mockResolvedValue({ id: 10 } as EmployeeScheduleEntity);

        await service.update("branch-1", 10, {
            workAddress: "서울",
        });

        expect(serviceRecordLinkService.extendExpiryForEndDate).not.toHaveBeenCalled();
    });

    it.each([
        ["work address", { workAddress: "부산" }],
        ["start date", { startDate: "2026-08-02" }],
        ["end date", { endDate: "2026-09-02" }],
        ["replacement state", { replaced: true }],
    ] as const)("persists a replacement automation intent when %s changes", async (_label, updates) => {
        const {
            service,
            updateUsecase,
            transaction,
            messageAutomationIntentService,
        } = createService();
        updateUsecase.execute.mockResolvedValue({
            id: 10,
            clientId: 1,
            endDate: new Date("2026-08-31T00:00:00.000Z"),
        } as EmployeeScheduleEntity);

        await service.update("branch-1", 10, updates);

        expect(updateUsecase.execute).toHaveBeenCalledWith(
            "branch-1",
            10,
            expect.any(Object),
            transaction,
        );
        expect(messageAutomationIntentService.persistScheduleIntent).toHaveBeenCalledWith(
            transaction,
            expect.objectContaining({
                branchId: "branch-1",
                clientId: 1,
                scheduleId: 10,
                includePast: true,
                replaceExisting: true,
                intentAt: expect.any(Date),
            }),
        );
        expect(messageAutomationIntentService.fulfillScheduleIntent).toHaveBeenCalledWith({
            branchId: "branch-1",
            scheduleId: 10,
            includePast: true,
            replaceExisting: true,
            intentAt: expect.any(Date),
        });
    });

    it("rolls back the schedule update when replacement intent persistence fails", async () => {
        const {
            service,
            updateUsecase,
            transaction,
            messageAutomationIntentService,
            wasTransactionCommitted,
        } = createService();
        const error = new Error("intent storage failed");
        updateUsecase.execute.mockResolvedValue({ id: 10, clientId: 1 } as EmployeeScheduleEntity);
        messageAutomationIntentService.persistScheduleIntent.mockRejectedValue(error);

        await expect(service.update("branch-1", 10, { startDate: "2026-08-02" }))
            .rejects.toThrow("intent storage failed");

        expect(updateUsecase.execute).toHaveBeenCalledWith(
            "branch-1",
            10,
            expect.any(Object),
            transaction,
        );
        expect(wasTransactionCommitted()).toBe(false);
        expect(messageAutomationIntentService.fulfillScheduleIntent).not.toHaveBeenCalled();
    });

    it("returns the committed update while leaving a durable retry when message synchronization fails", async () => {
        const { service, updateUsecase, messageAutomationIntentService } = createService();
        const updated = { id: 10, clientId: 1 } as EmployeeScheduleEntity;
        updateUsecase.execute.mockResolvedValue(updated);
        messageAutomationIntentService.fulfillScheduleIntent.mockRejectedValue(
            new Error("message sync failed"),
        );

        await expect(service.update("branch-1", 10, { workAddress: "부산" }))
            .resolves.toBe(updated);

        expect(messageAutomationIntentService.persistScheduleIntent).toHaveBeenCalled();
        expect(messageAutomationIntentService.fulfillScheduleIntent).toHaveBeenCalled();
    });
});

describe("EmployeeScheduleService assignment eligibility", () => {
    type EmployeeCandidate = {
        id: number;
        branchId: string;
        deletedAt: Date | null;
        openToNextWork: boolean;
    };

    const branchId = "branch-a";
    const eligible = (id = 2): EmployeeCandidate => ({
        id,
        branchId,
        deletedAt: null,
        openToNextWork: true,
    });

    const createHarness = (
        employees: EmployeeCandidate[],
        client: { id: number } | null = { id: 100 },
    ) => {
        const employee = {
            findMany: jest.fn().mockResolvedValue(employees),
        };
        const clientRepository = {
            findFirst: jest.fn().mockResolvedValue(client),
        };
        const transaction = {
            $queryRaw: jest.fn().mockResolvedValue([]),
            client: clientRepository,
            employee,
        };
        const prisma = {
            employee,
            $transaction: jest.fn(async (callback: (tx: typeof transaction) => Promise<unknown>) => callback(transaction)),
        };
        const scheduleRepository = {
            create: jest.fn().mockResolvedValue(new EmployeeScheduleEntity(
                10,
                100,
                2,
                null,
                "서울",
                new Date("2026-08-01T00:00:00.000Z"),
                new Date("2026-08-31T00:00:00.000Z"),
                false,
            )),
        };
        const createUsecase = new CreateEmployeeScheduleUsecase(
            scheduleRepository as never,
            prisma as never,
        );
        const findUsecase = { execute: jest.fn() };
        const listUsecase = { execute: jest.fn() };
        const listByPrimaryUsecase = { execute: jest.fn() };
        const listBySecondaryUsecase = { execute: jest.fn() };
        const updateUsecase = { execute: jest.fn() };
        const deleteUsecase = { execute: jest.fn() };
        const messageAutomationIntentService = {
            persistScheduleIntent: jest.fn().mockResolvedValue(undefined),
            fulfillScheduleIntent: jest.fn().mockResolvedValue(undefined),
        };
        const serviceRecordLinkService = {
            scheduleForServiceStart: jest.fn().mockResolvedValue(undefined),
        };
        const serviceRecordLifecycleService = {
            ensureForClient: jest.fn().mockResolvedValue(undefined),
        };
        messageAutomationIntentService.fulfillScheduleIntent.mockImplementation(
            ({ scheduleId }: { scheduleId: number }) => serviceRecordLinkService.scheduleForServiceStart(scheduleId),
        );

        const service = new EmployeeScheduleService(
            createUsecase,
            findUsecase as never,
            listUsecase as never,
            listByPrimaryUsecase as never,
            listBySecondaryUsecase as never,
            updateUsecase as never,
            deleteUsecase as never,
            prisma as never,
            messageAutomationIntentService as never,
            serviceRecordLinkService as never,
            serviceRecordLifecycleService as never,
        );

        return {
            service,
            employee,
            scheduleRepository,
            messageAutomationIntentService,
            serviceRecordLinkService,
            serviceRecordLifecycleService,
            clientRepository,
        };
    };

    const invalidCases: Array<[string, EmployeeCandidate[], number, number | null]> = [
        ["wrong branch", [{ ...eligible(), branchId: "branch-b" }], 2, null],
        ["soft deleted", [{ ...eligible(), deletedAt: new Date("2026-01-01T00:00:00.000Z") }], 2, null],
        ["unavailable", [{ ...eligible(), openToNextWork: false }], 2, null],
        ["missing", [], 999, null],
        ["wrong branch secondary", [eligible(), { ...eligible(3), branchId: "branch-b" }], 2, 3],
        ["soft deleted secondary", [eligible(), { ...eligible(3), deletedAt: new Date("2026-01-01T00:00:00.000Z") }], 2, 3],
        ["unavailable secondary", [eligible(), { ...eligible(3), openToNextWork: false }], 2, 3],
        ["missing secondary", [eligible()], 2, 999],
        ["same employee in both roles", [eligible()], 2, 2],
    ];

    it.each(invalidCases)(
        "refuses %s without schedule, automation, or service-record residue",
        async (_label, employees, primaryEmployeeId, secondaryEmployeeId) => {
            const {
                service,
                employee,
                scheduleRepository,
                messageAutomationIntentService,
                serviceRecordLinkService,
                serviceRecordLifecycleService,
            } = createHarness(employees);
            const promise = service.create(branchId, {
                clientId: 100,
                primaryEmployeeId,
                secondaryEmployeeId,
                workAddress: "서울",
                startDate: "2026-08-01",
                endDate: "2026-08-31",
            });

            await expect(promise).rejects.toThrow();
            expect(employee.findMany).toHaveBeenCalled();
            expect(scheduleRepository.create).not.toHaveBeenCalled();
            expect(messageAutomationIntentService.persistScheduleIntent).not.toHaveBeenCalled();
            expect(messageAutomationIntentService.fulfillScheduleIntent).not.toHaveBeenCalled();
            expect(serviceRecordLinkService.scheduleForServiceStart).not.toHaveBeenCalled();
            expect(serviceRecordLifecycleService.ensureForClient).not.toHaveBeenCalled();
        },
    );

    it("creates an eligible primary and secondary assignment before post-commit side effects", async () => {
        const {
            service,
            scheduleRepository,
            messageAutomationIntentService,
            serviceRecordLinkService,
            serviceRecordLifecycleService,
        } = createHarness([eligible(), eligible(3)]);

        await expect(service.create(branchId, {
            clientId: 100,
            primaryEmployeeId: 2,
            secondaryEmployeeId: 3,
            workAddress: "서울",
            startDate: "2026-08-01",
            endDate: "2026-08-31",
        })).resolves.toBeDefined();

        expect(scheduleRepository.create).toHaveBeenCalledTimes(1);
        expect(messageAutomationIntentService.persistScheduleIntent).toHaveBeenCalledTimes(1);
        expect(serviceRecordLinkService.scheduleForServiceStart).toHaveBeenCalledTimes(1);
        expect(serviceRecordLifecycleService.ensureForClient).toHaveBeenCalledTimes(1);
    });

    it("refuses a client outside the authenticated branch before schedule, automation, or service-record side effects", async () => {
        const {
            service,
            clientRepository,
            scheduleRepository,
            messageAutomationIntentService,
            serviceRecordLinkService,
            serviceRecordLifecycleService,
        } = createHarness([eligible()], null);

        await expect(service.create(branchId, {
            clientId: 100,
            primaryEmployeeId: 2,
            secondaryEmployeeId: null,
            workAddress: "서울",
            startDate: "2026-08-01",
            endDate: "2026-08-31",
        })).rejects.toThrow("Client not found for branch");

        expect(clientRepository.findFirst).toHaveBeenCalledWith({
            where: { id: 100, branchId },
            select: { id: true },
        });
        expect(scheduleRepository.create).not.toHaveBeenCalled();
        expect(messageAutomationIntentService.persistScheduleIntent).not.toHaveBeenCalled();
        expect(messageAutomationIntentService.fulfillScheduleIntent).not.toHaveBeenCalled();
        expect(serviceRecordLinkService.scheduleForServiceStart).not.toHaveBeenCalled();
        expect(serviceRecordLifecycleService.ensureForClient).not.toHaveBeenCalled();
    });
});
