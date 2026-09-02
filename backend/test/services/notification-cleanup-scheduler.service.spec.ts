import { NotificationCleanupSchedulerService } from "application/services/notification-cleanup-scheduler.service";
import { CleanupNotificationsUsecase } from "application/usecases/notification/cleanup-notifications.usecase";
import { IBranchRepository } from "domain/repositories/branch.repository.interface";
import { createSchedulerLeaseMock } from "../utils/mocks/scheduler-lease.mock";

describe("NotificationCleanupSchedulerService", () => {
    const createMockCleanupUsecase = () => ({
        execute: jest.fn(),
    });
    const createMockBranchRepository = () => ({
        findAllActive: jest.fn(),
    });

    let scheduler: NotificationCleanupSchedulerService;
    let cleanupUsecase: ReturnType<typeof createMockCleanupUsecase>;
    let branchRepository: ReturnType<typeof createMockBranchRepository>;

    beforeEach(() => {
        cleanupUsecase = createMockCleanupUsecase();
        branchRepository = createMockBranchRepository();
        branchRepository.findAllActive.mockResolvedValue([
            { id: "org-1", name: "Org 1" },
        ]);
        scheduler = new NotificationCleanupSchedulerService(
            cleanupUsecase as unknown as CleanupNotificationsUsecase,
            branchRepository as unknown as IBranchRepository,
            createSchedulerLeaseMock(),
        );
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    describe("cleanupOldNotifications", () => {
        describe("given cleanup succeeds", () => {
            it("should call cleanup usecase with 30 days retention", async () => {
                cleanupUsecase.execute.mockResolvedValue(15);

                await scheduler.cleanupOldNotifications();

                expect(cleanupUsecase.execute).toHaveBeenCalledWith("org-1", 30);
                expect(cleanupUsecase.execute).toHaveBeenCalledTimes(1);
            });
        });

        describe("given multiple active branches", () => {
            it("should run cleanup for each active branch", async () => {
                branchRepository.findAllActive.mockResolvedValue([
                    { id: "org-1", name: "Org 1" },
                    { id: "org-2", name: "Org 2" },
                ]);
                cleanupUsecase.execute.mockResolvedValue(5);

                await scheduler.cleanupOldNotifications();

                expect(cleanupUsecase.execute).toHaveBeenNthCalledWith(1, "org-1", 30);
                expect(cleanupUsecase.execute).toHaveBeenNthCalledWith(2, "org-2", 30);
                expect(cleanupUsecase.execute).toHaveBeenCalledTimes(2);
            });
        });

        describe("given cleanup deletes notifications", () => {
            it("should complete without throwing", async () => {
                cleanupUsecase.execute.mockResolvedValue(100);

                await expect(scheduler.cleanupOldNotifications()).resolves.not.toThrow();
            });
        });

        describe("given no notifications to delete", () => {
            it("should complete without throwing", async () => {
                cleanupUsecase.execute.mockResolvedValue(0);

                await expect(scheduler.cleanupOldNotifications()).resolves.not.toThrow();
            });
        });

        describe("given no active branches", () => {
            it("should skip cleanup", async () => {
                branchRepository.findAllActive.mockResolvedValue([]);

                await scheduler.cleanupOldNotifications();

                expect(cleanupUsecase.execute).not.toHaveBeenCalled();
            });
        });

        describe("given cleanup usecase throws error", () => {
            it("should not throw and handle error gracefully", async () => {
                cleanupUsecase.execute.mockRejectedValue(new Error("DB Connection Failed"));

                await expect(scheduler.cleanupOldNotifications()).resolves.not.toThrow();
            });
        });

        it("skips the run when the scheduler lease is not held", async () => {
            scheduler = new NotificationCleanupSchedulerService(
                cleanupUsecase as unknown as CleanupNotificationsUsecase,
                branchRepository as unknown as IBranchRepository,
                createSchedulerLeaseMock(false),
            );

            await scheduler.cleanupOldNotifications();

            expect(branchRepository.findAllActive).not.toHaveBeenCalled();
        });

        it("stops when the lease is lost mid-run", async () => {
            const schedulerLease = createSchedulerLeaseMock(false);
            schedulerLease.holdsLease.mockReturnValueOnce(true).mockReturnValueOnce(true);
            scheduler = new NotificationCleanupSchedulerService(
                cleanupUsecase as unknown as CleanupNotificationsUsecase,
                branchRepository as unknown as IBranchRepository,
                schedulerLease,
            );
            branchRepository.findAllActive.mockResolvedValue([
                { id: "org-1", name: "Org 1" },
                { id: "org-2", name: "Org 2" },
            ]);
            cleanupUsecase.execute.mockResolvedValue(5);

            await scheduler.cleanupOldNotifications();

            expect(cleanupUsecase.execute).toHaveBeenCalledTimes(1);
            expect(cleanupUsecase.execute).toHaveBeenCalledWith("org-1", 30);
        });
    });
});
