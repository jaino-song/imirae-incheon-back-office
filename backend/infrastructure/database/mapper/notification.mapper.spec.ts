import { NotificationEntity } from "domain/entities/notification.entity";
import { NotificationMapper } from "./notification.mapper";

describe("NotificationMapper", () => {
    it("omits nullable JSON data instead of passing raw null to Prisma", () => {
        const entity = NotificationEntity.reconstitute(1, "user-a", "제목", "본문", null, new Date(), new Date());

        expect(NotificationMapper.toPrismaCreate(entity)).not.toHaveProperty("data");
        expect(NotificationMapper.toPrismaUpdate(entity)).toEqual({ readAt: entity.readAt });
    });

    it("preserves concrete JSON payloads", () => {
        const entity = NotificationEntity.reconstitute(1, "user-a", "제목", "본문", { route: "/clients" }, new Date(), null);

        expect(NotificationMapper.toPrismaCreate(entity)).toHaveProperty("data", { route: "/clients" });
        expect(NotificationMapper.toPrismaUpdate(entity)).toHaveProperty("data", { route: "/clients" });
    });
});
