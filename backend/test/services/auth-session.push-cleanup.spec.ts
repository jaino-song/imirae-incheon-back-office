import { JwtService } from "@nestjs/jwt";

import { AuthSessionService } from "application/services/auth-session.service";
import { PrismaService } from "infrastructure/database/prisma.service";

describe("AuthSessionService push cleanup", () => {
    const tx = {
        auth_session: { updateMany: jest.fn() },
        auth_refresh_token: {
            updateMany: jest.fn(),
            findUnique: jest.fn(),
        },
        push_subscription: { deleteMany: jest.fn() },
    };
    const prisma = {
        $transaction: jest.fn(),
    };
    const jwt = {
        verifyAsync: jest.fn(),
    };

    beforeEach(() => {
        jest.clearAllMocks();
        tx.auth_session.updateMany.mockResolvedValue({ count: 1 });
        tx.auth_refresh_token.updateMany.mockResolvedValue({ count: 1 });
        tx.push_subscription.deleteMany.mockResolvedValue({ count: 1 });
        prisma.$transaction.mockImplementation(async (callback: (transaction: typeof tx) => unknown) => callback(tx));
    });

    it("revokes the session and removes only the logging-out browser endpoint in one transaction", async () => {
        const service = new AuthSessionService(
            prisma as unknown as PrismaService,
            jwt as unknown as JwtService,
        );

        await service.revokeSession(
            "session-1",
            "user-a",
            "logout",
            "https://push.example/user-a-device",
        );

        expect(tx.auth_session.updateMany).toHaveBeenCalledWith(expect.objectContaining({
            where: { id: "session-1", userId: "user-a", revokedAt: null },
        }));
        expect(tx.push_subscription.deleteMany).toHaveBeenCalledWith({
            where: {
                userId: "user-a",
                endpoint: "https://push.example/user-a-device",
            },
        });
    });

    it("falls back to user-wide cleanup when a legacy logout has no browser endpoint", async () => {
        const service = new AuthSessionService(
            prisma as unknown as PrismaService,
            jwt as unknown as JwtService,
        );

        await service.revokeSession("session-1", "user-a", "logout");

        expect(tx.push_subscription.deleteMany).toHaveBeenCalledWith({
            where: { userId: "user-a" },
        });
    });

    it("keeps cleanup failures visible so the revocation transaction cannot acknowledge partial logout", async () => {
        tx.push_subscription.deleteMany.mockRejectedValueOnce(new Error("database unavailable"));
        const service = new AuthSessionService(
            prisma as unknown as PrismaService,
            jwt as unknown as JwtService,
        );

        await expect(service.revokeSession("session-1", "user-a", "logout")).rejects.toThrow(
            "database unavailable",
        );
    });

    it("does not swallow cleanup failures when logout authenticates with an access token", async () => {
        jwt.verifyAsync.mockResolvedValueOnce({
            type: "access",
            sub: "user-a",
            sid: "session-1",
        });
        tx.push_subscription.deleteMany.mockRejectedValueOnce(new Error("database unavailable"));
        const service = new AuthSessionService(
            prisma as unknown as PrismaService,
            jwt as unknown as JwtService,
        );

        await expect(service.revokeSessionByAccessToken(
            "signed-access-token",
            "logout",
            "https://push.example/user-a-device",
        )).rejects.toThrow("database unavailable");
    });

    it("returns false for an unknown refresh credential so callers can try a valid access token", async () => {
        tx.auth_refresh_token.findUnique = jest.fn().mockResolvedValue(null);
        const service = new AuthSessionService(
            prisma as unknown as PrismaService,
            jwt as unknown as JwtService,
        );

        await expect(service.revokeSessionByRefreshToken(
            "00000000-0000-4000-8000-000000000001.secret",
        )).resolves.toBe(false);
    });
});
