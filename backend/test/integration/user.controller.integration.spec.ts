import { Test, TestingModule } from "@nestjs/testing";
import { INestApplication, ValidationPipe } from "@nestjs/common";
import request from "supertest";
import { UserController } from "interface/controllers/user.controller";
import { UserService } from "application/services/user.service";
import { UserEntity } from "domain/entities/user.entity";
import { JwtGuard } from "infrastructure/auth/jwt.guard";
import { OwnerOrAdminGuard } from "infrastructure/auth/owner-or-admin.guard";
import { OwnerOnlyGuard } from "infrastructure/auth/owner-only.guard";

describe("UserController (Integration)", () => {
    // ============================================
    // Test Fixtures & Setup
    // ============================================

    let app: INestApplication;
    let userService: jest.Mocked<UserService>;

    const mockJwtGuard = {
        canActivate: jest.fn((context) => {
            const req = context.switchToHttp().getRequest();
            req.user = { userId: "owner-user-id", role: "owner" };
            return true;
        }),
    };

    const mockOwnerOrAdminGuard = {
        canActivate: jest.fn(() => true),
    };

    const mockOwnerOnlyGuard = {
        canActivate: jest.fn(() => true),
    };

    type UserOverrides = Partial<{
        id: string;
        kakaoId: string;
        email: string | null;
        name: string | null;
        profileImage: string | null;
        role: string | null;
        createdAt: Date;
    }>;

    const createMockUser = (overrides: UserOverrides = {}): UserEntity => {
        return UserEntity.reconstitute(
            overrides.id ?? "user-uuid-1",
            overrides.kakaoId ?? "kakao-123456",
            overrides.email ?? "test@example.com",
            overrides.name ?? "Test User",
            overrides.profileImage ?? "https://example.com/profile.jpg",
            overrides.role ?? "user",
            overrides.createdAt ?? new Date("2025-01-01"),
            null,
            false,
            null,
            overrides.kakaoId ? "kakao" : "email",
        );
    };

    beforeEach(async () => {
        const mockUserService = {
            create: jest.fn(),
            findDirectory: jest.fn(),
            findById: jest.fn(),
            findByKakaoId: jest.fn(),
            update: jest.fn(),
            delete: jest.fn(),
            approve: jest.fn(),
            reject: jest.fn(),
        };

        const moduleFixture: TestingModule = await Test.createTestingModule({
            controllers: [UserController],
            providers: [
                {
                    provide: UserService,
                    useValue: mockUserService,
                },
            ],
        })
            .overrideGuard(JwtGuard)
            .useValue(mockJwtGuard)
            .overrideGuard(OwnerOrAdminGuard)
            .useValue(mockOwnerOrAdminGuard)
            .overrideGuard(OwnerOnlyGuard)
            .useValue(mockOwnerOnlyGuard)
            .compile();

        app = moduleFixture.createNestApplication();
        app.useGlobalPipes(new ValidationPipe({ transform: true }));
        await app.init();

        userService = moduleFixture.get(UserService);
    });

    afterEach(async () => {
        await app.close();
    });

    // ============================================
    // GET /users - Directory
    // ============================================
    describe("GET /users", () => {
        it("should return the full directory for owner users", async () => {
            const users = [
                {
                    id: "directory-user-1",
                    kakaoId: "kakao-1",
                    email: "owner@example.com",
                    name: "Owner User",
                    phone: "010-1111-2222",
                    birthDate: "19900101",
                    profileImage: null,
                    role: "owner",
                    createdAt: new Date("2025-01-01"),
                    emailVerified: true,
                    authProvider: "both",
                    approvalStatus: "approved",
                    requestedRole: null,
                    branches: [{ id: "org-1", name: "본사", role: "owner" }],
                },
            ];
            userService.findDirectory.mockResolvedValue(users);

            const response = await request(app.getHttpServer()).get("/users");

            expect(response.status).toBe(200);
            expect(userService.findDirectory).toHaveBeenCalledWith({
                branchId: undefined,
                includeUnassigned: true,
            });
            expect(response.body).toHaveLength(1);
        });

        it("should scope directory by branch for owner users with a branch selected", async () => {
            mockJwtGuard.canActivate.mockImplementationOnce((context) => {
                const req = context.switchToHttp().getRequest();
                req.user = { userId: "owner-user-id", role: "owner", branchId: "org-owner-1" };
                return true;
            });
            userService.findDirectory.mockResolvedValue([]);

            const response = await request(app.getHttpServer()).get("/users");

            expect(response.status).toBe(200);
            expect(userService.findDirectory).toHaveBeenCalledWith({
                branchId: "org-owner-1",
                includeUnassigned: true,
            });
        });

        it("should scope directory by branch for admin users", async () => {
            mockJwtGuard.canActivate.mockImplementationOnce((context) => {
                const req = context.switchToHttp().getRequest();
                req.user = { userId: "admin-user-id", role: "admin", branchId: "org-admin-1" };
                return true;
            });
            userService.findDirectory.mockResolvedValue([]);

            const response = await request(app.getHttpServer()).get("/users");

            expect(response.status).toBe(200);
            expect(userService.findDirectory).toHaveBeenCalledWith({
                branchId: "org-admin-1",
                includeUnassigned: false,
            });
        });

        it("should reject admin directory requests without branch context", async () => {
            mockJwtGuard.canActivate.mockImplementationOnce((context) => {
                const req = context.switchToHttp().getRequest();
                req.user = { userId: "admin-user-id", role: "admin" };
                return true;
            });

            const response = await request(app.getHttpServer()).get("/users");

            expect(response.status).toBe(403);
            expect(userService.findDirectory).not.toHaveBeenCalled();
        });

        it("should forward the status query filter to the service", async () => {
            userService.findDirectory.mockResolvedValue([]);

            const response = await request(app.getHttpServer())
                .get("/users")
                .query({ status: "pending" });

            expect(response.status).toBe(200);
            expect(userService.findDirectory).toHaveBeenCalledWith({
                branchId: undefined,
                includeUnassigned: true,
                status: "pending",
            });
        });
    });

    // ============================================
    // POST /users - Create
    // ============================================
    describe("POST /users", () => {
        describe("given valid user data with all fields", () => {
            it("should create a new user and return 201", async () => {
                // Arrange
                const createDto = {
                    kakaoId: "kakao-999888",
                    name: "New User",
                    email: "newuser@example.com",
                    profileImage: "https://example.com/new-profile.jpg",
                };
                const createdUser = createMockUser({
                    id: "new-user-uuid",
                    ...createDto,
                });
                userService.create.mockResolvedValue(createdUser);

                // Act
                const response = await request(app.getHttpServer())
                    .post("/users")
                    .send(createDto);

                // Assert
                expect(response.status).toBe(201);
                expect(userService.create).toHaveBeenCalledWith(
                    expect.objectContaining({
                        kakaoId: "kakao-999888",
                        name: "New User",
                        email: "newuser@example.com",
                    }),
                );
            });
        });

        describe("given minimal user data (only kakaoId)", () => {
            it("should create user with optional fields as undefined", async () => {
                // Arrange
                const createDto = {
                    kakaoId: "kakao-minimal",
                };
                const createdUser = createMockUser({
                    id: "minimal-user-uuid",
                    kakaoId: "kakao-minimal",
                    name: null,
                    email: null,
                    profileImage: null,
                });
                userService.create.mockResolvedValue(createdUser);

                // Act
                const response = await request(app.getHttpServer())
                    .post("/users")
                    .send(createDto);

                // Assert
                expect(response.status).toBe(201);
                expect(userService.create).toHaveBeenCalledWith(
                    expect.objectContaining({
                        kakaoId: "kakao-minimal",
                    }),
                );
            });
        });
    });

    // ============================================
    // GET /users/id - Find By ID
    // ============================================
    describe("GET /users/id", () => {
        describe("given user exists", () => {
            it("should return the user", async () => {
                // Arrange
                const user = createMockUser({
                    id: "specific-user-uuid",
                    name: "Specific User",
                });
                userService.findById.mockResolvedValue(user);

                // Act
                const response = await request(app.getHttpServer())
                    .get("/users/id")
                    .query({ id: "specific-user-uuid" });

                // Assert
                expect(response.status).toBe(200);
                expect(userService.findById).toHaveBeenCalledWith("specific-user-uuid");
            });
        });

        describe("given user does not exist", () => {
            it("should return null from service", async () => {
                // Arrange
                userService.findById.mockResolvedValue(null);

                // Act
                const response = await request(app.getHttpServer())
                    .get("/users/id")
                    .query({ id: "non-existent-uuid" });

                // Assert
                expect(response.status).toBe(200);
                expect(userService.findById).toHaveBeenCalledWith("non-existent-uuid");
            });
        });
    });

    // ============================================
    // GET /users/kakao - Find By Kakao ID
    // ============================================
    describe("GET /users/kakao", () => {
        describe("given user with kakaoId exists", () => {
            it("should return the user", async () => {
                // Arrange
                const user = createMockUser({
                    id: "kakao-linked-user",
                    kakaoId: "kakao-777666",
                });
                userService.findByKakaoId.mockResolvedValue(user);

                // Act
                const response = await request(app.getHttpServer())
                    .get("/users/kakao")
                    .query({ kakaoId: "kakao-777666" });

                // Assert
                expect(response.status).toBe(200);
                expect(userService.findByKakaoId).toHaveBeenCalledWith("kakao-777666");
            });
        });

        describe("given no user with kakaoId exists", () => {
            it("should return null from service", async () => {
                // Arrange
                userService.findByKakaoId.mockResolvedValue(null);

                // Act
                const response = await request(app.getHttpServer())
                    .get("/users/kakao")
                    .query({ kakaoId: "kakao-nonexistent" });

                // Assert
                expect(response.status).toBe(200);
                expect(userService.findByKakaoId).toHaveBeenCalledWith("kakao-nonexistent");
            });
        });

        describe("given different kakaoId formats", () => {
            it.each([
                "12345678",
                "kakao_user_123",
                "long-kakao-id-with-many-characters",
            ])("should find user with kakaoId %s", async (kakaoId) => {
                // Arrange
                const user = createMockUser({ kakaoId });
                userService.findByKakaoId.mockResolvedValue(user);

                // Act
                const response = await request(app.getHttpServer())
                    .get("/users/kakao")
                    .query({ kakaoId });

                // Assert
                expect(response.status).toBe(200);
                expect(userService.findByKakaoId).toHaveBeenCalledWith(kakaoId);
            });
        });
    });

    // ============================================
    // PATCH /users - Update
    // ============================================
    describe("PATCH /users", () => {
        describe("given valid update data", () => {
            it("should update the user", async () => {
                // Arrange
                const updateDto = {
                    name: "Updated Name",
                    email: "updated@example.com",
                };
                const updatedUser = createMockUser({
                    id: "user-to-update",
                    ...updateDto,
                });
                userService.update.mockResolvedValue(updatedUser);

                // Act
                const response = await request(app.getHttpServer())
                    .patch("/users")
                    .query({ id: "user-to-update" })
                    .send(updateDto);

                // Assert
                expect(response.status).toBe(200);
                expect(userService.update).toHaveBeenCalledWith(
                    "user-to-update",
                    expect.objectContaining({
                        name: "Updated Name",
                        email: "updated@example.com",
                    }),
                );
            });
        });

        describe("given profile image update", () => {
            it("should update profileImage", async () => {
                // Arrange
                const updateDto = {
                    profileImage: "https://new-image.com/profile.png",
                };
                const updatedUser = createMockUser({
                    id: "user-with-new-image",
                    profileImage: updateDto.profileImage,
                });
                userService.update.mockResolvedValue(updatedUser);

                // Act
                const response = await request(app.getHttpServer())
                    .patch("/users")
                    .query({ id: "user-with-new-image" })
                    .send(updateDto);

                // Assert
                expect(response.status).toBe(200);
                expect(userService.update).toHaveBeenCalledWith(
                    "user-with-new-image",
                    expect.objectContaining({
                        profileImage: "https://new-image.com/profile.png",
                    }),
                );
            });
        });

        describe("given role update", () => {
            it("should reject role 'admin' at the validation layer (지점장 is appointment-only)", async () => {
                // Arrange
                const updateDto = { role: "admin" };

                // Act
                const response = await request(app.getHttpServer())
                    .patch("/users")
                    .query({ id: "promoted-user" })
                    .send(updateDto);

                // Assert
                expect(response.status).toBe(400);
                expect(userService.update).not.toHaveBeenCalled();
            });

            it("should update user role to manager", async () => {
                // Arrange
                const updateDto = { role: "manager" };
                const updatedUser = createMockUser({
                    id: "manager-user",
                    role: "manager",
                });
                userService.update.mockResolvedValue(updatedUser);

                // Act
                const response = await request(app.getHttpServer())
                    .patch("/users")
                    .query({ id: "manager-user" })
                    .send(updateDto);

                // Assert
                expect(response.status).toBe(200);
                expect(userService.update).toHaveBeenCalledWith(
                    "manager-user",
                    expect.objectContaining({
                        role: "manager",
                    }),
                );
            });

            it("should allow setting role to null", async () => {
                // Arrange
                const updateDto = { role: null };
                const updatedUser = createMockUser({
                    id: "demoted-user",
                    role: null,
                });
                userService.update.mockResolvedValue(updatedUser);

                // Act
                const response = await request(app.getHttpServer())
                    .patch("/users")
                    .query({ id: "demoted-user" })
                    .send(updateDto);

                // Assert
                expect(response.status).toBe(200);
                expect(userService.update).toHaveBeenCalledWith(
                    "demoted-user",
                    expect.objectContaining({
                        role: null,
                    }),
                );
            });

            it("should reject role 'owner' at the validation layer", async () => {
                // Arrange
                const updateDto = { role: "owner" };

                // Act
                const response = await request(app.getHttpServer())
                    .patch("/users")
                    .query({ id: "escalating-user" })
                    .send(updateDto);

                // Assert
                expect(response.status).toBe(400);
                expect(userService.update).not.toHaveBeenCalled();
            });

            it("should thread the caller's role from the JWT into the update params", async () => {
                // Arrange (default mock caller is owner)
                const updateDto = { role: "manager" };
                const updatedUser = createMockUser({ id: "promoted-by-owner", role: "manager" });
                userService.update.mockResolvedValue(updatedUser);

                // Act
                const response = await request(app.getHttpServer())
                    .patch("/users")
                    .query({ id: "promoted-by-owner" })
                    .send(updateDto);

                // Assert
                expect(response.status).toBe(200);
                expect(userService.update).toHaveBeenCalledWith(
                    "promoted-by-owner",
                    expect.objectContaining({
                        role: "manager",
                        callerRole: "owner",
                    }),
                );
            });

            it("should keep the legacy query update wrapper owner-only", async () => {
                const updateDto = { role: "manager" };
                userService.update.mockResolvedValue(createMockUser({ id: "target-user", role: "manager" }));

                // Act
                const response = await request(app.getHttpServer())
                    .patch("/users")
                    .query({ id: "target-user" })
                    .send(updateDto);

                // Assert
                expect(response.status).toBe(200);
                expect(userService.update).toHaveBeenCalledWith(
                    "target-user",
                    expect.objectContaining({
                        role: "manager",
                        callerRole: "owner",
                    }),
                );
            });
        });

        describe("given partial update", () => {
            it("should only update provided fields", async () => {
                // Arrange
                const partialDto = { name: "Only Name Updated" };
                const updatedUser = createMockUser({
                    id: "partial-update-user",
                    name: "Only Name Updated",
                });
                userService.update.mockResolvedValue(updatedUser);

                // Act
                const response = await request(app.getHttpServer())
                    .patch("/users")
                    .query({ id: "partial-update-user" })
                    .send(partialDto);

                // Assert
                expect(response.status).toBe(200);
                expect(userService.update).toHaveBeenCalledWith(
                    "partial-update-user",
                    expect.objectContaining({
                        name: "Only Name Updated",
                    }),
                );
            });
        });
    });

    // ============================================
    // DELETE /users - Delete
    // ============================================
    describe("DELETE /users", () => {
        describe("given valid user id", () => {
            it("should delete the user", async () => {
                // Arrange
                userService.delete.mockResolvedValue(undefined);

                // Act
                const response = await request(app.getHttpServer())
                    .delete("/users")
                    .query({ id: "user-to-delete" });

                // Assert
                expect(response.status).toBe(200);
                expect(userService.delete).toHaveBeenCalledWith("user-to-delete");
            });
        });

        describe("given different user ids", () => {
            it.each([
                "uuid-1234-5678",
                "short-id",
                "very-long-uuid-string-for-testing-purposes",
            ])("should delete user with id %s", async (id) => {
                // Arrange
                userService.delete.mockResolvedValue(undefined);

                // Act
                const response = await request(app.getHttpServer())
                    .delete("/users")
                    .query({ id });

                // Assert
                expect(response.status).toBe(200);
                expect(userService.delete).toHaveBeenCalledWith(id);
            });
        });
    });

    // ============================================
    // POST /users/:id/approve
    // ============================================
    describe("POST /users/:id/approve", () => {
        describe("given a valid approval by the owner", () => {
            it("should approve the user with the owner-selected branch and role", async () => {
                // Arrange
                const summary = {
                    id: "pending-user-1",
                    name: "Pending User",
                    email: "pending@example.com",
                    role: "admin",
                    approvalStatus: "approved",
                    approvedAt: new Date("2026-07-13"),
                    approvedBy: "owner-user-id",
                    requestedRole: "admin",
                    tokenVersion: 1,
                };
                userService.approve.mockResolvedValue(summary);

                // Act
                const response = await request(app.getHttpServer())
                    .post("/users/pending-user-1/approve")
                    .send({
                        role: "admin",
                        branchId: "22222222-2222-4222-8222-222222222222",
                        ownerBranchId: "33333333-3333-4333-8333-333333333333",
                    });

                // Assert
                expect(response.status).toBe(201);
                expect(userService.approve).toHaveBeenCalledWith("pending-user-1", {
                    role: "admin",
                    branchId: "22222222-2222-4222-8222-222222222222",
                    ownerBranchId: "33333333-3333-4333-8333-333333333333",
                    approvedBy: "owner-user-id",
                });
            });

            it("should pass branchId through when provided", async () => {
                // Arrange
                userService.approve.mockResolvedValue({
                    id: "pending-user-1",
                    name: "Pending User",
                    email: "pending@example.com",
                    role: "manager",
                    approvalStatus: "approved",
                    approvedAt: new Date("2026-07-13"),
                    approvedBy: "owner-user-id",
                    requestedRole: "manager",
                    tokenVersion: 1,
                });
                const branchId = "22222222-2222-4222-8222-222222222222";

                // Act
                await request(app.getHttpServer())
                    .post("/users/pending-user-1/approve")
                    .send({ role: "manager", branchId });

                // Assert
                expect(userService.approve).toHaveBeenCalledWith("pending-user-1", {
                    role: "manager",
                    branchId,
                    approvedBy: "owner-user-id",
                });
            });
        });

        describe("given an invalid role", () => {
            it("should reject role 'owner' at the validation layer", async () => {
                // Act
                const response = await request(app.getHttpServer())
                    .post("/users/pending-user-1/approve")
                    .send({ role: "owner" });

                // Assert
                expect(response.status).toBe(400);
                expect(userService.approve).not.toHaveBeenCalled();
            });

            it("should require a role to be provided", async () => {
                // Act
                const response = await request(app.getHttpServer())
                    .post("/users/pending-user-1/approve")
                    .send({});

                // Assert
                expect(response.status).toBe(400);
                expect(userService.approve).not.toHaveBeenCalled();
            });

            it("should require a branch to be provided", async () => {
                const response = await request(app.getHttpServer())
                    .post("/users/pending-user-1/approve")
                    .send({ role: "user" });

                expect(response.status).toBe(400);
                expect(userService.approve).not.toHaveBeenCalled();
            });

            it("should reject a non-UUID branchId", async () => {
                // Act
                const response = await request(app.getHttpServer())
                    .post("/users/pending-user-1/approve")
                    .send({ role: "admin", branchId: "not-a-uuid" });

                // Assert
                expect(response.status).toBe(400);
                expect(userService.approve).not.toHaveBeenCalled();
            });

            it("should require ownerBranchId when approving role 'admin' (지점장 임명 지점 필수)", async () => {
                // Act
                const response = await request(app.getHttpServer())
                    .post("/users/pending-user-1/approve")
                    .send({ role: "admin", branchId: "22222222-2222-4222-8222-222222222222" });

                // Assert
                expect(response.status).toBe(400);
                expect(userService.approve).not.toHaveBeenCalled();
            });
        });

        describe("given a non-owner caller", () => {
            it("should deny access", async () => {
                // Arrange
                mockOwnerOnlyGuard.canActivate.mockImplementationOnce(() => false);

                // Act
                const response = await request(app.getHttpServer())
                    .post("/users/pending-user-1/approve")
                    .send({ role: "admin" });

                // Assert
                expect(response.status).toBe(403);
                expect(userService.approve).not.toHaveBeenCalled();
            });
        });
    });

    // ============================================
    // POST /users/:id/reject
    // ============================================
    describe("POST /users/:id/reject", () => {
        it("should reject the pending user", async () => {
            // Arrange
            const summary = {
                id: "pending-user-1",
                name: "Pending User",
                email: "pending@example.com",
                role: null,
                approvalStatus: "rejected",
                approvedAt: null,
                approvedBy: null,
                requestedRole: "admin",
                tokenVersion: 1,
            };
            userService.reject.mockResolvedValue(summary);

            // Act
            const response = await request(app.getHttpServer()).post("/users/pending-user-1/reject");

            // Assert
            expect(response.status).toBe(201);
            expect(userService.reject).toHaveBeenCalledWith("pending-user-1");
        });

        describe("given a non-owner caller", () => {
            it("should deny access", async () => {
                // Arrange
                mockOwnerOnlyGuard.canActivate.mockImplementationOnce(() => false);

                // Act
                const response = await request(app.getHttpServer()).post("/users/pending-user-1/reject");

                // Assert
                expect(response.status).toBe(403);
                expect(userService.reject).not.toHaveBeenCalled();
            });
        });
    });
});
