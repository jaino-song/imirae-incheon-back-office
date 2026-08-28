import { ConflictException } from "@nestjs/common";
import { UserService } from "../../application/services/user.service";
import {
    CreateUserUsecase,
    FindUserByIdUsecase,
    FindUserByKakaoIdUsecase,
    UpdateUserUsecase,
    DeleteUserUsecase,
} from "../../application/usecases/user";
import { PrismaService } from "../../infrastructure/database/prisma.service";

describe("UserService", () => {
    // ============================================
    // Test Fixtures & Setup
    // ============================================

    const createMockUsecase = () => ({ execute: jest.fn() });

    const createMockPrismaService = () => {
        const prisma = {
            user: {
                findMany: jest.fn().mockResolvedValue([]),
                findUnique: jest.fn(),
                update: jest.fn(),
            },
            branch: {
                findMany: jest.fn().mockResolvedValue([]),
                findUnique: jest.fn().mockResolvedValue({ id: "branch-1" }),
                update: jest.fn().mockResolvedValue({ id: "branch-1" }),
                updateMany: jest.fn().mockResolvedValue({ count: 0 }),
            },
            user_branch: {
                upsert: jest.fn().mockResolvedValue({ id: "membership-1" }),
                deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
            },
            auth_session: {
                updateMany: jest.fn().mockResolvedValue({ count: 1 }),
            },
            $transaction: jest.fn(),
        };
        prisma.$transaction.mockImplementation(async (callback) => callback(prisma));
        return prisma;
    };

    let service: UserService;
    let createUserUsecase: ReturnType<typeof createMockUsecase>;
    let findUserByIdUsecase: ReturnType<typeof createMockUsecase>;
    let findUserByKakaoIdUsecase: ReturnType<typeof createMockUsecase>;
    let updateUserUsecase: ReturnType<typeof createMockUsecase>;
    let deleteUserUsecase: ReturnType<typeof createMockUsecase>;
    let prismaService: ReturnType<typeof createMockPrismaService>;

    beforeEach(() => {
        createUserUsecase = createMockUsecase();
        findUserByIdUsecase = createMockUsecase();
        findUserByKakaoIdUsecase = createMockUsecase();
        updateUserUsecase = createMockUsecase();
        deleteUserUsecase = createMockUsecase();
        prismaService = createMockPrismaService();

        service = new UserService(
            createUserUsecase as unknown as CreateUserUsecase,
            findUserByIdUsecase as unknown as FindUserByIdUsecase,
            findUserByKakaoIdUsecase as unknown as FindUserByKakaoIdUsecase,
            updateUserUsecase as unknown as UpdateUserUsecase,
            deleteUserUsecase as unknown as DeleteUserUsecase,
            prismaService as unknown as PrismaService,
        );
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    // ============================================
    // findDirectory
    // ============================================
    describe("findDirectory", () => {
        it("should query without a where clause when no filters are provided", async () => {
            await service.findDirectory();

            expect(prismaService.user.findMany).toHaveBeenCalledWith(
                expect.objectContaining({ where: undefined }),
            );
        });

        it("should filter by approvalStatus when status is provided", async () => {
            await service.findDirectory({ status: "pending" });

            expect(prismaService.user.findMany).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: { approvalStatus: "pending" },
                }),
            );
        });

        it("should combine branchId and status filters", async () => {
            await service.findDirectory({ branchId: "branch-1", status: "approved" });

            expect(prismaService.user.findMany).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: expect.objectContaining({
                        approvalStatus: "approved",
                        OR: expect.any(Array),
                    }),
                }),
            );
        });

        it("should widen the branch filter to also match branch-less users when includeUnassigned is set (owner path)", async () => {
            await service.findDirectory({ branchId: "branch-1", includeUnassigned: true });

            expect(prismaService.user.findMany).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: expect.objectContaining({
                        OR: [
                            { userBranches: { some: { branchId: "branch-1" } } },
                            { ownedBranches: { some: { id: "branch-1" } } },
                            { userBranches: { none: {} }, ownedBranches: { none: {} } },
                        ],
                    }),
                }),
            );
        });

        it("should keep the branch filter scoped to exactly the branch when includeUnassigned is not set (admin path, unchanged)", async () => {
            await service.findDirectory({ branchId: "branch-1" });

            expect(prismaService.user.findMany).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: expect.objectContaining({
                        OR: [
                            { userBranches: { some: { branchId: "branch-1" } } },
                            { ownedBranches: { some: { id: "branch-1" } } },
                        ],
                    }),
                }),
            );
        });

        it("should apply no branch filter at all when includeUnassigned is set without a branchId (owner with no branch selected)", async () => {
            await service.findDirectory({ includeUnassigned: true });

            expect(prismaService.user.findMany).toHaveBeenCalledWith(
                expect.objectContaining({ where: undefined }),
            );
        });

        it("should keep applying the status filter alongside the widened owner branch filter", async () => {
            await service.findDirectory({ branchId: "branch-1", status: "pending", includeUnassigned: true });

            expect(prismaService.user.findMany).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: expect.objectContaining({
                        approvalStatus: "pending",
                        OR: [
                            { userBranches: { some: { branchId: "branch-1" } } },
                            { ownedBranches: { some: { id: "branch-1" } } },
                            { userBranches: { none: {} }, ownedBranches: { none: {} } },
                        ],
                    }),
                }),
            );
        });

        it("should include approvalStatus and requestedRole in the mapped result", async () => {
            prismaService.user.findMany.mockResolvedValue([
                {
                    id: "u1",
                    kakaoId: null,
                    email: "a@example.com",
                    name: "A",
                    phone: null,
                    birthDate: null,
                    profileImage: null,
                    role: null,
                    createdAt: new Date("2025-01-01"),
                    emailVerified: false,
                    authProvider: "email",
                    approvalStatus: "pending",
                    requestedRole: "admin",
                    ownedBranches: [],
                    userBranches: [],
                },
            ]);

            const result = await service.findDirectory();

            expect(result[0]).toEqual(
                expect.objectContaining({
                    approvalStatus: "pending",
                    requestedRole: "admin",
                }),
            );
        });

        it("should select approvalStatus and requestedRole from prisma", async () => {
            await service.findDirectory();

            expect(prismaService.user.findMany).toHaveBeenCalledWith(
                expect.objectContaining({
                    select: expect.objectContaining({
                        approvalStatus: true,
                        requestedRole: true,
                    }),
                }),
            );
        });

        it("should map branch roles from each user's membership without manager ownership overriding them", async () => {
            const sharedFields = {
                kakaoId: null,
                phone: "010-1234-5678",
                birthDate: null,
                profileImage: null,
                createdAt: new Date("2026-07-27"),
                emailVerified: true,
                authProvider: "email",
                approvalStatus: "approved",
                requestedRole: null,
            };

            prismaService.user.findMany.mockResolvedValue([
                {
                    ...sharedFields,
                    id: "owner-user-id",
                    email: "owner@example.com",
                    name: "송진호",
                    role: "owner",
                    ownedBranches: [],
                    userBranches: [
                        {
                            role: "admin",
                            branch: { id: "owner-branch-id", name: "인천 아이미래로" },
                        },
                    ],
                },
                {
                    ...sharedFields,
                    id: "manager-user-id",
                    email: "manager@example.com",
                    name: "송진호",
                    role: "admin",
                    ownedBranches: [
                        { id: "manager-branch-id", name: "인천 서구점" },
                    ],
                    userBranches: [
                        {
                            role: "admin",
                            branch: { id: "manager-branch-id", name: "인천 서구점" },
                        },
                    ],
                },
            ]);

            const result = await service.findDirectory();

            expect(result).toEqual([
                expect.objectContaining({
                    id: "owner-user-id",
                    branches: [
                        expect.objectContaining({
                            id: "owner-branch-id",
                            role: "owner",
                        }),
                    ],
                }),
                expect.objectContaining({
                    id: "manager-user-id",
                    branches: [
                        expect.objectContaining({
                            id: "manager-branch-id",
                            role: "admin",
                        }),
                    ],
                }),
            ]);
        });
    });

    // ============================================
    // updateAccountAssignment
    // ============================================
    describe("updateAccountAssignment", () => {
        const branchIds: [string, string] = [
            "11111111-1111-4111-8111-111111111111",
            "22222222-2222-4222-8222-222222222222",
        ];

        type AssignmentParams = Parameters<UserService["updateAccountAssignment"]>[1];

        const membership = (
            branchId: string,
            role: string = "admin",
            isActive: boolean = true,
        ) => ({
            branchId,
            role,
            branch: { isActive },
        });

        const approvedTarget = (overrides: Record<string, unknown> = {}) => ({
            id: "u1",
            name: "A",
            email: "a@example.com",
            role: "admin",
            approvalStatus: "approved",
            approvedAt: new Date("2026-07-13"),
            approvedBy: "owner-1",
            requestedRole: "admin",
            tokenVersion: 1,
            ownedBranches: [{ id: branchIds[0], isActive: true }],
            userBranches: branchIds.map((branchId) => membership(branchId)),
            ...overrides,
        });

        const assignmentParams = (
            overrides: Partial<AssignmentParams> = {},
        ): AssignmentParams => ({
            role: "manager",
            branchIds: [...branchIds],
            expectedRole: "admin",
            expectedBranchIds: [...branchIds],
            callerRole: "owner",
            ...overrides,
        });

        const expectNoAssignmentWrites = () => {
            expect(prismaService.branch.updateMany).not.toHaveBeenCalled();
            expect(prismaService.user.update).not.toHaveBeenCalled();
            expect(prismaService.user_branch.deleteMany).not.toHaveBeenCalled();
            expect(prismaService.user_branch.upsert).not.toHaveBeenCalled();
            expect(prismaService.auth_session.updateMany).not.toHaveBeenCalled();
        };

        beforeEach(() => {
            prismaService.user.findUnique.mockResolvedValue(approvedTarget());
            prismaService.branch.findMany.mockResolvedValue(
                branchIds.map((id) => ({ id })),
            );
            prismaService.user.update.mockResolvedValue({
                id: "u1",
                name: "A",
                email: "a@example.com",
                role: "manager",
                approvalStatus: "approved",
                approvedAt: new Date("2026-07-13"),
                approvedBy: "owner-1",
                requestedRole: "manager",
                tokenVersion: 2,
            });
        });

        it("replaces the exact branch membership set and demotes retained branch roles, then revokes active sessions", async () => {
            const result = await service.updateAccountAssignment(
                "u1",
                assignmentParams(),
            );

            expect(prismaService.$transaction).toHaveBeenCalledWith(
                expect.any(Function),
                { isolationLevel: "Serializable" },
            );
            expect(prismaService.branch.findMany).toHaveBeenCalledWith({
                where: {
                    id: { in: branchIds },
                    isActive: true,
                },
                select: { id: true },
            });
            expect(prismaService.branch.updateMany).toHaveBeenCalledWith({
                where: { ownerId: "u1" },
                data: { ownerId: null },
            });
            expect(prismaService.user.update).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: { id: "u1" },
                    data: {
                        role: "manager",
                        tokenVersion: { increment: 1 },
                    },
                }),
            );
            expect(prismaService.user_branch.deleteMany).toHaveBeenCalledWith({
                where: {
                    userId: "u1",
                    branchId: { notIn: branchIds },
                },
            });
            expect(prismaService.user_branch.upsert).toHaveBeenCalledTimes(2);
            expect(prismaService.user_branch.upsert).toHaveBeenNthCalledWith(1, {
                where: {
                    userId_branchId: { userId: "u1", branchId: branchIds[0] },
                },
                update: { role: "manager" },
                create: { userId: "u1", branchId: branchIds[0], role: "manager" },
            });
            expect(prismaService.user_branch.upsert).toHaveBeenNthCalledWith(2, {
                where: {
                    userId_branchId: { userId: "u1", branchId: branchIds[1] },
                },
                update: { role: "manager" },
                create: { userId: "u1", branchId: branchIds[1], role: "manager" },
            });
            expect(prismaService.auth_session.updateMany).toHaveBeenCalledWith({
                where: { userId: "u1", revokedAt: null },
                data: {
                    revokedAt: expect.any(Date),
                    revokedReason: "account_assignment_changed",
                },
            });
            expect(result).toEqual(expect.objectContaining({
                id: "u1",
                role: "manager",
                tokenVersion: 2,
            }));
        });

        it("returns 409 without writes when the expected role is stale", async () => {
            prismaService.user.findUnique.mockResolvedValue(approvedTarget({
                role: "manager",
                ownedBranches: [],
                userBranches: [membership(branchIds[0], "manager")],
            }));

            const error = await service.updateAccountAssignment(
                "u1",
                assignmentParams({
                    role: "manager",
                    branchIds: [branchIds[0]],
                    expectedRole: "user",
                    expectedBranchIds: [branchIds[0]],
                }),
            ).catch((caught: unknown) => caught);

            expect(error).toBeInstanceOf(ConflictException);
            expect((error as ConflictException).getStatus()).toBe(409);
            expect(prismaService.branch.findMany).not.toHaveBeenCalled();
            expectNoAssignmentWrites();
        });

        it("returns 409 without writes when the expected branch set is stale", async () => {
            prismaService.user.findUnique.mockResolvedValue(approvedTarget({
                role: "manager",
                ownedBranches: [],
                userBranches: [membership(branchIds[0], "manager")],
            }));

            const error = await service.updateAccountAssignment(
                "u1",
                assignmentParams({
                    role: "manager",
                    branchIds: [branchIds[0]],
                    expectedRole: "manager",
                    expectedBranchIds: [branchIds[1]],
                }),
            ).catch((caught: unknown) => caught);

            expect(error).toBeInstanceOf(ConflictException);
            expect((error as ConflictException).getStatus()).toBe(409);
            expect(prismaService.branch.findMany).not.toHaveBeenCalled();
            expectNoAssignmentWrites();
        });

        it("returns the current summary without writes or session revocation for an exact semantic no-op", async () => {
            prismaService.user.findUnique.mockResolvedValue(approvedTarget({
                role: "manager",
                ownedBranches: [],
                userBranches: [membership(branchIds[0], "manager")],
            }));
            prismaService.branch.findMany.mockResolvedValue([{ id: branchIds[0] }]);

            const result = await service.updateAccountAssignment(
                "u1",
                assignmentParams({
                    role: "manager",
                    branchIds: [branchIds[0]],
                    expectedRole: "manager",
                    expectedBranchIds: [branchIds[0]],
                }),
            );

            expect(result).toEqual(expect.objectContaining({
                id: "u1",
                role: "manager",
                tokenVersion: 1,
            }));
            expectNoAssignmentWrites();
        });

        it("retries a serializable write conflict and then returns the successful result", async () => {
            prismaService.user.findUnique.mockResolvedValue(approvedTarget({
                role: "manager",
                ownedBranches: [],
                userBranches: [membership(branchIds[0], "manager")],
            }));
            prismaService.branch.findMany.mockResolvedValue([{ id: branchIds[0] }]);
            prismaService.$transaction
                .mockRejectedValueOnce({ code: "P2034" })
                .mockImplementationOnce(async (callback) => callback(prismaService));

            const result = await service.updateAccountAssignment(
                "u1",
                assignmentParams({
                    role: "manager",
                    branchIds: [branchIds[0]],
                    expectedRole: "manager",
                    expectedBranchIds: [branchIds[0]],
                }),
            );

            expect(prismaService.$transaction).toHaveBeenCalledTimes(2);
            expect(result).toEqual(expect.objectContaining({
                id: "u1",
                role: "manager",
                tokenVersion: 1,
            }));
            expectNoAssignmentWrites();
        });

        it("maps an exhausted serializable write conflict to 409 without durable residue", async () => {
            prismaService.$transaction.mockRejectedValue({ code: "P2034" });

            const error = await service.updateAccountAssignment(
                "u1",
                assignmentParams(),
            ).catch((caught: unknown) => caught);

            expect(error).toBeInstanceOf(ConflictException);
            expect((error as ConflictException).getStatus()).toBe(409);
            expect(prismaService.$transaction).toHaveBeenCalledTimes(3);
            expect(prismaService.user.findUnique).not.toHaveBeenCalled();
            expect(prismaService.branch.findMany).not.toHaveBeenCalled();
            expectNoAssignmentWrites();
        });

        it("does not retry a non-conflict database failure", async () => {
            const databaseError = Object.assign(new Error("database unavailable"), {
                code: "P1001",
            });
            prismaService.$transaction.mockRejectedValue(databaseError);

            await expect(service.updateAccountAssignment(
                "u1",
                assignmentParams(),
            )).rejects.toBe(databaseError);

            expect(prismaService.$transaction).toHaveBeenCalledTimes(1);
            expectNoAssignmentWrites();
        });

        it("refuses an unknown or inactive non-owned branch before any durable write", async () => {
            prismaService.user.findUnique.mockResolvedValue(approvedTarget({
                userBranches: [membership(branchIds[0])],
            }));
            prismaService.branch.findMany.mockResolvedValue([{ id: branchIds[0] }]);

            await expect(service.updateAccountAssignment(
                "u1",
                assignmentParams({
                    role: "admin",
                    branchIds,
                    expectedBranchIds: [branchIds[0]],
                }),
            )).rejects.toThrow("유효하지 않은 지점입니다.");

            expectNoAssignmentWrites();
        });

        it("preserves an existing inactive membership while applying the selected role", async () => {
            const inactiveMembershipBranchId = "33333333-3333-4333-8333-333333333333";
            prismaService.user.findUnique.mockResolvedValue(approvedTarget({
                role: "manager",
                ownedBranches: [],
                userBranches: [
                    membership(branchIds[0], "manager"),
                    membership(inactiveMembershipBranchId, "manager", false),
                ],
            }));
            prismaService.branch.findMany.mockResolvedValue([{ id: branchIds[0] }]);

            await service.updateAccountAssignment(
                "u1",
                assignmentParams({
                    role: "user",
                    branchIds: [branchIds[0], inactiveMembershipBranchId],
                    expectedRole: "manager",
                    expectedBranchIds: [branchIds[0], inactiveMembershipBranchId],
                }),
            );

            expect(prismaService.branch.findMany).toHaveBeenCalledWith({
                where: {
                    id: { in: [branchIds[0]] },
                    isActive: true,
                },
                select: { id: true },
            });
            expect(prismaService.user_branch.deleteMany).toHaveBeenCalledWith({
                where: {
                    userId: "u1",
                    branchId: {
                        notIn: [branchIds[0], inactiveMembershipBranchId],
                    },
                },
            });
            expect(prismaService.user_branch.upsert).toHaveBeenCalledWith({
                where: {
                    userId_branchId: {
                        userId: "u1",
                        branchId: inactiveMembershipBranchId,
                    },
                },
                update: { role: "user" },
                create: {
                    userId: "u1",
                    branchId: inactiveMembershipBranchId,
                    role: "user",
                },
            });
        });

        it("preserves an omitted inactive owned branch while adding an active branch", async () => {
            const inactiveOwnedBranchId = "33333333-3333-4333-8333-333333333333";
            prismaService.user.findUnique.mockResolvedValue(approvedTarget({
                ownedBranches: [{ id: inactiveOwnedBranchId, isActive: false }],
                userBranches: [membership(inactiveOwnedBranchId, "admin", false)],
            }));
            prismaService.branch.findMany.mockResolvedValue([{ id: branchIds[0] }]);
            prismaService.user.update.mockResolvedValue({
                id: "u1",
                name: "A",
                email: "a@example.com",
                role: "admin",
                approvalStatus: "approved",
                approvedAt: new Date("2026-07-13"),
                approvedBy: "owner-1",
                requestedRole: "admin",
                tokenVersion: 2,
            });

            await service.updateAccountAssignment(
                "u1",
                assignmentParams({
                    role: "admin",
                    branchIds: [branchIds[0]],
                    expectedBranchIds: [inactiveOwnedBranchId],
                }),
            );

            expect(prismaService.branch.findMany).toHaveBeenCalledWith({
                where: {
                    id: { in: [branchIds[0]] },
                    isActive: true,
                },
                select: { id: true },
            });
            expect(prismaService.branch.updateMany).not.toHaveBeenCalled();
            expect(prismaService.user_branch.deleteMany).toHaveBeenCalledWith({
                where: {
                    userId: "u1",
                    branchId: {
                        notIn: [branchIds[0], inactiveOwnedBranchId],
                    },
                },
            });
            expect(prismaService.user_branch.upsert).toHaveBeenCalledTimes(2);
            expect(prismaService.user_branch.upsert).toHaveBeenNthCalledWith(1, {
                where: {
                    userId_branchId: { userId: "u1", branchId: branchIds[0] },
                },
                update: { role: "admin" },
                create: { userId: "u1", branchId: branchIds[0], role: "admin" },
            });
            expect(prismaService.user_branch.upsert).toHaveBeenNthCalledWith(2, {
                where: {
                    userId_branchId: { userId: "u1", branchId: inactiveOwnedBranchId },
                },
                update: { role: "admin" },
                create: { userId: "u1", branchId: inactiveOwnedBranchId, role: "admin" },
            });
        });

        it("refuses an inactive-owned-only admin membership set before any durable write", async () => {
            const inactiveOwnedBranchId = "33333333-3333-4333-8333-333333333333";
            prismaService.user.findUnique.mockResolvedValue(approvedTarget({
                ownedBranches: [{ id: inactiveOwnedBranchId, isActive: false }],
                userBranches: [membership(inactiveOwnedBranchId, "admin", false)],
            }));

            await expect(service.updateAccountAssignment(
                "u1",
                assignmentParams({
                    role: "admin",
                    branchIds: [inactiveOwnedBranchId],
                    expectedBranchIds: [inactiveOwnedBranchId],
                }),
            )).rejects.toThrow("하나 이상의 활성 지점을 선택해야 합니다.");

            expect(prismaService.branch.findMany).not.toHaveBeenCalled();
            expect(prismaService.branch.updateMany).not.toHaveBeenCalled();
            expect(prismaService.user.update).not.toHaveBeenCalled();
            expect(prismaService.user_branch.deleteMany).not.toHaveBeenCalled();
            expect(prismaService.user_branch.upsert).not.toHaveBeenCalled();
            expect(prismaService.auth_session.updateMany).not.toHaveBeenCalled();
        });

        it("drops an omitted inactive owned membership when demoting an admin", async () => {
            const inactiveOwnedBranchId = "33333333-3333-4333-8333-333333333333";
            prismaService.user.findUnique.mockResolvedValue(approvedTarget({
                ownedBranches: [{ id: inactiveOwnedBranchId, isActive: false }],
                userBranches: [membership(inactiveOwnedBranchId, "admin", false)],
            }));
            prismaService.branch.findMany.mockResolvedValue([{ id: branchIds[0] }]);

            await service.updateAccountAssignment(
                "u1",
                assignmentParams({
                    role: "manager",
                    branchIds: [branchIds[0]],
                    expectedBranchIds: [inactiveOwnedBranchId],
                }),
            );

            expect(prismaService.branch.updateMany).toHaveBeenCalledWith({
                where: { ownerId: "u1" },
                data: { ownerId: null },
            });
            expect(prismaService.user_branch.deleteMany).toHaveBeenCalledWith({
                where: {
                    userId: "u1",
                    branchId: { notIn: [branchIds[0]] },
                },
            });
            expect(prismaService.user_branch.upsert).toHaveBeenCalledTimes(1);
            expect(prismaService.user_branch.upsert).not.toHaveBeenCalledWith(
                expect.objectContaining({
                    where: {
                        userId_branchId: {
                            userId: "u1",
                            branchId: inactiveOwnedBranchId,
                        },
                    },
                }),
            );
        });

        it("preserves an existing admin while changing memberships without clearing branch ownership", async () => {
            prismaService.user.findUnique.mockResolvedValue(approvedTarget({
                userBranches: [membership(branchIds[0])],
            }));
            prismaService.user.update.mockResolvedValue({
                id: "u1",
                name: "A",
                email: "a@example.com",
                role: "admin",
                approvalStatus: "approved",
                approvedAt: new Date("2026-07-13"),
                approvedBy: "owner-1",
                requestedRole: "admin",
                tokenVersion: 2,
            });

            await service.updateAccountAssignment(
                "u1",
                assignmentParams({
                    role: "admin",
                    branchIds,
                    expectedBranchIds: [branchIds[0]],
                }),
            );

            expect(prismaService.branch.updateMany).not.toHaveBeenCalled();
            expect(prismaService.user.update).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: { id: "u1" },
                    data: {
                        role: "admin",
                        tokenVersion: { increment: 1 },
                    },
                }),
            );
            expect(prismaService.user_branch.upsert).toHaveBeenCalledWith(
                expect.objectContaining({
                    update: { role: "admin" },
                    create: expect.objectContaining({ role: "admin" }),
                }),
            );
        });

        it("refuses escalating a non-admin target to admin before any durable write", async () => {
            prismaService.user.findUnique.mockResolvedValue(approvedTarget({
                id: "manager-target",
                role: "manager",
                ownedBranches: [],
                userBranches: [membership(branchIds[0], "manager")],
            }));

            await expect(service.updateAccountAssignment(
                "manager-target",
                assignmentParams({
                    role: "admin",
                    branchIds: [branchIds[0]],
                    expectedRole: "manager",
                    expectedBranchIds: [branchIds[0]],
                }),
            )).rejects.toThrow("기존 지점장 계정에서만 유지할 수 있습니다.");

            expect(prismaService.branch.findMany).not.toHaveBeenCalled();
            expect(prismaService.branch.updateMany).not.toHaveBeenCalled();
            expect(prismaService.user.update).not.toHaveBeenCalled();
            expect(prismaService.user_branch.deleteMany).not.toHaveBeenCalled();
            expect(prismaService.user_branch.upsert).not.toHaveBeenCalled();
            expect(prismaService.auth_session.updateMany).not.toHaveBeenCalled();
        });

        it("refuses removing an owned branch while retaining admin before any durable write", async () => {
            prismaService.user.findUnique.mockResolvedValue(approvedTarget({
                id: "admin-target",
                ownedBranches: branchIds.map((branchId) => ({
                    id: branchId,
                    isActive: true,
                })),
            }));

            await expect(service.updateAccountAssignment(
                "admin-target",
                assignmentParams({
                    role: "admin",
                    branchIds: [branchIds[0]],
                }),
            )).rejects.toThrow("담당 지점을 모두 포함해야 합니다.");

            expect(prismaService.branch.findMany).not.toHaveBeenCalled();
            expect(prismaService.branch.updateMany).not.toHaveBeenCalled();
            expect(prismaService.user.update).not.toHaveBeenCalled();
            expect(prismaService.user_branch.deleteMany).not.toHaveBeenCalled();
            expect(prismaService.user_branch.upsert).not.toHaveBeenCalled();
            expect(prismaService.auth_session.updateMany).not.toHaveBeenCalled();
        });

        it("refuses owner targets before any branch lookup or durable write", async () => {
            prismaService.user.findUnique.mockResolvedValue(approvedTarget({
                id: "owner-target",
                role: "owner",
                ownedBranches: [],
            }));

            await expect(service.updateAccountAssignment(
                "owner-target",
                assignmentParams({
                    role: "user",
                    branchIds: [branchIds[0]],
                }),
            )).rejects.toThrow("오너 계정의 역할은 변경할 수 없습니다.");

            expect(prismaService.branch.findMany).not.toHaveBeenCalled();
            expect(prismaService.branch.updateMany).not.toHaveBeenCalled();
            expect(prismaService.user.update).not.toHaveBeenCalled();
            expect(prismaService.user_branch.deleteMany).not.toHaveBeenCalled();
            expect(prismaService.user_branch.upsert).not.toHaveBeenCalled();
            expect(prismaService.auth_session.updateMany).not.toHaveBeenCalled();
        });

        it("refuses non-approved targets before any branch lookup or durable write", async () => {
            prismaService.user.findUnique.mockResolvedValue(approvedTarget({
                id: "pending-target",
                role: null,
                approvalStatus: "pending",
                ownedBranches: [],
            }));

            await expect(service.updateAccountAssignment(
                "pending-target",
                assignmentParams({
                    role: "user",
                    branchIds: [branchIds[0]],
                }),
            )).rejects.toThrow("승인된 계정만 수정할 수 있습니다.");

            expect(prismaService.branch.findMany).not.toHaveBeenCalled();
            expect(prismaService.branch.updateMany).not.toHaveBeenCalled();
            expect(prismaService.user.update).not.toHaveBeenCalled();
            expect(prismaService.user_branch.deleteMany).not.toHaveBeenCalled();
            expect(prismaService.user_branch.upsert).not.toHaveBeenCalled();
            expect(prismaService.auth_session.updateMany).not.toHaveBeenCalled();
        });

        it("refuses a non-owner caller before opening a transaction", async () => {
            await expect(service.updateAccountAssignment(
                "u1",
                assignmentParams({
                    role: "user",
                    branchIds: [branchIds[0]],
                    callerRole: "admin",
                }),
            )).rejects.toThrow("계정 수정은 소유자만 가능합니다.");

            expect(prismaService.$transaction).not.toHaveBeenCalled();
            expect(prismaService.user.findUnique).not.toHaveBeenCalled();
        });
    });

    // ============================================
    // approve
    // ============================================
    describe("approve", () => {
        it("should approve a user in a single transaction, assigning role, approval metadata, and bumping tokenVersion", async () => {
            prismaService.user.update.mockResolvedValue({
                id: "u1",
                name: "A",
                email: "a@example.com",
                role: "admin",
                approvalStatus: "approved",
                approvedAt: new Date("2026-07-13"),
                approvedBy: "owner-1",
                requestedRole: "admin",
                tokenVersion: 1,
            });

            const result = await service.approve("u1", {
                role: "admin",
                approvedBy: "owner-1",
                branchId: "branch-1",
                ownerBranchId: "branch-1",
            });

            expect(prismaService.$transaction).toHaveBeenCalledTimes(1);
            expect(prismaService.user.update).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: { id: "u1" },
                    data: expect.objectContaining({
                        approvalStatus: "approved",
                        approvedBy: "owner-1",
                        role: "admin",
                        tokenVersion: { increment: 1 },
                    }),
                }),
            );
            expect(result.approvalStatus).toBe("approved");
            expect(result.approvedBy).toBe("owner-1");
            expect(result.role).toBe("admin");
            expect(result.tokenVersion).toBe(1);
        });

        it("should create or update the selected branch membership", async () => {
            prismaService.user.update.mockResolvedValue({
                id: "u1",
                approvalStatus: "approved",
                tokenVersion: 1,
            });
            prismaService.branch.findUnique.mockResolvedValue({ id: "branch-9" });

            await service.approve("u1", { role: "manager", approvedBy: "owner-1", branchId: "branch-9" });

            expect(prismaService.user_branch.upsert).toHaveBeenCalledWith({
                where: {
                    userId_branchId: { userId: "u1", branchId: "branch-9" },
                },
                update: { role: "manager" },
                create: { userId: "u1", branchId: "branch-9", role: "manager" },
            });
            expect(prismaService.user_branch.deleteMany).toHaveBeenCalledWith({
                where: {
                    userId: "u1",
                    role: null,
                    branchId: { not: "branch-9" },
                },
            });
        });

        it("should reject approval when the selected branch does not exist", async () => {
            prismaService.branch.findUnique.mockResolvedValue(null);

            await expect(service.approve("u1", {
                role: "manager",
                approvedBy: "owner-1",
                branchId: "missing-branch",
            })).rejects.toThrow("유효하지 않은 지점입니다.");

            expect(prismaService.user.update).not.toHaveBeenCalled();
            expect(prismaService.user_branch.upsert).not.toHaveBeenCalled();
        });

        it("should assign branch ownership when approving role 'admin' with an ownerBranchId on a vacant branch", async () => {
            prismaService.branch.findUnique.mockImplementation(({ where }: { where: { id: string } }) => {
                if (where.id === "branch-1") return Promise.resolve({ id: "branch-1" });
                if (where.id === "owner-branch-1") {
                    return Promise.resolve({ id: "owner-branch-1", ownerId: null });
                }
                return Promise.resolve(null);
            });
            prismaService.user.update.mockResolvedValue({
                id: "u1",
                approvalStatus: "approved",
                role: "admin",
                tokenVersion: 1,
            });

            await service.approve("u1", {
                role: "admin",
                approvedBy: "owner-1",
                branchId: "branch-1",
                ownerBranchId: "owner-branch-1",
            });

            expect(prismaService.branch.update).toHaveBeenCalledWith({
                where: { id: "owner-branch-1" },
                data: { ownerId: "u1" },
            });
            expect(prismaService.user_branch.upsert).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: {
                        userId_branchId: { userId: "u1", branchId: "owner-branch-1" },
                    },
                    update: { role: "admin" },
                    create: { userId: "u1", branchId: "owner-branch-1", role: "admin" },
                }),
            );
        });

        it("should reject approving role 'admin' when the ownerBranchId already has an owner", async () => {
            prismaService.branch.findUnique.mockImplementation(({ where }: { where: { id: string } }) => {
                if (where.id === "branch-1") return Promise.resolve({ id: "branch-1" });
                if (where.id === "owner-branch-1") {
                    return Promise.resolve({ id: "owner-branch-1", ownerId: "existing-owner" });
                }
                return Promise.resolve(null);
            });

            await expect(service.approve("u1", {
                role: "admin",
                approvedBy: "owner-1",
                branchId: "branch-1",
                ownerBranchId: "owner-branch-1",
            })).rejects.toThrow("이미 지점장이 있는 지점입니다.");

            expect(prismaService.user.update).not.toHaveBeenCalled();
            expect(prismaService.branch.update).not.toHaveBeenCalled();
        });

        it("should reject approving role 'admin' without an ownerBranchId", async () => {
            await expect(service.approve("u1", {
                role: "admin",
                approvedBy: "owner-1",
                branchId: "branch-1",
            })).rejects.toThrow("지점장 승인은 임명할 지점이 필요합니다.");

            expect(prismaService.user.update).not.toHaveBeenCalled();
            expect(prismaService.branch.update).not.toHaveBeenCalled();
        });

        it.each(["manager", "user"])(
            "should approve role '%s' without an ownerBranchId and without touching branch ownership",
            async (role) => {
                prismaService.user.update.mockResolvedValue({
                    id: "u1",
                    approvalStatus: "approved",
                    role,
                    tokenVersion: 1,
                });

                await service.approve("u1", {
                    role,
                    approvedBy: "owner-1",
                    branchId: "branch-1",
                });

                expect(prismaService.branch.update).not.toHaveBeenCalled();
            },
        );
    });

    // ============================================
    // reject
    // ============================================
    describe("reject", () => {
        it("should set approvalStatus to rejected and bump tokenVersion", async () => {
            prismaService.user.update.mockResolvedValue({
                id: "u1",
                approvalStatus: "rejected",
                tokenVersion: 1,
            });

            const result = await service.reject("u1");

            expect(prismaService.user.update).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: { id: "u1" },
                    data: expect.objectContaining({
                        approvalStatus: "rejected",
                        tokenVersion: { increment: 1 },
                    }),
                }),
            );
            expect(result.approvalStatus).toBe("rejected");
        });
    });
});
