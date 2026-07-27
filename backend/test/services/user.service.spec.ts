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
                update: jest.fn(),
            },
            branch: {
                findUnique: jest.fn().mockResolvedValue({ id: "branch-1" }),
                update: jest.fn().mockResolvedValue({ id: "branch-1" }),
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
