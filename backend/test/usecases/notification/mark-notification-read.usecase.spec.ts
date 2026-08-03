import { MarkNotificationReadUsecase } from "application/usecases/notification/mark-notification-read.usecase";
import { NotificationEntity } from "domain/entities/notification.entity";
import { INotificationRepository } from "domain/repositories/notification.repository.interface";

describe("MarkNotificationReadUsecase", () => {
    const branchId = "branch-a";
    const userId = "user-a";

    function setup() {
        const notificationRepository: jest.Mocked<INotificationRepository> = {
            findById: jest.fn(),
            findByUserId: jest.fn(),
            findUnreadByUserId: jest.fn(),
            countUnreadByUserId: jest.fn(),
            create: jest.fn(),
            updateData: jest.fn(),
            updateReadAt: jest.fn(),
            markAllAsReadByUserId: jest.fn(),
            deleteOlderThan: jest.fn(),
        };
        return { notificationRepository, usecase: new MarkNotificationReadUsecase(notificationRepository) };
    }

    it("updates readAt only and preserves provider metadata", async () => {
        const { notificationRepository, usecase } = setup();
        const providerData = { providerOutcome: { status: "delivered", delivered: 1, failed: 0 } };
        const notification = NotificationEntity.reconstitute(
            7, userId, "알림", "본문", providerData, new Date("2026-08-04T00:00:00.000Z"), null,
        );
        const readAt = new Date("2026-08-04T01:00:00.000Z");
        notificationRepository.findById.mockResolvedValue(notification);
        notificationRepository.updateReadAt.mockResolvedValue(
            NotificationEntity.reconstitute(7, userId, "알림", "본문", providerData, notification.sentAt, readAt),
        );

        const result = await usecase.execute(branchId, 7, userId);

        expect(notificationRepository.updateReadAt).toHaveBeenCalledWith(branchId, 7, expect.any(Date));
        expect(notificationRepository.updateData).not.toHaveBeenCalled();
        expect(result.data).toEqual(providerData);
        expect(result.readAt).toBe(readAt);
    });

    it("does not write again when the notification is already read", async () => {
        const { notificationRepository, usecase } = setup();
        const readAt = new Date("2026-08-04T01:00:00.000Z");
        const notification = NotificationEntity.reconstitute(
            7, userId, "알림", "본문", { providerOutcome: { status: "delivered" } }, new Date(), readAt,
        );
        notificationRepository.findById.mockResolvedValue(notification);

        await expect(usecase.execute(branchId, 7, userId)).resolves.toBe(notification);
        expect(notificationRepository.updateReadAt).not.toHaveBeenCalled();
    });
});
