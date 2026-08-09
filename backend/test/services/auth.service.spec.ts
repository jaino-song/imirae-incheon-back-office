import { BadRequestException, ForbiddenException, UnauthorizedException } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { createHash } from "crypto";
import { AuthService } from "application/services/auth.service";
import { AuthSessionService } from "application/services/auth-session.service";
import { AuthTokenEntity } from "domain/entities/auth-token.entity";
import { EmailPort } from "domain/ports/email.port";
import { IAuthTokenRepository } from "domain/repositories/auth-token.repository.interface";
import { PrismaService } from "infrastructure/database/prisma.service";

describe("AuthService approval and token hardening", () => {
    const prisma = {
        user: { findUnique: jest.fn(), create: jest.fn(), update: jest.fn() },
        user_branch: { findMany: jest.fn(), findFirst: jest.fn(), create: jest.fn() },
        branch: { findUnique: jest.fn() },
        auth_token: { create: jest.fn(), deleteMany: jest.fn() },
        auth_email_outbox: { create: jest.fn() },
        auth_session: { updateMany: jest.fn() },
        $transaction: jest.fn(),
    };
    const jwt = { signAsync: jest.fn(), verifyAsync: jest.fn() };
    const sessions = {
        issueSession: jest.fn(),
        rotateRefreshToken: jest.fn(),
    };
    const email: EmailPort = {
        send: jest.fn(), sendVerificationEmail: jest.fn(), sendPasswordResetEmail: jest.fn(),
    };
    const tokens: jest.Mocked<IAuthTokenRepository> = {
        findByToken: jest.fn(), findByUserIdAndType: jest.fn(), create: jest.fn(), update: jest.fn(),
        consumeWithinTx: jest.fn(),
        delete: jest.fn(), deleteByUserIdAndType: jest.fn(), deleteExpiredTokens: jest.fn(),
    };
    let service: AuthService;

    beforeEach(() => {
        jest.clearAllMocks();
        jwt.signAsync.mockResolvedValue("signed");
        sessions.issueSession.mockImplementation(async (user, branch) => ({
            accessToken: await jwt.signAsync({
                sub: user.id,
                role: user.role,
                tokenVersion: user.tokenVersion,
                ...branch,
                type: "access",
            }, {}),
            refreshToken: "opaque-refresh",
        }));
        prisma.$transaction.mockImplementation(async (callback: (tx: typeof prisma) => unknown) => callback(prisma));
        service = new AuthService(
            prisma as unknown as PrismaService,
            jwt as unknown as JwtService,
            email,
            tokens,
            sessions as unknown as AuthSessionService,
        );
    });

    it("registers an unassigned pending employee without trusting client branch or role", async () => {
        jest.spyOn(service, "hashPassword").mockResolvedValue("hash");
        jest.spyOn(service, "sendVerificationEmail").mockResolvedValue();
        prisma.user.findUnique.mockResolvedValue(null);
        prisma.user.create.mockResolvedValue({ id: "user-1", email: "new@example.com" });

        await service.registerWithEmail("new@example.com", "Password1!", "New", "010", "1990-01-01");

        expect(prisma.user.create).toHaveBeenCalledWith({ data: expect.objectContaining({
            role: null, approvalStatus: "pending", requestedRole: "user",
        }) });
        expect(prisma.branch.findUnique).not.toHaveBeenCalled();
        expect(prisma.user_branch.create).not.toHaveBeenCalled();
    });

    it("rejects a pending user before issuing login tokens", async () => {
        jest.spyOn(service, "verifyPassword").mockResolvedValue(true);
        prisma.user.findUnique.mockResolvedValue({
            id: "user-1", email: "p@example.com", passwordHash: "hash", emailVerified: true,
            role: null, approvalStatus: "pending", tokenVersion: 0,
        });

        await expect(service.validateEmailPassword("p@example.com", "Password1!"))
            .rejects.toMatchObject({ response: { code: "PENDING_APPROVAL" } });
        expect(jwt.signAsync).not.toHaveBeenCalled();
    });

    it("issues approved-user tokens containing tokenVersion", async () => {
        jest.spyOn(service, "verifyPassword").mockResolvedValue(true);
        prisma.user.findUnique.mockResolvedValue({
            id: "user-1", email: "a@example.com", name: "A", profileImage: null, phone: "010",
            birthDate: "1990-01-01", passwordHash: "hash", emailVerified: true, role: "user",
            approvalStatus: "approved", tokenVersion: 4,
        });
        prisma.user_branch.findMany.mockResolvedValue([{ branchId: "branch-1", role: "user" }]);

        await service.validateEmailPassword("a@example.com", "Password1!");

        expect(jwt.signAsync).toHaveBeenCalledWith(expect.objectContaining({ tokenVersion: 4, type: "access" }), expect.any(Object));
    });

    it("rejects incomplete approved accounts instead of starting self-service onboarding", async () => {
        jest.spyOn(service, "verifyPassword").mockResolvedValue(true);
        prisma.user.findUnique.mockResolvedValue({
            id: "user-1", email: "a@example.com", name: "A", profileImage: null, phone: null,
            birthDate: "1990-01-01", passwordHash: "hash", emailVerified: true, role: "user",
            approvalStatus: "approved", tokenVersion: 4,
        });
        prisma.user_branch.findMany.mockResolvedValue([{ branchId: "branch-1", role: "user" }]);

        await expect(service.validateEmailPassword("a@example.com", "Password1!"))
            .rejects.toMatchObject({ response: { code: "ACCOUNT_PROFILE_INCOMPLETE" } });
        expect(sessions.issueSession).not.toHaveBeenCalled();
    });

    it("rejects refresh for pending or stale-version users", async () => {
        sessions.rotateRefreshToken.mockRejectedValueOnce(new ForbiddenException());
        await expect(service.refreshTokens("refresh")).rejects.toBeInstanceOf(ForbiddenException);

        sessions.rotateRefreshToken.mockRejectedValueOnce(new UnauthorizedException());
        await expect(service.refreshTokens("refresh")).rejects.toBeInstanceOf(UnauthorizedException);
        expect(jwt.signAsync).not.toHaveBeenCalled();
    });

    it("increments tokenVersion when resetting a password", async () => {
        const token = AuthTokenEntity.reconstitute("token-1", "user-1", "hash", "password_reset", new Date(Date.now() + 60_000), new Date(), null);
        tokens.findByToken.mockResolvedValue(token);
        tokens.consumeWithinTx.mockResolvedValue(true);
        jest.spyOn(service, "hashPassword").mockResolvedValue("new-hash");
        prisma.user.findUnique.mockResolvedValue({ id: "user-1", kakaoId: null });

        await service.resetPassword("raw-token", "Password1!");

        expect(prisma.user.update).toHaveBeenCalledWith({ where: { id: "user-1" }, data: expect.objectContaining({ tokenVersion: { increment: 1 } }) });
        expect(tokens.consumeWithinTx).toHaveBeenCalledWith(
            prisma,
            createHash("sha256").update("raw-token").digest("hex"),
            "password_reset",
        );
    });

    it("allows a reset token once and rejects the second atomic consume", async () => {
        const token = AuthTokenEntity.reconstitute("token-1", "user-1", "hash", "password_reset", new Date(Date.now() + 60_000), new Date(), null);
        tokens.findByToken.mockResolvedValue(token);
        tokens.consumeWithinTx.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
        jest.spyOn(service, "hashPassword").mockResolvedValue("new-hash");
        prisma.user.findUnique.mockResolvedValue({ id: "user-1", kakaoId: null });

        await expect(service.resetPassword("raw-token", "Password1!")).resolves.toMatchObject({ success: true });

        await expect(service.resetPassword("raw-token", "Password1!")).rejects.toBeInstanceOf(BadRequestException);

        expect(prisma.user.update).toHaveBeenCalledTimes(1);
        expect(tokens.consumeWithinTx).toHaveBeenCalledTimes(2);
    });

    it("does not mutate a Kakao-only account during unauthenticated registration", async () => {
        prisma.user.findUnique.mockResolvedValue({ id: "user-1", kakaoId: "kakao", passwordHash: null, emailVerified: true });

        await service.registerWithEmail("existing@example.com", "Password1!", "Attacker", "010", "1990-01-01");

        expect(prisma.user.update).not.toHaveBeenCalled();
        expect(tokens.create).not.toHaveBeenCalled();
    });
});
