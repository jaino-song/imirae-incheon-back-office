import { BadRequestException, ForbiddenException } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { AuthService, type KakaoData } from "application/services/auth.service";
import { AuthSessionService } from "application/services/auth-session.service";
import { AuthTokenEntity } from "domain/entities/auth-token.entity";
import { EmailPort } from "domain/ports/email.port";
import { IAuthTokenRepository } from "domain/repositories/auth-token.repository.interface";
import { PrismaService } from "infrastructure/database/prisma.service";

describe("AuthService Kakao onboarding", () => {
    const createMockPrismaService = () => ({
        user: {
            findFirst: jest.fn(),
            findUnique: jest.fn(),
            create: jest.fn(),
            update: jest.fn(),
        },
        user_branch: {
            findFirst: jest.fn(),
            findMany: jest.fn(),
            create: jest.fn(),
            update: jest.fn(),
        },
        branch: {
            findUnique: jest.fn(),
        },
        auth_flow_state: {
            create: jest.fn(),
            findUnique: jest.fn(),
            update: jest.fn(),
            updateMany: jest.fn(),
            deleteMany: jest.fn(),
        },
        auth_token: {
            create: jest.fn(),
            deleteMany: jest.fn(),
        },
        auth_email_outbox: {
            create: jest.fn(),
        },
        auth_session: {
            updateMany: jest.fn(),
        },
        $transaction: jest.fn(),
    });

    const createMockJwtService = () => ({
        signAsync: jest.fn(),
        verifyAsync: jest.fn(),
    });

    const createMockEmailService = (): EmailPort => ({
        send: jest.fn().mockResolvedValue("mock-message-id"),
        sendVerificationEmail: jest.fn().mockResolvedValue("mock-verification-id"),
        sendPasswordResetEmail: jest.fn().mockResolvedValue("mock-reset-id"),
    });

    const createMockAuthTokenRepository = (): jest.Mocked<IAuthTokenRepository> => ({
        findByToken: jest.fn(),
        findByUserIdAndType: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        consumeWithinTx: jest.fn(),
        delete: jest.fn(),
        deleteByUserIdAndType: jest.fn(),
        deleteExpiredTokens: jest.fn(),
    });

    const kakaoData: KakaoData = {
        kakaoId: "kakao_12345",
        email: "kakao@example.com",
        emailValid: true,
        emailVerified: true,
        name: "Kakao User",
        profileImage: "https://example.com/profile.png",
    };

    const existingUser = {
        id: "user-1",
        kakaoId: kakaoData.kakaoId,
        email: kakaoData.email,
        name: kakaoData.name,
        profileImage: kakaoData.profileImage,
        role: "user",
        passwordHash: null,
        approvalStatus: "approved",
        tokenVersion: 0,
    };

    let prisma: ReturnType<typeof createMockPrismaService>;
    let jwt: ReturnType<typeof createMockJwtService>;
    let emailService: EmailPort;
    let authTokenRepository: jest.Mocked<IAuthTokenRepository>;
    let service: AuthService;

    beforeEach(() => {
        prisma = createMockPrismaService();
        prisma.$transaction.mockImplementation(async (callback: (tx: typeof prisma) => unknown) => callback(prisma));

        jwt = createMockJwtService();
        jwt.signAsync.mockResolvedValue("mock-jwt-token");
        emailService = createMockEmailService();
        authTokenRepository = createMockAuthTokenRepository();

        service = new AuthService(
            prisma as unknown as PrismaService,
            jwt as unknown as JwtService,
            emailService,
            authTokenRepository,
            {
                issueSession: jest.fn().mockResolvedValue({
                    accessToken: "mock-access-token",
                    refreshToken: "mock-refresh-token",
                }),
            } as unknown as AuthSessionService,
        );
    });

    it("returns onboardingRequired for brand-new Kakao users", async () => {
        prisma.user.findFirst.mockResolvedValue(null);
        prisma.user.findUnique.mockResolvedValue(null);

        const result = await service.validateKakaoUser(kakaoData);

        expect(result).toEqual({
            onboardingRequired: true,
            onboardingKind: "kakao_signup",
            pendingSignupData: {
                ...kakaoData,
                email: "kakao@example.com",
            },
        });
    });

    it("blocks login for existing Kakao users with no accessible branch", async () => {
        // No accessible branch => blocked (even with an otherwise-incomplete profile);
        // self-onboarding is only reachable for users who already have a branch.
        prisma.user.findFirst.mockResolvedValue({
            ...existingUser,
            phone: null,
            birthDate: null,
            role: null,
        } as never);
        prisma.user_branch.findMany.mockResolvedValue([] as never);

        await expect(service.validateKakaoUser(kakaoData)).rejects.toThrow(ForbiddenException);
    });

    it("exchanges a pending signup auth code into a persisted pending signup token", async () => {
        prisma.auth_flow_state.findUnique.mockResolvedValue({
            id: "flow-1",
            kind: "pending_kakao_signup_exchange",
            tokenHash: "hashed",
            accessToken: null,
            refreshToken: null,
            requiresBranchSelection: false,
            kakaoId: kakaoData.kakaoId,
            email: kakaoData.email,
            name: kakaoData.name,
            profileImage: kakaoData.profileImage,
            expiresAt: new Date(Date.now() + 60_000),
            createdAt: new Date(),
            consumedAt: null,
        });
        prisma.auth_flow_state.updateMany.mockResolvedValue({ count: 1 });
        prisma.auth_flow_state.create.mockResolvedValue({});

        const result = await service.exchangeCodeForTokens("exchange-code");

        expect(result).toMatchObject({
            onboardingRequired: true,
            prefill: {
                email: kakaoData.email,
                name: kakaoData.name,
                profileImage: kakaoData.profileImage,
            },
        });
        expect(prisma.auth_flow_state.updateMany).toHaveBeenCalledWith({
            where: {
                id: "flow-1",
                consumedAt: null,
            },
            data: {
                consumedAt: expect.any(Date),
            },
        });
        expect(prisma.auth_flow_state.create).toHaveBeenCalledWith(expect.objectContaining({
            data: expect.objectContaining({
                kind: "pending_kakao_signup",
                kakaoId: kakaoData.kakaoId,
                email: kakaoData.email,
            }),
        }));
    });

    it("rejects reused auth flow codes when atomic consume fails", async () => {
        prisma.auth_flow_state.findUnique.mockResolvedValue({
            id: "flow-1",
            kind: "pending_kakao_signup_exchange",
            tokenHash: "hashed",
            accessToken: null,
            refreshToken: null,
            requiresBranchSelection: false,
            kakaoId: kakaoData.kakaoId,
            email: kakaoData.email,
            name: kakaoData.name,
            profileImage: kakaoData.profileImage,
            expiresAt: new Date(Date.now() + 60_000),
            createdAt: new Date(),
            consumedAt: null,
        });
        prisma.auth_flow_state.updateMany.mockResolvedValue({ count: 0 });

        await expect(service.exchangeCodeForTokens("exchange-code")).rejects.toThrow("Authorization code already used");

        expect(prisma.auth_flow_state.create).not.toHaveBeenCalled();
    });

    it("completes Kakao registration without assigning a branch membership", async () => {
        const onboardingUser = {
            ...existingUser,
            phone: "010-1234-5678",
            birthDate: "1990-01-01",
            role: null,
            requestedRole: "manager",
            approvalStatus: "pending",
        };

        prisma.auth_flow_state.findUnique.mockResolvedValue({
            id: "pending-1",
            kind: "pending_kakao_signup",
            tokenHash: "hashed",
            accessToken: null,
            refreshToken: null,
            requiresBranchSelection: false,
            kakaoId: kakaoData.kakaoId,
            email: kakaoData.email,
            name: kakaoData.name,
            profileImage: kakaoData.profileImage,
            expiresAt: new Date(Date.now() + 60_000),
            createdAt: new Date(),
            consumedAt: null,
        });
        prisma.auth_flow_state.updateMany.mockResolvedValue({ count: 1 });
        prisma.user.findFirst
            .mockResolvedValueOnce(null)
            .mockResolvedValueOnce(null);
        prisma.user.create.mockResolvedValue(onboardingUser as never);

        await expect(service.completeKakaoOnboarding(
            "pending-token",
            "010-1234-5678",
            "1990-01-01",
            "manager",
        )).resolves.toEqual({
            success: true,
            userId: "user-1",
            message: "관리자 승인 대기 중입니다.",
        });

        expect(prisma.$transaction).toHaveBeenCalled();
        expect(prisma.auth_flow_state.updateMany).toHaveBeenCalledWith({
            where: {
                id: "pending-1",
                consumedAt: null,
            },
            data: { consumedAt: expect.any(Date) },
        });
        expect(prisma.user.create).toHaveBeenCalledWith(expect.objectContaining({
            data: expect.objectContaining({
                kakaoId: kakaoData.kakaoId,
                phone: "010-1234-5678",
                birthDate: "1990-01-01",
                role: null,
                requestedRole: "manager",
                approvalStatus: "pending",
            }),
        }));
        expect(prisma.branch.findUnique).not.toHaveBeenCalled();
        expect(prisma.user_branch.create).not.toHaveBeenCalled();
        expect(jwt.signAsync).not.toHaveBeenCalled();
    });

    it("rejects onboarding when the phone number already belongs to another user", async () => {
        prisma.auth_flow_state.findUnique.mockResolvedValue({
            id: "pending-1",
            kind: "pending_kakao_signup",
            tokenHash: "hashed",
            accessToken: null,
            refreshToken: null,
            requiresBranchSelection: false,
            kakaoId: kakaoData.kakaoId,
            email: kakaoData.email,
            name: kakaoData.name,
            profileImage: kakaoData.profileImage,
            expiresAt: new Date(Date.now() + 60_000),
            createdAt: new Date(),
            consumedAt: null,
        });
        prisma.auth_flow_state.updateMany.mockResolvedValue({ count: 1 });
        prisma.user.findFirst
            .mockResolvedValueOnce(null)
            .mockResolvedValueOnce({ id: "other-user" } as never);

        await expect(
            service.completeKakaoOnboarding(
                "pending-token",
                "010-1234-5678",
                "1990-01-01",
                "user",
            ),
        ).rejects.toThrow(BadRequestException);

        expect(prisma.user.create).not.toHaveBeenCalled();
    });

    it("blocks login for existing email users with no accessible branch", async () => {
        jest.spyOn(service, "verifyPassword").mockResolvedValue(true);

        prisma.user.findUnique.mockResolvedValue({
            id: "user-3",
            email: "legacy@example.com",
            name: "Legacy User",
            profileImage: null,
            phone: null,
            birthDate: null,
            role: null,
            passwordHash: "hashed-password",
            emailVerified: true,
        } as never);
        prisma.user_branch.findMany.mockResolvedValue([] as never);

        await expect(service.validateEmailPassword("legacy@example.com", "Password1!")).rejects.toThrow(ForbiddenException);
    });

    it("stores the requested role without creating a branch membership during email registration", async () => {
        jest.spyOn(service, "hashPassword").mockResolvedValue("hashed-password");

        prisma.user.findUnique
            .mockResolvedValueOnce(null)
            .mockResolvedValueOnce({ name: "Manager User" } as never);
        prisma.user.create.mockResolvedValue({
            id: "user-2",
            email: "manager@example.com",
        } as never);
        prisma.user_branch.create.mockResolvedValue({} as never);
        authTokenRepository.deleteByUserIdAndType.mockResolvedValue();
        authTokenRepository.create.mockResolvedValue(
            AuthTokenEntity.reconstitute(
                "token-1",
                "user-2",
                "hashed-token",
                "email_verification",
                new Date(Date.now() + 60_000),
                new Date(),
                null,
            ),
        );

        await service.registerWithEmail(
            "manager@example.com",
            "Password1!",
            "Manager User",
            "010-1234-5678",
            "1990-01-01",
        );

        expect(prisma.user_branch.create).not.toHaveBeenCalled();
    });
});
