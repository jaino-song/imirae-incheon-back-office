import { Prisma } from "@prisma/client";
import { NotificationEntity } from "domain/entities/notification.entity";
import { SbNotificationRepository } from "infrastructure/database/repositories/sb.notification.repository";

describe("SbNotificationRepository column-owned writes", () => {
    const branchId = "branch-a";
    const row = {
        id: 7,
        userId: "user-a",
        title: "알림",
        body: "본문",
        data: { providerOutcome: { status: "delivered" } },
        sentAt: new Date("2026-08-04T00:00:00.000Z"),
        readAt: null,
        branchId,
    };

    function setup() {
        const notification = {
            findFirst: jest.fn().mockResolvedValue(row),
            findMany: jest.fn(),
            count: jest.fn(),
            create: jest.fn(),
            updateMany: jest.fn().mockResolvedValue({ count: 1 }),
            deleteMany: jest.fn(),
        };
        const repository = new SbNotificationRepository({ notification } as never);
        return { repository, notification };
    }

    it("updates only provider-owned data and scopes the write to the branch", async () => {
        const { repository, notification } = setup();
        const data = { providerOutcome: { status: "partial", delivered: 1, failed: 1 } };

        await expect(repository.updateData(branchId, row.id, data)).resolves.toEqual(expect.any(NotificationEntity));

        expect(notification.updateMany).toHaveBeenCalledWith({
            where: { id: row.id, branchId },
            data: { data },
        });
        expect(notification.findFirst).toHaveBeenCalledWith({ where: { id: row.id, branchId } });
    });

    it("updates only readAt and scopes the write to the branch", async () => {
        const { repository, notification } = setup();
        const readAt = new Date("2026-08-04T01:00:00.000Z");

        await repository.updateReadAt(branchId, row.id, readAt);

        expect(notification.updateMany).toHaveBeenCalledWith({
            where: { id: row.id, branchId },
            data: { readAt },
        });
        expect(notification.findFirst).toHaveBeenCalledWith({ where: { id: row.id, branchId } });
    });

    it("uses Prisma JsonNull for an explicit provider-data clear", async () => {
        const { repository, notification } = setup();

        await repository.updateData(branchId, row.id, null);

        expect(notification.updateMany).toHaveBeenCalledWith({
            where: { id: row.id, branchId },
            data: { data: Prisma.JsonNull },
        });
    });

    it("preserves not-found behavior for both owned writes", async () => {
        const { repository, notification } = setup();
        notification.updateMany.mockResolvedValue({ count: 0 });

        await expect(repository.updateData(branchId, row.id, { providerOutcome: { status: "failed" } }))
            .rejects.toThrow("Notification not found for branch");
        await expect(repository.updateReadAt(branchId, row.id, new Date()))
            .rejects.toThrow("Notification not found for branch");
    });
});
