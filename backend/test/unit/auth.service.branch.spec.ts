import { UnauthorizedException, ForbiddenException } from "@nestjs/common";
import { AuthService } from "../../application/services/auth.service";
import { AuthSessionService } from "../../application/services/auth-session.service";
import { PrismaService } from "../../infrastructure/database/prisma.service";
import { JwtService } from "@nestjs/jwt";
import { EmailPort } from "../../domain/ports/email.port";

describe("AuthService - Multi-Tenancy Enhancement", () => {
    // ============================================
    // Test Fixtures & Setup
    // ============================================

    const createMockPrismaService = () => {
        const prisma = {
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
        },
        branch: {
            findUnique: jest.fn(),
            findMany: jest.fn(),
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
        };
        prisma.$transaction.mockImplementation(async (callback: (tx: typeof prisma) => unknown) => callback(prisma));
        return prisma;
    };

    const createMockJwtService = () => ({
        signAsync: jest.fn(),
        verifyAsync: jest.fn(),
    });

    const createMockEmailService = (): EmailPort => ({
        send: jest.fn().mockResolvedValue("mock-message-id"),
        sendVerificationEmail: jest.fn().mockResolvedValue("mock-verification-id"),
        sendPasswordResetEmail: jest.fn().mockResolvedValue("mock-reset-id"),
    });

    const createMockAuthTokenRepository = () => ({
        findByToken: jest.fn(),
        findByUserIdAndType: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        consumeWithinTx: jest.fn(),
        delete: jest.fn(),
        deleteByUserIdAndType: jest.fn(),
        deleteExpiredTokens: jest.fn(),
    });

    const mockUser = {
        id: "user-uuid-123",
        kakaoId: "kakao-12345",
        email: "test@example.com",
        name: "Test User",
        phone: "010-1234-5678",
        birthDate: "1990-01-01",
        profileImage: null,
        role: "user",
        approvalStatus: "approved",
        tokenVersion: 0,
    };

    const mockBranch = {
        id: "org-uuid-123",
        name: "Test Branch",
        slug: "test-org",
        isActive: true,
    };

    const mockUserBranch = {
        id: "user-org-uuid-123",
        userId: mockUser.id,
        branchId: mockBranch.id,
        role: "admin",
    };

    const mockBranch2 = {
        id: "org-uuid-456",
        name: "Second Branch",
        slug: "second-org",
        isActive: true,
    };

    const mockUserBranch2 = {
        id: "user-org-uuid-456",
        userId: mockUser.id,
        branchId: mockBranch2.id,
        role: "member",
    };

    let service: AuthService;
    let prismaService: ReturnType<typeof createMockPrismaService>;
    let jwtService: ReturnType<typeof createMockJwtService>;
    let emailService: EmailPort;
    let authTokenRepository: ReturnType<typeof createMockAuthTokenRepository>;
    let authSessionService: {
        issueSession: jest.Mock;
        changeSessionBranch: jest.Mock;
        rotateRefreshToken: jest.Mock;
    };

    beforeEach(() => {
        prismaService = createMockPrismaService();
        jwtService = createMockJwtService();
        emailService = createMockEmailService();
        authTokenRepository = createMockAuthTokenRepository();
        const issueTokens = async (
            user: typeof mockUser,
            branch?: { branchId?: string; branchRole?: string },
        ) => ({
            accessToken: await jwtService.signAsync({
                sub: user.id,
                sid: "session-1",
                role: user.role,
                tokenVersion: user.tokenVersion,
                ...(branch?.branchId
                    ? {
                        branchId: branch.branchId,
                        branchRole: branch.branchRole,
                    }
                    : {}),
                type: "access",
            }, { expiresIn: "15m" }),
            refreshToken: "refresh-id.opaque-secret",
        });
        authSessionService = {
            issueSession: jest.fn(issueTokens),
            changeSessionBranch: jest.fn((
                _sessionId: string,
                user: typeof mockUser,
                branch: { branchId?: string; branchRole?: string },
            ) => issueTokens(user, branch)),
            rotateRefreshToken: jest.fn(),
        };

        // Type assertion to work around constructor typing
        service = new AuthService(
            prismaService as unknown as PrismaService,
            jwtService as unknown as JwtService,
            emailService,
            authTokenRepository as unknown as ReturnType<typeof createMockAuthTokenRepository>,
            authSessionService as unknown as AuthSessionService,
        );

        // Setup default mock returns
        jwtService.signAsync.mockResolvedValue("mock-jwt-token");
        jwtService.verifyAsync.mockResolvedValue({
            sub: mockUser.id,
            role: mockUser.role,
            type: "refresh",
        });
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    // ============================================
    // validateKakaoUser Tests
    // ============================================
    describe("validateKakaoUser", () => {
        describe("given user with exactly 1 branch", () => {
            it("should include branchId in JWT", async () => {
                // #given
                const kakaoData = {
                    kakaoId: "kakao-12345",
                    email: "test@example.com",
                    name: "Test User",
                };

                prismaService.user.findFirst.mockResolvedValue(mockUser);
                prismaService.user_branch.findMany.mockResolvedValue([mockUserBranch]);
                prismaService.branch.findUnique.mockResolvedValue(mockBranch);

                // #when
                await service.validateKakaoUser(kakaoData);

                // #then
                expect(jwtService.signAsync).toHaveBeenCalledTimes(1);
                const accessCall = jwtService.signAsync.mock.calls.find(
                    (call: any[]) => call[0]?.type === "access"
                );
                expect(accessCall?.[0]).toHaveProperty("branchId", mockBranch.id);
            });
        });

        describe("given user with multiple branches", () => {
            it("should NOT include branchId in JWT", async () => {
                // #given
                const kakaoData = {
                    kakaoId: "kakao-12345",
                    email: "test@example.com",
                    name: "Test User",
                };

                prismaService.user.findFirst.mockResolvedValue(mockUser);
                prismaService.user_branch.findMany.mockResolvedValue([
                    mockUserBranch,
                    mockUserBranch2,
                ]);

                // #when
                const result = await service.validateKakaoUser(kakaoData);

                // #then
                expect(result).toBeDefined();
                const accessCall = jwtService.signAsync.mock.calls.find(
                    (call: any[]) => call[0]?.type === "access"
                );
                expect(accessCall).toBeDefined();
                expect(accessCall![0]).not.toHaveProperty("branchId");
            });

            it("should set requiresBranchSelection=true in result", async () => {
                // #given
                const kakaoData = {
                    kakaoId: "kakao-12345",
                    email: "test@example.com",
                    name: "Test User",
                };

                prismaService.user.findFirst.mockResolvedValue(mockUser);
                prismaService.user_branch.findMany.mockResolvedValue([
                    mockUserBranch,
                    mockUserBranch2,
                ]);

                // #when
                const result = await service.validateKakaoUser(kakaoData);

                // #then
                expect(result).toHaveProperty("requiresBranchSelection", true);
            });
        });

        describe("given user with no branches", () => {
            it("should reject login with the no accessible branch message", async () => {
                // #given
                const kakaoData = {
                    kakaoId: "kakao-12345",
                    email: "test@example.com",
                    name: "Test User",
                };

                prismaService.user.findFirst.mockResolvedValue(mockUser);
                prismaService.user_branch.findMany.mockResolvedValue([]);

                // #when
                const action = () => service.validateKakaoUser(kakaoData);

                // #then
                await expect(action).rejects.toThrow(ForbiddenException);
                await expect(action).rejects.toThrow("접근 가능한 지점이 없습니다. 관리자에게 문의해 주세요.");
                expect(jwtService.signAsync).not.toHaveBeenCalled();
            });
        });

        describe("given user only has an active Incheon district branch", () => {
            it("should issue a session scoped to that district branch", async () => {
                const kakaoData = {
                    kakaoId: "kakao-12345",
                    email: "test@example.com",
                    name: "Test User",
                };
                const incheonDistrictBranch = {
                    id: "incheon-bupyeong-id",
                    name: "인천 부평구점",
                    slug: "incheon-bupyeong",
                    isActive: true,
                };

                prismaService.user.findFirst.mockResolvedValue(mockUser);
                prismaService.user_branch.findMany.mockResolvedValue([
                    {
                        ...mockUserBranch,
                        branchId: incheonDistrictBranch.id,
                        branch: incheonDistrictBranch,
                    },
                ]);

                await service.validateKakaoUser(kakaoData);

                const accessCall = jwtService.signAsync.mock.calls.find(
                    (call: any[]) => call[0]?.type === "access"
                );
                expect(accessCall?.[0]).toHaveProperty("branchId", incheonDistrictBranch.id);
                expect(accessCall?.[0]).toHaveProperty("branchRole", "admin");
            });
        });
    });

    // ============================================
    // selectBranch Tests (NEW METHOD)
    // ============================================
    describe("selectBranch", () => {
        describe("given user belongs to branch", () => {
            it("should issue JWT with selected branchId", async () => {
                // #given
                const userId = mockUser.id;
                const branchId = mockBranch.id;

                prismaService.user.findUnique.mockResolvedValue(mockUser);
                prismaService.user_branch.findFirst.mockResolvedValue(mockUserBranch);

                // #when
                await service.selectBranch(userId, branchId);

                // #then
                const accessCall = jwtService.signAsync.mock.calls.find(
                    (call: any[]) => call[0]?.type === "access"
                );
                expect(accessCall?.[0]).toHaveProperty("branchId", branchId);
                expect(accessCall?.[0]).toHaveProperty("branchRole", "admin");
            });
        });

        describe("given user does NOT belong to branch", () => {
            it("should throw ForbiddenException", async () => {
                // #given
                const userId = mockUser.id;
                const invalidOrgId = "org-uuid-999";

                prismaService.user.findUnique.mockResolvedValue(mockUser);
                prismaService.user_branch.findFirst.mockResolvedValue(null);

                // #when
                const action = () => service.selectBranch(userId, invalidOrgId);

                // #then
                await expect(action).rejects.toThrow(ForbiddenException);
                await expect(action).rejects.toThrow("User does not belong to this branch");
            });
        });

        describe("given user belongs to an active Incheon district branch", () => {
            it("should issue JWT scoped to that district branch", async () => {
                const incheonDistrictBranch = {
                    id: "incheon-bupyeong-id",
                    name: "인천 부평구점",
                    slug: "incheon-bupyeong",
                    isActive: true,
                };
                const membership = {
                    ...mockUserBranch,
                    branchId: incheonDistrictBranch.id,
                    branch: incheonDistrictBranch,
                };

                prismaService.user.findUnique.mockResolvedValue(mockUser);
                prismaService.user_branch.findFirst.mockResolvedValue(membership);

                await service.selectBranch(mockUser.id, incheonDistrictBranch.id);

                const accessCall = jwtService.signAsync.mock.calls.find(
                    (call: any[]) => call[0]?.type === "access"
                );
                expect(accessCall?.[0]).toHaveProperty("branchId", incheonDistrictBranch.id);
                expect(accessCall?.[0]).toHaveProperty("branchRole", "admin");
            });
        });

        describe("given user does not exist", () => {
            it("should throw UnauthorizedException", async () => {
                // #given
                const invalidUserId = "user-uuid-999";
                const branchId = mockBranch.id;

                prismaService.user.findUnique.mockResolvedValue(null);

                // #when
                const action = () => service.selectBranch(invalidUserId, branchId);

                // #then
                await expect(action).rejects.toThrow(UnauthorizedException);
                await expect(action).rejects.toThrow("User not found");
            });
        });

        describe("given user has member role", () => {
            it("should include branchRole in JWT", async () => {
                // #given
                const userId = mockUser.id;
                const branchId = mockBranch.id;
                const memberUserOrg = { ...mockUserBranch, role: "member" };

                prismaService.user.findUnique.mockResolvedValue(mockUser);
                prismaService.user_branch.findFirst.mockResolvedValue(memberUserOrg);

                // #when
                await service.selectBranch(userId, branchId);

                // #then
                const accessCall = jwtService.signAsync.mock.calls.find(
                    (call: any[]) => call[0]?.type === "access"
                );
                expect(accessCall?.[0]).toHaveProperty("branchRole", "member");
            });
        });

        it.each(["owner", "admin", "manager", "user"])(
        "should issue a 15m access token and opaque refresh session for %s",
        async (role) => {
            // #given
            const userId = mockUser.id;
            const branchId = mockBranch.id;
            const user = { ...mockUser, role };

            prismaService.user.findUnique.mockResolvedValue(user);
            if (role === "owner") {
                prismaService.branch.findUnique.mockResolvedValue(mockBranch);
            } else {
                prismaService.user_branch.findFirst.mockResolvedValue(mockUserBranch);
            }

            // #when
            await service.selectBranch(userId, branchId);

            // #then
            const accessCall = jwtService.signAsync.mock.calls.find(
                (call: any[]) => call[0]?.type === "access"
            );
            expect(accessCall?.[1]).toEqual({ expiresIn: "15m" });
            expect(authSessionService.issueSession).toHaveBeenCalled();
            expect(jwtService.signAsync.mock.calls).toHaveLength(1);
        },
        );
    });

    // ============================================
    // switchBranch Tests (NEW METHOD)
    // ============================================
    describe("switchBranch", () => {
        describe("given switching to a new branch user belongs to", () => {
            it("should issue new JWT with new branchId", async () => {
                // #given
                const userId = mockUser.id;
                const currentOrgId = mockBranch.id;
                const newOrgId = mockBranch2.id;

                prismaService.user.findUnique.mockResolvedValue(mockUser);
                prismaService.user_branch.findFirst.mockImplementation((opts: any) => {
                    if (opts.where.branchId === newOrgId) {
                        return Promise.resolve(mockUserBranch2);
                    }
                    return Promise.resolve(mockUserBranch);
                });

                // #when
                await service.switchBranch(userId, currentOrgId, newOrgId);

                // #then
                const accessCall = jwtService.signAsync.mock.calls.find(
                    (call: any[]) => call[0]?.type === "access"
                );
                expect(accessCall?.[0]).toHaveProperty("branchId", newOrgId);
            });
        });

        describe("given user does NOT belong to target branch", () => {
            it("should throw ForbiddenException", async () => {
                // #given
                const userId = mockUser.id;
                const currentOrgId = mockBranch.id;
                const invalidOrgId = "org-uuid-999";

                prismaService.user.findUnique.mockResolvedValue(mockUser);
                prismaService.user_branch.findFirst.mockResolvedValue(null);

                // #when
                const action = () => service.switchBranch(userId, currentOrgId, invalidOrgId);

                // #then
                await expect(action).rejects.toThrow(ForbiddenException);
                await expect(action).rejects.toThrow("User does not belong to target branch");
            });
        });
    });

    // ============================================
    // registerWithEmail Tests
    // ============================================
    describe("registerWithEmail", () => {
        it("should reject passwords without uppercase letters", async () => {
            const result = service.validatePasswordStrength("password1!");

            expect(result.valid).toBe(false);
            expect(result.errors).toContain("비밀번호에 대문자가 포함되어야 합니다.");
        });

        it("should leave branch assignment to the owner approval flow", async () => {
            prismaService.user.findUnique
                .mockResolvedValueOnce(null)
                .mockResolvedValueOnce({ name: "Manager User" });
            prismaService.user.create.mockResolvedValue({
                ...mockUser,
                id: "new-user-uuid-123",
                role: "manager",
                emailVerified: false,
            });
            prismaService.user_branch.create.mockResolvedValue(undefined);
            authTokenRepository.deleteByUserIdAndType.mockResolvedValue(undefined);
            authTokenRepository.create.mockResolvedValue(undefined);

            await service.registerWithEmail(
                "manager@example.com",
                "Password1!",
                "Manager User",
                "010-1234-5678",
                "1990-01-01",
            );

            expect(prismaService.branch.findUnique).not.toHaveBeenCalled();
            expect(prismaService.user_branch.create).not.toHaveBeenCalled();
        });
    });

    // ============================================
    // refreshTokens Tests
    // ============================================
    describe("refreshTokens", () => {
        it("delegates opaque refresh rotation without decoding it as JWT", async () => {
            authSessionService.rotateRefreshToken.mockResolvedValue({
                accessToken: "new-access",
                refreshToken: "next-id.next-secret",
            });

            await expect(service.refreshTokens("token-id.opaque-secret")).resolves.toEqual({
                accessToken: "new-access",
                refreshToken: "next-id.next-secret",
            });
            expect(authSessionService.rotateRefreshToken).toHaveBeenCalledWith(
                "token-id.opaque-secret",
            );
            expect(jwtService.verifyAsync).not.toHaveBeenCalled();
        });
    });

    // ============================================
    // getUserBranches Tests (NEW METHOD)
    // ============================================
    describe("getUserBranches", () => {
        describe("given user with branches", () => {
            it("should return list of branches with roles", async () => {
                // #given
                const userId = mockUser.id;

                prismaService.user.findUnique.mockResolvedValue({ role: "user" });
                prismaService.user_branch.findMany.mockResolvedValue([
                    { ...mockUserBranch, branch: mockBranch },
                    { ...mockUserBranch2, branch: mockBranch2 },
                ]);

                // #when
                const result = await service.getUserBranches(userId);

                // #then
                expect(result).toHaveLength(2);
                expect(result[0]).toMatchObject({
                    id: mockBranch.id,
                    name: mockBranch.name,
                    slug: mockBranch.slug,
                    role: "admin",
                });
                expect(result[1]).toMatchObject({
                    id: mockBranch2.id,
                    name: mockBranch2.name,
                    slug: mockBranch2.slug,
                    role: "member",
                });
            });

            it("should include active Incheon district branches in the regular user branch list", async () => {
                const userId = mockUser.id;
                const incheonDistrictBranch = {
                    id: "incheon-bupyeong-id",
                    name: "인천 부평구점",
                    slug: "incheon-bupyeong",
                    isActive: true,
                };
                const canonicalIncheonBranch = {
                    id: "incheon-id",
                    name: "인천 아이미래로",
                    slug: "incheon",
                    isActive: true,
                };

                prismaService.user.findUnique.mockResolvedValue({ role: "user" });
                prismaService.user_branch.findMany.mockResolvedValue([
                    { ...mockUserBranch, branch: incheonDistrictBranch },
                    { ...mockUserBranch2, branch: canonicalIncheonBranch },
                ]);

                const result = await service.getUserBranches(userId);

                expect(result).toEqual([
                    {
                        id: incheonDistrictBranch.id,
                        name: incheonDistrictBranch.name,
                        slug: incheonDistrictBranch.slug,
                        role: "admin",
                    },
                    {
                        id: canonicalIncheonBranch.id,
                        name: canonicalIncheonBranch.name,
                        slug: canonicalIncheonBranch.slug,
                        role: "member",
                    },
                ]);
            });
        });

        describe("given owner user", () => {
            it("should include active Incheon district branches in the owner branch list", async () => {
                const userId = mockUser.id;
                const incheonDistrictBranch = {
                    id: "incheon-yeonsu-id",
                    name: "인천 연수구점",
                    slug: "incheon-yeonsu",
                    isActive: true,
                };
                const canonicalIncheonBranch = {
                    id: "incheon-id",
                    name: "인천 아이미래로",
                    slug: "incheon",
                    isActive: true,
                };

                prismaService.user.findUnique.mockResolvedValue({ role: "owner" });
                prismaService.branch.findMany.mockResolvedValue([
                    incheonDistrictBranch,
                    canonicalIncheonBranch,
                    mockBranch,
                ]);

                const result = await service.getUserBranches(userId);

                expect(result).toEqual([
                    {
                        id: incheonDistrictBranch.id,
                        name: incheonDistrictBranch.name,
                        slug: incheonDistrictBranch.slug,
                        role: "owner",
                    },
                    {
                        id: canonicalIncheonBranch.id,
                        name: canonicalIncheonBranch.name,
                        slug: canonicalIncheonBranch.slug,
                        role: "owner",
                    },
                    {
                        id: mockBranch.id,
                        name: mockBranch.name,
                        slug: mockBranch.slug,
                        role: "owner",
                    },
                ]);
            });
        });

        describe("given user with no branches", () => {
            it("should return empty array", async () => {
                // #given
                const userId = mockUser.id;

                prismaService.user.findUnique.mockResolvedValue({ role: "user" });
                prismaService.user_branch.findMany.mockResolvedValue([]);

                // #when
                const result = await service.getUserBranches(userId);

                // #then
                expect(result).toHaveLength(0);
                expect(result).toEqual([]);
                expect(prismaService.branch.findUnique).not.toHaveBeenCalled();
            });
        });
    });

    // ============================================
    // Email outbox resilience tests
    // ============================================
    describe("requestPasswordReset", () => {
        it("should return success after queuing a password reset email", async () => {
            // #given
            prismaService.user.findUnique.mockResolvedValue({
                ...mockUser,
                emailVerified: true,
            });
            const result = await service.requestPasswordReset(mockUser.email);

            expect(result).toEqual({
                success: true,
                message: "비밀번호 재설정 이메일이 발송되었습니다.",
            });
            expect(prismaService.auth_token.deleteMany).toHaveBeenCalledWith({
                where: { userId: mockUser.id, type: "password_reset" },
            });
            expect(prismaService.auth_token.create).toHaveBeenCalledTimes(1);
            expect(prismaService.auth_email_outbox.create).toHaveBeenCalledTimes(1);
            expect(emailService.sendPasswordResetEmail).not.toHaveBeenCalled();
        });
    });

    describe("resendVerificationEmail", () => {
        it("should return success after queuing a verification email", async () => {
            // #given
            prismaService.user.findUnique
                .mockResolvedValueOnce({
                    ...mockUser,
                    emailVerified: false,
                })
                .mockResolvedValueOnce({
                    name: mockUser.name,
                });
            const result = await service.resendVerificationEmail(mockUser.email);

            expect(result).toEqual({
                success: true,
                message: "인증 이메일이 발송되었습니다.",
            });
            expect(prismaService.auth_token.deleteMany).toHaveBeenCalledWith({
                where: { userId: mockUser.id, type: "email_verification" },
            });
            expect(prismaService.auth_token.create).toHaveBeenCalledTimes(1);
            expect(prismaService.auth_email_outbox.create).toHaveBeenCalledTimes(1);
            expect(emailService.sendVerificationEmail).not.toHaveBeenCalled();
        });
    });
});
