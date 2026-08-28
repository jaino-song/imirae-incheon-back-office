import { ForbiddenException } from "@nestjs/common";
import { GUARDS_METADATA } from "@nestjs/common/constants";
import { ConfigService } from "@nestjs/config";
import { NotificationService } from "application/services/notification.service";
import { JwtGuard } from "infrastructure/auth/jwt.guard";
import { OwnerOrAdminGuard } from "infrastructure/auth/owner-or-admin.guard";
import { TenantGuard } from "infrastructure/tenant";
import { NotificationController } from "interface/controllers/notification.controller";

describe("NotificationController", () => {
    const getMethodGuards = (methodName: "testBroadcast") => {
        return Reflect.getMetadata(
            GUARDS_METADATA,
            NotificationController.prototype[methodName],
        ) ?? [];
    };

    it("should protect the development test broadcast endpoint with auth and admin guards", () => {
        const guards = getMethodGuards("testBroadcast");

        expect(guards).toContain(JwtGuard);
        expect(guards).toContain(TenantGuard);
        expect(guards).toContain(OwnerOrAdminGuard);
    });

    it("should block the test broadcast endpoint in production before broadcasting", async () => {
        const notificationService = {
            broadcastNotification: jest.fn(),
        };
        const configService = {
            get: jest.fn().mockReturnValue("production"),
        };
        const controller = new NotificationController(
            notificationService as unknown as NotificationService,
            configService as unknown as ConfigService,
        );

        await expect(controller.testBroadcast()).rejects.toBeInstanceOf(ForbiddenException);
        expect(notificationService.broadcastNotification).not.toHaveBeenCalled();
    });

    it("binds unsubscribe to the authenticated request user", async () => {
        const notificationService = {
            unsubscribePush: jest.fn().mockResolvedValue(undefined),
        };
        const controller = new NotificationController(
            notificationService as unknown as NotificationService,
            { get: jest.fn() } as unknown as ConfigService,
        );

        await expect(controller.unsubscribe(
            { user: { userId: "user-b", role: "user" } },
            { endpoint: "https://push.example/shared-endpoint" },
        )).resolves.toEqual({ success: true });
        expect(notificationService.unsubscribePush).toHaveBeenCalledWith(
            "user-b",
            "https://push.example/shared-endpoint",
        );
    });

    it("reconciles subscribe through the authenticated request user", async () => {
        const notificationService = {
            subscribePush: jest.fn().mockResolvedValue(undefined),
        };
        const controller = new NotificationController(
            notificationService as unknown as NotificationService,
            { get: jest.fn() } as unknown as ConfigService,
        );

        await expect(controller.subscribe(
            { user: { userId: "user-b", role: "user" } },
            {
                endpoint: "https://push.example/shared-endpoint",
                p256dh: "p256dh-b",
                auth: "auth-b",
                userAgent: "test-agent",
            },
        )).resolves.toEqual({ success: true });
        expect(notificationService.subscribePush).toHaveBeenCalledWith(
            "user-b",
            "https://push.example/shared-endpoint",
            "p256dh-b",
            "auth-b",
            "test-agent",
        );
    });
});
