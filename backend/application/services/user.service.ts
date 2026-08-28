import {
    BadRequestException,
    ConflictException,
    ForbiddenException,
    Injectable,
    NotFoundException,
} from "@nestjs/common";
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

const MAX_ACCOUNT_ASSIGNMENT_TRANSACTION_ATTEMPTS = 3;

type AccountAssignmentRole = "admin" | "manager" | "user";

/** Higher ranks grant every lower branch privilege as well. */
const ACCOUNT_ASSIGNMENT_ROLE_RANK: Readonly<Record<AccountAssignmentRole, number>> = {
    user: 0,
    manager: 1,
    admin: 2,
};

function getAccountAssignmentRoleRank(role: string | null | undefined): number | undefined {
    if (!role) {
        return undefined;
    }

    return ACCOUNT_ASSIGNMENT_ROLE_RANK[role as AccountAssignmentRole];
}

function isAccountAssignmentRoleDemotion(
    currentGlobalRole: string | null | undefined,
    selectedGlobalRole: AccountAssignmentRole,
): boolean {
    const currentGlobalRoleRank = getAccountAssignmentRoleRank(currentGlobalRole);
    return currentGlobalRoleRank !== undefined
        && ACCOUNT_ASSIGNMENT_ROLE_RANK[selectedGlobalRole] < currentGlobalRoleRank;
}

function getRetainedMembershipRole(
    currentRole: string | null | undefined,
    currentGlobalRole: string | null | undefined,
    selectedGlobalRole: AccountAssignmentRole,
): string {
    // A role ceiling applies only when the owner explicitly lowers the global
    // role. Same-role edits and promotions preserve deliberate branch roles.
    if (isAccountAssignmentRoleDemotion(currentGlobalRole, selectedGlobalRole)) {
        const currentRoleRank = getAccountAssignmentRoleRank(currentRole);
        if (
            currentRoleRank === undefined
            || currentRoleRank > ACCOUNT_ASSIGNMENT_ROLE_RANK[selectedGlobalRole]
        ) {
            return selectedGlobalRole;
        }
    }

    return currentRole ?? selectedGlobalRole;
}

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

    async updateAccountAssignment(
        id: string,
        params: {
            role: "admin" | "manager" | "user";
            branchIds: string[];
            expectedRole: "admin" | "manager" | "user";
            expectedBranchIds: string[];
            callerRole: string;
        },
    ): Promise<UserApprovalSummary> {
        if (params.callerRole !== "owner") {
            throw new ForbiddenException("계정 수정은 소유자만 가능합니다.");
        }
        if (
            !Array.isArray(params.branchIds)
            || params.branchIds.length === 0
            || new Set(params.branchIds).size !== params.branchIds.length
        ) {
            throw new BadRequestException("하나 이상의 유효한 지점을 선택해야 합니다.");
        }
        if (
            !Array.isArray(params.expectedBranchIds)
            || new Set(params.expectedBranchIds).size !== params.expectedBranchIds.length
        ) {
            throw new BadRequestException("예상 지점 정보가 유효하지 않습니다.");
        }

        const runTransaction = () => this.prismaService.$transaction(async (tx) => {
            const target = await tx.user.findUnique({
                where: { id },
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
                    ownedBranches: {
                        select: {
                            id: true,
                            isActive: true,
                        },
                    },
                    userBranches: {
                        select: {
                            branchId: true,
                            role: true,
                            branch: {
                                select: { isActive: true },
                            },
                        },
                    },
                },
            });
            if (!target) {
                throw new NotFoundException("User not found");
            }
            if (target.role === "owner") {
                throw new ForbiddenException("오너 계정의 역할은 변경할 수 없습니다.");
            }
            if (target.approvalStatus !== "approved") {
                throw new BadRequestException("승인된 계정만 수정할 수 있습니다.");
            }
            if (getAccountAssignmentRoleRank(target.role) === undefined) {
                throw new ConflictException(
                    "계정 정보가 변경되었습니다. 새로고침 후 다시 시도해 주세요.",
                );
            }

            const currentBranchIds = target.userBranches.map(
                (membership) => membership.branchId,
            );
            const currentBranchIdSet = new Set(currentBranchIds);
            const currentMembershipRoleByBranchId = new Map(
                target.userBranches.map(
                    (membership) => [membership.branchId, membership.role] as const,
                ),
            );
            const expectedSnapshotMatches = target.role === params.expectedRole
                && currentBranchIds.length === params.expectedBranchIds.length
                && params.expectedBranchIds.every(
                    (branchId) => currentBranchIdSet.has(branchId),
                );
            if (!expectedSnapshotMatches) {
                throw new ConflictException(
                    "계정 정보가 변경되었습니다. 새로고침 후 다시 시도해 주세요.",
                );
            }

            if (params.role === "admin" && target.role !== "admin") {
                throw new ForbiddenException(
                    "지점장 역할은 기존 지점장 계정에서만 유지할 수 있습니다.",
                );
            }

            const inactiveOwnedBranchIds = params.role === "admin"
                ? target.ownedBranches
                    .filter((ownedBranch) => ownedBranch.isActive !== true)
                    .map((ownedBranch) => ownedBranch.id)
                : [];
            const inactiveExistingMembershipIds = target.userBranches
                .filter((membership) => membership.branch.isActive !== true)
                .map((membership) => membership.branchId);
            const allowedInactiveBranchIdSet = new Set([
                ...inactiveOwnedBranchIds,
                ...inactiveExistingMembershipIds,
            ]);
            if (
                params.role === "admin"
                && target.ownedBranches.some(
                    (ownedBranch) => ownedBranch.isActive === true
                        && !params.branchIds.includes(ownedBranch.id),
                )
            ) {
                throw new BadRequestException(
                    "지점장 역할을 유지하려면 담당 지점을 모두 포함해야 합니다.",
                );
            }

            const effectiveBranchIds = params.role === "admin"
                ? [
                    ...params.branchIds,
                    ...inactiveOwnedBranchIds.filter(
                        (branchId) => !params.branchIds.includes(branchId),
                    ),
                ]
                : params.branchIds;
            const branchIdsRequiringActiveValidation = effectiveBranchIds.filter(
                (branchId) => !allowedInactiveBranchIdSet.has(branchId),
            );
            if (branchIdsRequiringActiveValidation.length === 0) {
                throw new BadRequestException(
                    "하나 이상의 활성 지점을 선택해야 합니다.",
                );
            }
            const activeBranches = await tx.branch.findMany({
                where: {
                    id: { in: branchIdsRequiringActiveValidation },
                    isActive: true,
                },
                select: { id: true },
            });
            if (activeBranches.length !== branchIdsRequiringActiveValidation.length) {
                throw new BadRequestException("유효하지 않은 지점입니다.");
            }

            const effectiveBranchIdSet = new Set(effectiveBranchIds);
            const membershipSetMatches = currentBranchIds.length === effectiveBranchIds.length
                && currentBranchIds.every(
                    (branchId) => effectiveBranchIdSet.has(branchId),
                );
            const membershipRolesMatch = !isAccountAssignmentRoleDemotion(target.role, params.role)
                || target.userBranches.every((membership) =>
                    getRetainedMembershipRole(membership.role, target.role, params.role)
                    === membership.role,
                );
            if (
                target.role === params.role
                && membershipSetMatches
                && membershipRolesMatch
            ) {
                return {
                    id: target.id,
                    name: target.name,
                    email: target.email,
                    role: target.role,
                    approvalStatus: target.approvalStatus,
                    approvedAt: target.approvedAt,
                    approvedBy: target.approvedBy,
                    requestedRole: target.requestedRole,
                    tokenVersion: target.tokenVersion,
                };
            }

            if (target.role === "admin" && params.role !== "admin") {
                await tx.branch.updateMany({
                    where: { ownerId: id },
                    data: { ownerId: null },
                });
            }

            const updatedUser = await tx.user.update({
                where: { id },
                data: {
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
                    branchId: { notIn: effectiveBranchIds },
                },
            });
            for (const branchId of effectiveBranchIds) {
                const currentMembershipRole = currentMembershipRoleByBranchId.get(branchId);
                const membershipRole = getRetainedMembershipRole(
                    currentMembershipRole,
                    target.role,
                    params.role,
                );
                await tx.user_branch.upsert({
                    where: {
                        userId_branchId: { userId: id, branchId },
                    },
                    update: { role: membershipRole },
                    create: {
                        userId: id,
                        branchId,
                        role: membershipRole,
                    },
                });
            }

            await tx.auth_session.updateMany({
                where: { userId: id, revokedAt: null },
                data: {
                    revokedAt: new Date(),
                    revokedReason: "account_assignment_changed",
                },
            });

            return updatedUser;
        }, {
            isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        });

        for (
            let attempt = 1;
            attempt <= MAX_ACCOUNT_ASSIGNMENT_TRANSACTION_ATTEMPTS;
            attempt += 1
        ) {
            try {
                return await runTransaction();
            } catch (error) {
                if (!isPrismaTransactionWriteConflict(error)) {
                    throw error;
                }
                if (attempt === MAX_ACCOUNT_ASSIGNMENT_TRANSACTION_ATTEMPTS) {
                    throw new ConflictException(
                        "계정 정보가 동시에 변경되었습니다. 최신 정보를 확인한 뒤 다시 시도해 주세요.",
                    );
                }
            }
        }

        throw new ConflictException(
            "계정 정보가 동시에 변경되었습니다. 최신 정보를 확인한 뒤 다시 시도해 주세요.",
        );
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

function isPrismaTransactionWriteConflict(error: unknown): boolean {
    return typeof error === "object"
        && error !== null
        && "code" in error
        && error.code === "P2034";
}
