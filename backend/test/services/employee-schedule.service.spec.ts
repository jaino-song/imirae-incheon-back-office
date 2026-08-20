import { EmployeeScheduleService } from "application/services/employee-schedule.service";
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
        const prisma = {
            $transaction: jest.fn(async (callback: (tx: unknown) => Promise<unknown>) => callback(transaction)),
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
});
