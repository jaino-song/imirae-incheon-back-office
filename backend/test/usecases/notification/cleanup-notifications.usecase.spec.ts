import { CleanupNotificationsUsecase } from "application/usecases/notification/cleanup-notifications.usecase";
import { INotificationRepository } from "domain/repositories/notification.repository.interface";

describe("CleanupNotificationsUsecase", () => {
    const createMockRepository = (): jest.Mocked<INotificationRepository> => ({
        findById: jest.fn(),
        findByUserId: jest.fn(),
        findUnreadByUserId: jest.fn(),
        countUnreadByUserId: jest.fn(),
        create: jest.fn(),
        updateData: jest.fn(),
        updateReadAt: jest.fn(),
        markAllAsReadByUserId: jest.fn(),
        deleteOlderThan: jest.fn(),
    });

    let usecase: CleanupNotificationsUsecase;
    let repository: jest.Mocked<INotificationRepository>;
    const branchId = "org-1";

    beforeEach(() => {
        repository = createMockRepository();
        usecase = new CleanupNotificationsUsecase(repository);
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    describe("execute", () => {
        describe("given 30 days retention period", () => {
            it("should call deleteOlderThan with date 30 days ago", async () => {
                repository.deleteOlderThan.mockResolvedValue(10);

                const now = new Date("2025-01-17T12:00:00Z");
                jest.useFakeTimers().setSystemTime(now);

                await usecase.execute(branchId, 30);

                expect(repository.deleteOlderThan).toHaveBeenCalledTimes(1);
                const calledDate = repository.deleteOlderThan.mock.calls[0]?.[1] as Date;
                expect(calledDate.toISOString().split("T")[0]).toBe("2024-12-18");

                jest.useRealTimers();
            });

            it("should return the count of deleted notifications", async () => {
                repository.deleteOlderThan.mockResolvedValue(25);

                const result = await usecase.execute(branchId, 30);

                expect(result).toBe(25);
            });
        });

        describe("given 7 days retention period", () => {
            it("should call deleteOlderThan with date 7 days ago", async () => {
                repository.deleteOlderThan.mockResolvedValue(5);

                const now = new Date("2025-01-17T12:00:00Z");
                jest.useFakeTimers().setSystemTime(now);

                await usecase.execute(branchId, 7);

                const calledDate = repository.deleteOlderThan.mock.calls[0]?.[1] as Date;
                expect(calledDate.toISOString().split("T")[0]).toBe("2025-01-10");

                jest.useRealTimers();
            });
        });

        describe("given no old notifications exist", () => {
            it("should return 0", async () => {
                repository.deleteOlderThan.mockResolvedValue(0);

                const result = await usecase.execute(branchId, 30);

                expect(result).toBe(0);
            });
        });

        describe("given repository throws error", () => {
            it("should propagate the error", async () => {
                repository.deleteOlderThan.mockRejectedValue(new Error("DB Error"));

                await expect(usecase.execute(branchId, 30)).rejects.toThrow("DB Error");
            });
        });
    });
});
