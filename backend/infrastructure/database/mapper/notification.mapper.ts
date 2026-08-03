import { NotificationEntity } from "domain/entities/notification.entity";
import { Prisma } from "@prisma/client";

type NotificationRow = {
    id: number;
    userId: string;
    title: string;
    body: string;
    data: Prisma.JsonValue | null;
    sentAt: Date;
    readAt: Date | null;
};

export class NotificationMapper {
    static toDomain(row: NotificationRow): NotificationEntity {
        return NotificationEntity.reconstitute(
            row.id,
            row.userId,
            row.title,
            row.body,
            row.data as Record<string, unknown> | null,
            row.sentAt,
            row.readAt,
        );
    }

    static toPrismaCreate(entity: NotificationEntity) {
        return {
            userId: entity.userId,
            title: entity.title,
            body: entity.body,
            ...(entity.data === null ? {} : { data: entity.data as Prisma.InputJsonValue }),
        };
    }

    static toPrismaUpdate(entity: NotificationEntity) {
        return {
            readAt: entity.readAt,
            ...(entity.data === null ? {} : { data: entity.data as Prisma.InputJsonValue }),
        };
    }
}
