import { Test, TestingModule } from "@nestjs/testing";
import { ExecutionContext, ForbiddenException, INestApplication, ValidationPipe, UnauthorizedException } from "@nestjs/common";
import request from "supertest";
import { AuthController } from "interface/controllers/auth.controller";
import { AuthService } from "application/services/auth.service";
import { PrismaService } from "infrastructure/database/prisma.service";
import { JwtGuard } from "infrastructure/auth/jwt.guard";
import { RateLimitGuard } from "infrastructure/auth/rate-limit.guard";
import { GUARDS_METADATA } from "@nestjs/common/constants";
import {
    KakaoAuthGuard,
    KAKAO_OAUTH_ERROR_REQUEST_KEY,
} from "infrastructure/auth/kakao-auth.guard";

describe("AuthController (Integration)", () => {
    // ============================================
    // Test Fixtures & Setup
    // ============================================

    let app: INestApplication;
    let authService: jest.Mocked<AuthService>;
    let prismaService: jest.Mocked<PrismaService>;
    let rateLimitGuard: jest.Mocked<Pick<RateLimitGuard, "canActivate" | "resetForKey">>;
    let authController: AuthController;

    // Several callback tests mutate process.env (NODE_ENV, *_FRONTEND_URL).
    // Snapshot once, give each test a fresh copy, and restore at the end so the
    // mutations can't leak across tests (or into the next file in this worker).
    const OLD_ENV = process.env;

    const mockUser = {
        id: "user-uuid-123",
        name: "Test User",
        email: "test@example.com",
        profileImage: "https://example.com/profile.jpg",
        role: "user",
        branchName: null,
    };

    const mockTokens = {
        accessToken: "mock-access-token",
        refreshToken: "mock-refresh-token",
    };

    const mockKakaoUser = {
        kakaoId: "12345678",
        email: "kakao@example.com",
        name: "Kakao User",
        profileImage: "https://kakao.com/profile.jpg",
    };

    const mockPendingSignup = {
        onboardingRequired: true as const,
        onboardingRoute: "/kakao/onboarding" as const,
        pendingSignupToken: "pending-signup-token",
        prefill: {
            email: mockKakaoUser.email,
            name: mockKakaoUser.name,
            profileImage: mockKakaoUser.profileImage,
        },
    };

    const mockPendingAccountOnboarding = {
        onboardingRequired: true as const,
        onboardingRoute: "/onboarding" as const,
        pendingAccountOnboardingToken: "pending-account-onboarding-token",
    };

    // Mock guard that injects user into request
    const mockJwtGuard = {
        canActivate: jest.fn((context) => {
            const req = context.switchToHttp().getRequest();
            req.user = { userId: mockUser.id, role: mockUser.role };
            return true;
        }),
    };

    // Mock kakao guard that injects kakao user into request
    const mockKakaoGuard = {
        canActivate: jest.fn((context) => {
            const req = context.switchToHttp().getRequest();
            if (typeof req.query?.error === "string") {
                req[KAKAO_OAUTH_ERROR_REQUEST_KEY] = req.query.error === "access_denied"
                    ? "OAUTH_CANCELLED"
                    : "OAUTH_PROVIDER_ERROR";
                return true;
            }
            req.user = mockKakaoUser;
            return true;
        }),
    };

    beforeEach(async () => {
        process.env = { ...OLD_ENV };
        const mockAuthService = {
            validateKakaoUser: jest.fn(),
            validateEmailPassword: jest.fn(),
            createAuthCode: jest.fn(),
            createPendingSignupCode: jest.fn(),
            createPendingAccountOnboardingCode: jest.fn(),
            startPendingAccountOnboarding: jest.fn(),
            exchangeCodeForTokens: jest.fn(),
            getPendingKakaoSignup: jest.fn(),
            completeKakaoOnboarding: jest.fn(),
            getPendingAccountOnboarding: jest.fn(),
            linkKakaoToAccount: jest.fn(),
            // Kakao OAuth state binding (login-CSRF protection). The callback
            // rejects with invalid_oauth_state unless verifyKakaoLoginState
            // resolves truthy; /auth/kakao mints the signed state + nonce.
            createKakaoLoginState: jest.fn().mockResolvedValue({ signedState: "signed-state-jwt", nonce: "nonce-123" }),
            verifyLinkingState: jest.fn().mockResolvedValue(null),
            verifyKakaoLoginState: jest.fn().mockResolvedValue({ client: "desktop" }),
        };

        const mockPrismaService = {
            user: {
                findUnique: jest.fn(),
                findFirst: jest.fn(),
                create: jest.fn(),
            },
        };
        const mockRateLimitGuard = {
            canActivate: jest.fn(async (_context: ExecutionContext) => true),
            resetForKey: jest.fn().mockResolvedValue(undefined),
        } satisfies jest.Mocked<Pick<RateLimitGuard, "canActivate" | "resetForKey">>;

        const moduleFixture: TestingModule = await Test.createTestingModule({
            controllers: [AuthController],
            providers: [
                {
                    provide: AuthService,
                    useValue: mockAuthService,
                },
                {
                    provide: PrismaService,
                    useValue: mockPrismaService,
                },
                {
                    provide: RateLimitGuard,
                    useValue: mockRateLimitGuard,
                },
                KakaoAuthGuard,
            ],
        })
            .overrideGuard(JwtGuard)
            .useValue(mockJwtGuard)
            .overrideGuard(KakaoAuthGuard)
            .useValue(mockKakaoGuard)
            .overrideGuard(RateLimitGuard)
            .useValue(mockRateLimitGuard)
            .compile();

        app = moduleFixture.createNestApplication();
        app.useGlobalPipes(new ValidationPipe({ transform: true }));
        await app.init();

        authService = moduleFixture.get(AuthService);
        prismaService = moduleFixture.get(PrismaService);
        rateLimitGuard = mockRateLimitGuard;
        authController = moduleFixture.get(AuthController);
    });

    afterEach(async () => {
        await app.close();
    });

    afterAll(() => {
        process.env = OLD_ENV;
    });

    // ============================================
    // GET /auth/kakao - Kakao Login Redirect
    // ============================================
    describe("GET /auth/kakao", () => {
        describe("given kakao guard passes", () => {
            it("mints signed state, sets the nonce cookie, and 302s to Kakao", async () => {
                process.env['NODE_ENV'] = "development";

                const response = await request(app.getHttpServer())
                    .get("/auth/kakao");

                // New behavior: bind the round-trip to this browser (login-CSRF)
                // — set the single-use nonce cookie, then redirect to Kakao.
                expect(response.status).toBe(302);
                expect(response.headers['location']).toContain("kauth.kakao.com/oauth/authorize");
                expect(authService.createKakaoLoginState).toHaveBeenCalled();
                expect(String(response.headers['set-cookie'] ?? "")).toContain("kakao_oauth_nonce=");
            });

            it("binds legacy logins to the signed legacy client", async () => {
                const response = await request(app.getHttpServer())
                    .get("/auth/kakao?client=legacy");

                expect(response.status).toBe(302);
                expect(authService.createKakaoLoginState).toHaveBeenCalledWith("legacy");
            });

            it("falls back to desktop for an unrecognized client", async () => {
                const response = await request(app.getHttpServer())
                    .get("/auth/kakao?client=https://attacker.example.com");

                expect(response.status).toBe(302);
                expect(authService.createKakaoLoginState).toHaveBeenCalledWith("desktop");
            });
        });
    });

    // ============================================
    // GET /auth/kakao/callback - Kakao OAuth Callback
    // ============================================
    describe("GET /auth/kakao/callback", () => {
        describe("given valid kakao user from guard", () => {
            it("should validate user and redirect with auth code", async () => {
                // Arrange
                const authCode = "generated-auth-code-123";
                const validationResult = {
                    user: mockUser.id,
                    ...mockTokens,
                };
                authService.validateKakaoUser.mockResolvedValue(validationResult);
                authService.createAuthCode.mockResolvedValue(authCode);

                // Set environment for test
                process.env['NODE_ENV'] = "development";
                process.env['DEVELOPMENT_FRONTEND_URL'] = "http://localhost:3000";

                // Act
                const response = await request(app.getHttpServer())
                    .get("/auth/kakao/callback?state=valid-login-state");

                // Assert
                expect(response.status).toBe(302); // Redirect
                expect(response.headers['location']).toContain(`/callback?code=${authCode}`);
                expect(authService.validateKakaoUser).toHaveBeenCalledWith(mockKakaoUser);
                expect(authService.createAuthCode).toHaveBeenCalledWith(validationResult);
            });

            it("should redirect new kakao users into onboarding flow", async () => {
                const pendingSignupCode = "pending-signup-code-123";
                authService.validateKakaoUser.mockResolvedValue({
                    onboardingRequired: true,
                    onboardingKind: "kakao_signup",
                    pendingSignupData: mockKakaoUser,
                });
                authService.createPendingSignupCode.mockResolvedValue(pendingSignupCode);

                process.env['NODE_ENV'] = "development";
                process.env['DEVELOPMENT_FRONTEND_URL'] = "http://localhost:3000";

                const response = await request(app.getHttpServer())
                    .get("/auth/kakao/callback?state=valid-login-state");

                expect(response.status).toBe(302);
                expect(response.headers['location']).toContain(`/callback?code=${pendingSignupCode}`);
                expect(authService.createPendingSignupCode).toHaveBeenCalledWith(mockKakaoUser);
                expect(authService.createAuthCode).not.toHaveBeenCalled();
            });

            it("should redirect incomplete existing users into account onboarding flow", async () => {
                const pendingOnboardingCode = "pending-onboarding-code-123";
                authService.validateKakaoUser.mockResolvedValue({
                    onboardingRequired: true,
                    onboardingKind: "account_completion",
                    userId: mockUser.id,
                    prefill: {
                        email: mockUser.email,
                        name: mockUser.name,
                    },
                });
                authService.createPendingAccountOnboardingCode.mockResolvedValue(pendingOnboardingCode);

                process.env['NODE_ENV'] = "development";
                process.env['DEVELOPMENT_FRONTEND_URL'] = "http://localhost:3000";

                const response = await request(app.getHttpServer())
                    .get("/auth/kakao/callback?state=valid-login-state");

                expect(response.status).toBe(302);
                expect(response.headers['location']).toContain(`/callback?code=${pendingOnboardingCode}`);
                expect(authService.createPendingAccountOnboardingCode).toHaveBeenCalledWith(mockUser.id);
                expect(authService.createPendingSignupCode).not.toHaveBeenCalled();
            });
        });

        describe("given production environment", () => {
            it("should redirect to production frontend URL", async () => {
                // Arrange
                const authCode = "prod-auth-code";
                authService.validateKakaoUser.mockResolvedValue({
                    user: mockUser.id,
                    ...mockTokens,
                });
                authService.createAuthCode.mockResolvedValue(authCode);

                process.env['NODE_ENV'] = "production";
                process.env['PRODUCTION_FRONTEND_URL'] = "https://app.example.com";

                // Act
                const response = await request(app.getHttpServer())
                    .get("/auth/kakao/callback?state=valid-login-state");

                // Assert
                expect(response.status).toBe(302);
                expect(response.headers['location']).toBe(`https://app.example.com/callback?code=${authCode}`);
            });

            it("returns a signed legacy login to the allowlisted legacy callback", async () => {
                const authCode = "legacy-auth-code";
                authService.verifyKakaoLoginState.mockResolvedValueOnce({ client: "legacy" });
                authService.validateKakaoUser.mockResolvedValue({
                    user: mockUser.id,
                    ...mockTokens,
                });
                authService.createAuthCode.mockResolvedValue(authCode);
                process.env['NODE_ENV'] = "production";

                const response = await request(app.getHttpServer())
                    .get("/auth/kakao/callback?state=valid-legacy-state");

                expect(response.status).toBe(302);
                expect(response.headers['location']).toBe(
                    `https://imirae-incheon-back-office.vercel.app/auth/callback?code=${authCode}`,
                );
            });
        });

        describe("given authService throws error", () => {
            it("redirects pending accounts to the login approval modal", async () => {
                authService.validateKakaoUser.mockRejectedValue(
                    new ForbiddenException({
                        code: "PENDING_APPROVAL",
                        message: "관리자 승인 대기 중입니다.",
                    }),
                );
                process.env['NODE_ENV'] = "development";
                process.env['DEVELOPMENT_FRONTEND_URL'] = "http://localhost:3000";

                const response = await request(app.getHttpServer())
                    .get("/auth/kakao/callback?state=valid-login-state");

                expect(response.status).toBe(302);
                expect(response.headers['location']).toBe(
                    "http://localhost:3000/login?authError=PENDING_APPROVAL",
                );
                expect(authService.createAuthCode).not.toHaveBeenCalled();
            });

            it("redirects rejected accounts to the login rejection modal", async () => {
                authService.validateKakaoUser.mockRejectedValue(
                    new ForbiddenException({
                        code: "ACCOUNT_REJECTED",
                        message: "가입이 거부되었습니다.",
                    }),
                );
                process.env['NODE_ENV'] = "development";
                process.env['DEVELOPMENT_FRONTEND_URL'] = "http://localhost:3000";

                const response = await request(app.getHttpServer())
                    .get("/auth/kakao/callback?state=valid-login-state");

                expect(response.status).toBe(302);
                expect(response.headers['location']).toBe(
                    "http://localhost:3000/login?authError=ACCOUNT_REJECTED",
                );
                expect(authService.createAuthCode).not.toHaveBeenCalled();
            });

            it("should propagate the error", async () => {
                // Arrange
                authService.validateKakaoUser.mockRejectedValue(
                    new UnauthorizedException("Kakao validation failed")
                );

                // Act
                const response = await request(app.getHttpServer())
                    .get("/auth/kakao/callback?state=valid-login-state");

                // Assert
                expect(response.status).toBe(401);
            });
        });

        describe("given missing or invalid OAuth state (login-CSRF guard)", () => {
            it("redirects to login with invalid_oauth_state when no state is present", async () => {
                process.env['NODE_ENV'] = "development";
                process.env['DEVELOPMENT_FRONTEND_URL'] = "http://localhost:3000";

                const response = await request(app.getHttpServer())
                    .get("/auth/kakao/callback");

                expect(response.status).toBe(302);
                expect(response.headers['location']).toBe("http://localhost:3000/login?authError=INVALID_OAUTH_STATE");
                expect(authService.validateKakaoUser).not.toHaveBeenCalled();
            });

            it("redirects to login with invalid_oauth_state when state verification fails", async () => {
                authService.verifyKakaoLoginState.mockResolvedValueOnce(null);
                process.env['NODE_ENV'] = "development";
                process.env['DEVELOPMENT_FRONTEND_URL'] = "http://localhost:3000";

                const response = await request(app.getHttpServer())
                    .get("/auth/kakao/callback?state=forged-or-expired");

                expect(response.status).toBe(302);
                expect(response.headers['location']).toBe("http://localhost:3000/login?authError=INVALID_OAUTH_STATE");
                expect(authService.validateKakaoUser).not.toHaveBeenCalled();
            });
        });

        describe("given Kakao returns an OAuth error", () => {
            beforeEach(() => {
                process.env['NODE_ENV'] = "development";
                process.env['DEVELOPMENT_FRONTEND_URL'] = "http://localhost:3000";
            });

            it("redirects user cancellation to the login modal after state verification", async () => {
                const response = await request(app.getHttpServer())
                    .get("/auth/kakao/callback?state=valid-login-state&error=access_denied");

                expect(response.status).toBe(302);
                expect(response.headers['location']).toBe(
                    "http://localhost:3000/login?authError=OAUTH_CANCELLED",
                );
                expect(authService.validateKakaoUser).not.toHaveBeenCalled();
            });

            it("redirects provider failures to a safe login error", async () => {
                const response = await request(app.getHttpServer())
                    .get("/auth/kakao/callback?state=valid-login-state&error=server_error");

                expect(response.status).toBe(302);
                expect(response.headers['location']).toBe(
                    "http://localhost:3000/login?authError=OAUTH_PROVIDER_ERROR",
                );
                expect(authService.validateKakaoUser).not.toHaveBeenCalled();
            });
        });

        describe("given the callback is for account linking", () => {
            beforeEach(() => {
                process.env['NODE_ENV'] = "development";
                process.env['DEVELOPMENT_FRONTEND_URL'] = "http://localhost:3000";
                authService.verifyLinkingState.mockResolvedValue({
                    userId: mockUser.id,
                    sessionId: "session-id",
                    purpose: "kakao_link",
                });
            });

            it("redirects successful links to the existing settings route", async () => {
                const response = await request(app.getHttpServer())
                    .get("/auth/kakao/callback?state=valid-linking-state");

                expect(response.status).toBe(302);
                expect(response.headers['location']).toBe(
                    "http://localhost:3000/settings?kakaoLinked=true",
                );
            });

            it("redirects cancelled links to a safe settings modal", async () => {
                const response = await request(app.getHttpServer())
                    .get("/auth/kakao/callback?state=valid-linking-state&error=access_denied");

                expect(response.status).toBe(302);
                expect(response.headers['location']).toBe(
                    "http://localhost:3000/settings?authError=OAUTH_CANCELLED",
                );
                expect(authService.linkKakaoToAccount).not.toHaveBeenCalled();
            });
        });
    });

    describe("POST /auth/login", () => {
        it("returns the stable approval error code for pending accounts", async () => {
            authService.validateEmailPassword.mockRejectedValue(
                new ForbiddenException({
                    code: "PENDING_APPROVAL",
                    message: "관리자 승인 대기 중입니다.",
                }),
            );

            const response = await request(app.getHttpServer())
                .post("/auth/login")
                .send({ email: "test@example.com", password: "Password1!" });

            expect(response.status).toBe(403);
            expect(response.body).toEqual({
                code: "PENDING_APPROVAL",
                message: "관리자 승인 대기 중입니다.",
            });
        });

        it("should reset the injected rate limiter on successful login", async () => {
            const validationResult = {
                user: mockUser.id,
                ...mockTokens,
            };
            authService.validateEmailPassword.mockResolvedValue(validationResult);

            const response = await request(app.getHttpServer())
                .post("/auth/login")
                .send({
                    email: "test@example.com",
                    password: "Password1!",
                });

            expect(response.status).toBe(201);
            expect(response.body).toEqual({
                success: true,
                ...validationResult,
            });
            expect(rateLimitGuard.resetForKey).toHaveBeenCalledWith(
                expect.any(String),
                "test@example.com",
                "post:login",
            );
        });

        it("should return pending onboarding payload for incomplete existing users", async () => {
            authService.validateEmailPassword.mockResolvedValue({
                onboardingRequired: true,
                onboardingKind: "account_completion",
                userId: mockUser.id,
                prefill: {
                    email: mockUser.email,
                    name: mockUser.name,
                },
            });
            authService.startPendingAccountOnboarding.mockResolvedValue("pending-account-token");

            const response = await request(app.getHttpServer())
                .post("/auth/login")
                .send({
                    email: "test@example.com",
                    password: "Password1!",
                });

            expect(response.status).toBe(201);
            expect(response.body).toEqual({
                success: true,
                onboardingRequired: true,
                onboardingRoute: "/onboarding",
                pendingAccountOnboardingToken: "pending-account-token",
            });
            expect(authService.startPendingAccountOnboarding).toHaveBeenCalledWith(mockUser.id);
        });
    });

    describe("auth enumeration and brute-force protection", () => {
        it("should not expose Kakao linkability from check-email", async () => {
            (prismaService.user.findUnique as jest.Mock).mockResolvedValue({ id: mockUser.id });

            const response = await authController.checkEmail("Test@Example.com");

            expect(response).toEqual({ exists: true });
            expect(response).not.toHaveProperty("linkable");
            expect(prismaService.user.findUnique).toHaveBeenCalledWith({
                where: { email: "test@example.com" },
                select: { id: true },
            });
        });

        it("should find an existing phone using normalized digits", async () => {
            (prismaService.user.findFirst as jest.Mock).mockResolvedValue({ id: mockUser.id });

            const response = await authController.checkPhone("01066211878");

            expect(response).toEqual({ exists: true });
            expect(prismaService.user.findFirst).toHaveBeenCalledWith({
                where: { phone: { in: ["01066211878", "010-6621-1878"] } },
                select: { id: true },
            });
        });

        it("should skip the user query for an invalid phone", async () => {
            const response = await authController.checkPhone("010-1234");

            expect(response).toEqual({ exists: false });
            expect(prismaService.user.findFirst).not.toHaveBeenCalled();
        });

        it.each([
            "completeKakaoOnboarding",
            "completeAccountOnboarding",
            "refreshToken",
            "resetPassword",
            "getAllActiveBranches",
            "checkPhone",
        ] as const)("should apply RateLimitGuard to %s", (methodName) => {
            const guards = Reflect.getMetadata(
                GUARDS_METADATA,
                AuthController.prototype[methodName],
            ) as unknown[] | undefined;

            expect(guards).toContain(RateLimitGuard);
        });
    });

    // ============================================
    // GET /auth/me - Get Current User
    // ============================================
    describe("GET /auth/me", () => {
        describe("given authenticated user exists", () => {
            it("should return current user info", async () => {
                // Arrange
                (prismaService.user.findUnique as jest.Mock).mockResolvedValue(mockUser);

                // Act
                const response = await request(app.getHttpServer())
                    .get("/auth/me");

                // Assert
                expect(response.status).toBe(200);
                expect(response.body).toEqual({
                    ...mockUser,
                    branchId: null,
                    branchName: null,
                    branchSlug: null,
                });
                expect(prismaService.user.findUnique).toHaveBeenCalledWith({
                    where: { id: mockUser.id },
                    select: {
                        id: true,
                        name: true,
                        email: true,
                        phone: true,
                        birthDate: true,
                        profileImage: true,
                        role: true,
                    },
                });
            });
        });

        describe("given user not found in database", () => {
            it("should return null", async () => {
                // Arrange
                (prismaService.user.findUnique as jest.Mock).mockResolvedValue(null);

                // Act
                const response = await request(app.getHttpServer())
                    .get("/auth/me");

                // Assert
                expect(response.status).toBe(200);
                expect(response.body).toEqual({
                    branchId: null,
                    branchName: null,
                    branchSlug: null,
                });
            });
        });

        describe("given different user roles", () => {
            it.each([
                { role: "user", name: "Regular User" },
                { role: "admin", name: "Admin User" },
                { role: "owner", name: "Owner User" },
            ])("should return user with role $role", async ({ role, name }) => {
                // Arrange
                const userWithRole = { ...mockUser, role, name };
                (prismaService.user.findUnique as jest.Mock).mockResolvedValue(userWithRole);

                // Act
                const response = await request(app.getHttpServer())
                    .get("/auth/me");

                // Assert
                expect(response.status).toBe(200);
                expect(response.body.role).toBe(role);
                expect(response.body.name).toBe(name);
            });
        });
    });

    // ============================================
    // POST /auth/token - Token Exchange
    // ============================================
    describe("POST /auth/token", () => {
        describe("given valid authorization code", () => {
            it("should exchange code for tokens", async () => {
                // Arrange
                const validCode = "valid-auth-code-123";
                authService.exchangeCodeForTokens.mockResolvedValue(mockTokens);

                // Act
                const response = await request(app.getHttpServer())
                    .post("/auth/token")
                    .send({ code: validCode });

                // Assert
                expect(response.status).toBe(201);
                expect(response.body).toEqual(mockTokens);
                expect(authService.exchangeCodeForTokens).toHaveBeenCalledWith(validCode);
            });

            it("should exchange onboarding code for pending signup payload", async () => {
                authService.exchangeCodeForTokens.mockResolvedValue(mockPendingSignup);

                const response = await request(app.getHttpServer())
                    .post("/auth/token")
                    .send({ code: "pending-code" });

                expect(response.status).toBe(201);
                expect(response.body).toEqual(mockPendingSignup);
            });
        });

        describe("given invalid authorization code", () => {
            it("should return 401 for non-existent code", async () => {
                // Arrange
                authService.exchangeCodeForTokens.mockRejectedValue(
                    new UnauthorizedException("Invalid authorization code")
                );

                // Act
                const response = await request(app.getHttpServer())
                    .post("/auth/token")
                    .send({ code: "invalid-code" });

                // Assert
                expect(response.status).toBe(401);
            });

            it("should return 401 for expired code", async () => {
                // Arrange
                authService.exchangeCodeForTokens.mockRejectedValue(
                    new UnauthorizedException("Authorization code expired")
                );

                // Act
                const response = await request(app.getHttpServer())
                    .post("/auth/token")
                    .send({ code: "expired-code" });

                // Assert
                expect(response.status).toBe(401);
            });
        });

        describe("given missing code in request body", () => {
            it("should return 400 for missing code", async () => {
                // Act
                const response = await request(app.getHttpServer())
                    .post("/auth/token")
                    .send({});

                // Assert
                expect(response.status).toBe(400);
            });

            it("should return 400 for empty code", async () => {
                // Act
                const response = await request(app.getHttpServer())
                    .post("/auth/token")
                    .send({ code: "" });

                // Assert
                expect(response.status).toBe(400);
            });
        });

        describe("given different code formats", () => {
            it.each([
                "short",
                "a".repeat(64),
                "code-with-dashes-123",
                "code_with_underscores_456",
            ])("should accept code format: %s", async (code) => {
                // Arrange
                authService.exchangeCodeForTokens.mockResolvedValue(mockTokens);

                // Act
                const response = await request(app.getHttpServer())
                    .post("/auth/token")
                    .send({ code });

                // Assert
                expect(response.status).toBe(201);
                expect(authService.exchangeCodeForTokens).toHaveBeenCalledWith(code);
            });
        });
    });


    describe("GET /auth/kakao/pending-signup", () => {
        it("should return pending signup prefill data", async () => {
            authService.getPendingKakaoSignup.mockResolvedValue(mockPendingSignup.prefill);

            const response = await request(app.getHttpServer())
                .get("/auth/kakao/pending-signup")
                .set("x-pending-signup-token", "pending-token");

            expect(response.status).toBe(200);
            expect(response.body).toEqual(mockPendingSignup.prefill);
            expect(authService.getPendingKakaoSignup).toHaveBeenCalledWith("pending-token");
        });

        it("should return 400 when token is missing", async () => {
            const response = await request(app.getHttpServer())
                .get("/auth/kakao/pending-signup");

            expect(response.status).toBe(400);
        });
    });

    describe("GET /auth/onboarding/pending", () => {
        it("should return pending account onboarding prefill data", async () => {
            authService.getPendingAccountOnboarding.mockResolvedValue({
                email: mockUser.email,
                name: mockUser.name,
                phone: "010-1234-5678",
                birthDate: "1990-01-01",
                branchId: "550e8400-e29b-41d4-a716-446655440000",
                role: "manager",
            });

            const response = await request(app.getHttpServer())
                .get("/auth/onboarding/pending")
                .set("x-pending-onboarding-token", "pending-onboarding-token");

            expect(response.status).toBe(200);
            expect(authService.getPendingAccountOnboarding).toHaveBeenCalledWith("pending-onboarding-token");
        });

        it("should return 400 when onboarding token is missing", async () => {
            const response = await request(app.getHttpServer())
                .get("/auth/onboarding/pending");

            expect(response.status).toBe(400);
        });
    });

    describe("POST /auth/kakao/complete-signup", () => {
        it("should complete kakao onboarding and return tokens", async () => {
            authService.completeKakaoOnboarding.mockResolvedValue({
                success: true,
                userId: mockUser.id,
                message: "관리자 승인 대기 중입니다.",
            });

            const response = await request(app.getHttpServer())
                .post("/auth/kakao/complete-signup")
                .set("x-pending-signup-token", "pending-token")
                .send({
                    phone: "010-1234-5678",
                    birthDate: "1990-01-01",
                    role: "user",
                });

            expect(response.status).toBe(201);
            expect(authService.completeKakaoOnboarding).toHaveBeenCalledWith(
                "pending-token",
                "010-1234-5678",
                "1990-01-01",
                "user",
            );
        });

        it("should return 400 when token is missing", async () => {
            const response = await request(app.getHttpServer())
                .post("/auth/kakao/complete-signup")
                .send({
                    phone: "010-1234-5678",
                    birthDate: "1990-01-01",
                    role: "user",
                });

            expect(response.status).toBe(400);
        });
    });

    describe("POST /auth/onboarding/complete", () => {
        it("should reject post-approval self-service profile and branch assignment", async () => {
            const response = await request(app.getHttpServer())
                .post("/auth/onboarding/complete")
                .set("x-pending-onboarding-token", "pending-onboarding-token")
                .send({
                    phone: "010-1234-5678",
                    birthDate: "1990-01-01",
                    branchId: "550e8400-e29b-41d4-a716-446655440000",
                    role: "manager",
                });

            expect(response.status).toBe(403);
            expect(response.body.code).toBe("ACCOUNT_PROFILE_INCOMPLETE");
        });

        it("should reject the endpoint even when the onboarding token is missing", async () => {
            const response = await request(app.getHttpServer())
                .post("/auth/onboarding/complete")
                .send({
                    phone: "010-1234-5678",
                    birthDate: "1990-01-01",
                    branchId: "550e8400-e29b-41d4-a716-446655440000",
                    role: "manager",
                });

            expect(response.status).toBe(403);
        });
    });

});
