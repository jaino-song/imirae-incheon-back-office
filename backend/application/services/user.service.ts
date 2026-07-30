import { BadRequestException, ConflictException, Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import {
    CreateUserUsecase,
    FindUserByIdUsecase,
    FindUserByKakaoIdUsecase,
    UpdateUserUsecase,
    DeleteUserUsecase,
} from "application/usecases/user";
import { UserEntity } from "domain/entities/user.entity";
import { PrismaService } from "infrastructure/database/prisma.service";

export interface UserDirectoryBranch {
    id: string;
    name: string;
    role: string | null;
}

export interface UserDirectoryItem {
    id: string;
    kakaoId: string | null;
    email: string | null;
    name: string | null;
    phone: string | null;
    birthDate: string | null;
    profileImage: string | null;
    role: string | null;
    createdAt: Date;
    emailVerified: boolean;
    authProvider: string;
    approvalStatus: string;
    requestedRole: string | null;
    branches: UserDirectoryBranch[];
}

export interface UserApprovalSummary {
    id: string;
    name: string | null;
    email: string | null;
    role: string | null;
    approvalStatus: string;
    approvedAt: Date | null;
    approvedBy: string | null;
    requestedRole: string | null;
    tokenVersion: number;
}

@Injectable()
export class UserService {
    constructor(
        private readonly createUserUsecase: CreateUserUsecase,
        private readonly findUserByIdUsecase: FindUserByIdUsecase,
        private readonly findUserByKakaoIdUsecase: FindUserByKakaoIdUsecase,
        private readonly updateUserUsecase: UpdateUserUsecase,
        private readonly deleteUserUsecase: DeleteUserUsecase,
        private readonly prismaService: PrismaService,
    ) {}

    create(params: { kakaoId: string, name?: string, email?: string, profileImage?: string }): Promise<UserEntity> {
        return this.createUserUsecase.execute(params.kakaoId, params.name, params.email, params.profileImage);
    }

    findById(id: string, branchId?: string): Promise<UserEntity | null> {
        return this.findUserByIdUsecase.execute(id, branchId);
    }

    findByKakaoId(kakaoId: string): Promise<UserEntity | null> {
        return this.findUserByKakaoIdUsecase.execute(kakaoId);
    }

    update(id: string, params: {
        name?: string;
        email?: string;
        profileImage?: string;
        role?: string | null;
        branchRole?: string;
        callerRole?: string;
        branchId?: string;
    }): Promise<UserEntity> {
        return this.updateUserUsecase.execute(id, params);
    }

    async findDirectory(params?: { branchId?: string, status?: string, includeUnassigned?: boolean }): Promise<UserDirectoryItem[]> {
        const where: Prisma.userWhereInput = {};

        if (params?.branchId) {
            const scopes: Prisma.userWhereInput[] = [
                { userBranches: { some: { branchId: params.branchId } } },
                { ownedBranches: { some: { id: params.branchId } } },
            ];
            if (params.includeUnassigned) {
                // Pending sign-ups have no branch membership until an approver assigns one
                // (ApproveUserDto.branchId), so scoping them away would make approval impossible.
                scopes.push({ userBranches: { none: {} }, ownedBranches: { none: {} } });
            }
            where.OR = scopes;
        }

        if (params?.status) {
            where.approvalStatus = params.status;
        }

        const users = await this.prismaService.user.findMany({
            where: Object.keys(where).length > 0 ? where : undefined,
            orderBy: { createdAt: "desc" },
            select: {
                id: true,
                kakaoId: true,
                email: true,
                name: true,
                phone: true,
                birthDate: true,
                profileImage: true,
                role: true,
                createdAt: true,
                emailVerified: true,
                authProvider: true,
                approvalStatus: true,
                requestedRole: true,
                userBranches: {
                    orderBy: { joinedAt: "asc" },
                    select: {
                        role: true,
                        branch: {
                            select: {
                                id: true,
                                name: true,
                            },
                        },
                    },
                },
            },
        });

        return users.map((user) => {
            const branches = user.userBranches.map((membership) => ({
                id: membership.branch.id,
                name: membership.branch.name,
                role: user.role === "owner" ? "owner" : membership.role ?? null,
            }));

            return {
                id: user.id,
                kakaoId: user.kakaoId,
                email: user.email,
                name: user.name,
                phone: user.phone,
                birthDate: user.birthDate,
                profileImage: user.profileImage,
                role: user.role,
                createdAt: user.createdAt,
                emailVerified: user.emailVerified,
                authProvider: user.authProvider,
                approvalStatus: user.approvalStatus,
                requestedRole: user.requestedRole,
                branches,
            };
        });
    }

    delete(id: string, branchId?: string) {
        return this.deleteUserUsecase.execute(id, branchId);
    }

    approve(
        id: string,
        params: { role: string, approvedBy: string, branchId: string, ownerBranchId?: string },
    ): Promise<UserApprovalSummary> {
        return this.prismaService.$transaction(async (tx) => {
            const branch = await tx.branch.findUnique({
                where: { id: params.branchId },
                select: { id: true },
            });
            if (!branch) {
                throw new BadRequestException("유효하지 않은 지점입니다.");
            }

            if (params.role === "admin") {
                if (!params.ownerBranchId) {
                    throw new BadRequestException("지점장 승인은 임명할 지점이 필요합니다.");
                }

                const ownerBranch = await tx.branch.findUnique({
                    where: { id: params.ownerBranchId },
                    select: { id: true, ownerId: true },
                });
                if (!ownerBranch) {
                    throw new BadRequestException("유효하지 않은 지점입니다.");
                }
                if (ownerBranch.ownerId) {
                    throw new ConflictException("이미 지점장이 있는 지점입니다.");
                }
            }

            const user = await tx.user.update({
                where: { id },
                data: {
                    approvalStatus: "approved",
                    approvedAt: new Date(),
                    approvedBy: params.approvedBy,
                    role: params.role,
                    tokenVersion: { increment: 1 },
                },
                select: {
                    id: true,
                    name: true,
                    email: true,
                    role: true,
                    approvalStatus: true,
                    approvedAt: true,
                    approvedBy: true,
                    requestedRole: true,
                    tokenVersion: true,
                },
            });

            await tx.user_branch.deleteMany({
                where: {
                    userId: id,
                    role: null,
                    branchId: { not: params.branchId },
                },
            });
            await tx.user_branch.upsert({
                where: {
                    userId_branchId: { userId: id, branchId: params.branchId },
                },
                update: { role: params.role },
                create: {
                    userId: id,
                    branchId: params.branchId,
                    role: params.role,
                },
            });
            if (params.role === "admin" && params.ownerBranchId) {
                await tx.branch.update({
                    where: { id: params.ownerBranchId },
                    data: { ownerId: id },
                });
                await tx.user_branch.upsert({
                    where: {
                        userId_branchId: { userId: id, branchId: params.ownerBranchId },
                    },
                    update: { role: "admin" },
                    create: {
                        userId: id,
                        branchId: params.ownerBranchId,
                        role: "admin",
                    },
                });
            }

            await tx.auth_session.updateMany({
                where: { userId: id, revokedAt: null },
                data: {
                    revokedAt: new Date(),
                    revokedReason: "approval_changed",
                },
            });

            return user;
        });
    }

    reject(id: string): Promise<UserApprovalSummary> {
        return this.prismaService.$transaction(async (tx) => {
            const user = await tx.user.update({
                where: { id },
                data: {
                    approvalStatus: "rejected",
                    tokenVersion: { increment: 1 },
                },
                select: {
                    id: true,
                    name: true,
                    email: true,
                    role: true,
                    approvalStatus: true,
                    approvedAt: true,
                    approvedBy: true,
                    requestedRole: true,
                    tokenVersion: true,
                },
            });
            await tx.auth_session.updateMany({
                where: { userId: id, revokedAt: null },
                data: {
                    revokedAt: new Date(),
                    revokedReason: "approval_rejected",
                },
            });
            return user;
        });
    }
}
