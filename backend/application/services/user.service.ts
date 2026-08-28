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
import { AdminAuditActor, AdminAuditEventWriter } from "application/services/admin-audit-event.service";
import { UserMapper } from "infrastructure/database/mapper/user.mapper";
import { currentAdminAuditActor } from "application/services/admin-audit-context";

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
        private readonly auditWriter?: AdminAuditEventWriter,
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
        actor?: AdminAuditActor;
    }): Promise<UserEntity> {
        const actor = params.actor ?? currentAdminAuditActor();
        if (params.branchId && params.branchRole !== undefined) {
            return this.updateBranchMembership(id, params.branchId, params.branchRole, params.callerRole, actor);
        }
        if (actor) {
            return this.updateGlobalUser(id, params, actor);
        }
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
            actor?: AdminAuditActor;
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
            for (const ownedBranch of target.ownedBranches) {
                await this.lockRow(tx, "branch", ownedBranch.id);
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
            const ownedBranchIdSet = new Set(target.ownedBranches.map((branch) => branch.id));
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
                const membershipRole = params.role === "admin" && ownedBranchIdSet.has(branchId)
                    ? "admin"
                    : getRetainedMembershipRole(
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

            await this.appendAudit(tx, params.actor ?? currentAdminAuditActor(), {
                action: "user.account_assignment.updated",
                targetType: "user",
                targetId: id,
                before: {
                    id,
                    role: target.role,
                    branchIds: currentBranchIds,
                },
                after: {
                    id,
                    role: params.role,
                    branchIds: effectiveBranchIds,
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

    async delete(id: string, branchId?: string, actor?: AdminAuditActor): Promise<void> {
        actor = actor ?? currentAdminAuditActor();
        if (!branchId) {
            await this.deleteGlobalUser(id, actor);
            return;
        }
        await this.deleteBranchMembership(id, branchId, actor);
    }

    private async updateGlobalUser(
        id: string,
        params: {
            name?: string;
            email?: string;
            profileImage?: string;
            role?: string | null;
            callerRole?: string;
        },
        actor: AdminAuditActor,
    ): Promise<UserEntity> {
        return runSerializableTransaction(this.prismaService, async (tx) => {
            await this.lockRow(tx, "user", id);
            const current = await tx.user.findUnique({ where: { id } });
            if (!current) throw new NotFoundException("User not found");
            if (params.role !== undefined && params.callerRole !== "owner") {
                throw new ForbiddenException("역할 변경은 소유자만 가능합니다.");
            }
            if (params.role !== undefined && current.role === "owner") {
                throw new ForbiddenException("오너 계정의 역할은 변경할 수 없습니다.");
            }

            const roleChanged = params.role !== undefined && params.role !== current.role;
            const data: Prisma.userUpdateInput = {
                ...(params.name !== undefined ? { name: params.name } : {}),
                ...(params.email !== undefined ? { email: params.email } : {}),
                ...(params.profileImage !== undefined ? { profileImage: params.profileImage } : {}),
                ...(params.role !== undefined ? { role: params.role } : {}),
                ...(roleChanged ? { tokenVersion: { increment: 1 } } : {}),
            };
            const updated = await tx.user.update({ where: { id }, data });

            if (roleChanged && current.role === "admin" && params.role !== "admin") {
                const ownedBranches = await tx.branch.findMany({
                    where: { ownerId: id },
                    select: { id: true },
                });
                if (ownedBranches.length > 0) {
                    const branchIds = ownedBranches.map((branch) => branch.id);
                    await tx.branch.updateMany({
                        where: { id: { in: branchIds }, ownerId: id },
                        data: { ownerId: null },
                    });
                    await tx.user_branch.updateMany({
                        where: { userId: id, branchId: { in: branchIds }, role: "admin" },
                        data: { role: params.role === "manager" ? "manager" : "user" },
                    });
                }
                await tx.auth_session.updateMany({
                    where: { userId: id, revokedAt: null },
                    data: { revokedAt: new Date(), revokedReason: "role_changed" },
                });
            }

            await this.appendAudit(tx, actor ?? currentAdminAuditActor(), {
                action: roleChanged ? "user.role.updated" : "user.profile.updated",
                targetType: "user",
                targetId: id,
                before: { id, role: current.role, name: current.name, profileImage: current.profileImage },
                after: { id, role: updated.role, name: updated.name, profileImage: updated.profileImage },
            });
            return UserMapper.toDomain(updated);
        });
    }

    private async updateBranchMembership(
        id: string,
        branchId: string,
        branchRole: string,
        callerRole: string | undefined,
        actor?: AdminAuditActor,
    ): Promise<UserEntity> {
        return runSerializableTransaction(this.prismaService, async (tx) => {
            await this.lockRow(tx, "branch", branchId);
            const branch = await tx.branch.findUnique({ where: { id: branchId }, select: { ownerId: true } });
            if (!branch) throw new NotFoundException("User not found");
            const current = await tx.user.findUnique({ where: { id } });
            if (!current) throw new NotFoundException("User not found");
            if (current.role === "owner" && callerRole !== "owner") {
                throw new NotFoundException("User not found");
            }
            if (current.role === "owner" && branchRole !== "admin") {
                throw new ConflictException("오너 계정의 역할은 변경할 수 없습니다.");
            }
            if (branch.ownerId === id && branchRole !== "admin") {
                throw new ConflictException("지점 소유권을 먼저 다른 승인된 계정으로 이전해야 합니다.");
            }

            const membership = await tx.user_branch.findUnique({
                where: { userId_branchId: { userId: id, branchId } },
            });
            if (!membership && branch.ownerId !== id) {
                throw new NotFoundException("User not found");
            }
            const beforeRole = membership?.role ?? null;
            if (membership || branch.ownerId !== id) {
                const updatedMembership = await tx.user_branch.updateMany({
                    where: { userId: id, branchId },
                    data: { role: branchRole },
                });
                if (updatedMembership.count !== 1) throw new NotFoundException("User not found");
            } else {
                await tx.user_branch.upsert({
                    where: { userId_branchId: { userId: id, branchId } },
                    create: { userId: id, branchId, role: branchRole },
                    update: { role: branchRole },
                });
            }
            const persisted = await tx.user.findUnique({ where: { id } });
            if (!persisted) throw new NotFoundException("User not found");
            await this.appendAudit(tx, actor ?? currentAdminAuditActor(), {
                action: "user.membership_role.updated",
                branchId,
                targetType: "user_branch",
                targetId: `${id}:${branchId}`,
                before: { userId: id, branchId, role: beforeRole, ownerId: branch.ownerId },
                after: { userId: id, branchId, role: branchRole, ownerId: branch.ownerId },
            });
            return UserMapper.toDomain(persisted);
        });
    }

    private async deleteGlobalUser(id: string, actor?: AdminAuditActor): Promise<void> {
        await runSerializableTransaction(this.prismaService, async (tx) => {
            let target = await tx.user.findUnique({
                where: { id },
                select: { id: true, role: true, approvalStatus: true, ownedBranches: { select: { id: true } } },
            });
            if (!target) throw new NotFoundException("User not found");
            if (target.role === "owner") {
                const effectiveActor = actor ?? currentAdminAuditActor();
                if (!effectiveActor?.userId || effectiveActor.userId === id) {
                    throw new ConflictException(
                        "글로벌 소유자 계정은 독립적으로 인증된 successor를 통해서만 삭제할 수 있습니다.",
                    );
                }
                const owners = await tx.user.findMany({
                    where: { role: "owner" },
                    select: { id: true },
                });
                // Lock every owner in deterministic order so concurrent deletes
                // cannot both observe a two-owner world and leave zero owners.
                for (const owner of owners.map(({ id: ownerId }) => ownerId).sort()) {
                    await this.lockRow(tx, "user", owner);
                }
                target = await tx.user.findUnique({
                    where: { id },
                    select: { id: true, role: true, approvalStatus: true, ownedBranches: { select: { id: true } } },
                });
                if (!target) throw new NotFoundException("User not found");
                const lockedOwners = await tx.user.findMany({
                    where: { role: "owner" },
                    select: { id: true },
                });
                if (lockedOwners.length <= 1) {
                    throw new ConflictException("마지막 글로벌 소유자는 삭제할 수 없습니다. 먼저 승인된 successor를 지정하세요.");
                }
                if (target.ownedBranches.length > 0) {
                    throw new ConflictException("지점 소유권을 먼저 다른 승인된 계정으로 이전해야 합니다.");
                }
            } else {
                await this.lockRow(tx, "user", id);
            }
            await this.appendAudit(tx, actor ?? currentAdminAuditActor(), {
                action: "user.deleted",
                targetType: "user",
                targetId: id,
                before: { id, role: target.role, approvalStatus: target.approvalStatus, ownedBranchCount: target.ownedBranches.length },
                after: null,
            });
            await tx.user.delete({ where: { id } });
        });
    }

    private async deleteBranchMembership(
        id: string,
        branchId: string,
        actor?: AdminAuditActor,
    ): Promise<void> {
        await runSerializableTransaction(this.prismaService, async (tx) => {
            await this.lockRow(tx, "branch", branchId);
            const branch = await tx.branch.findUnique({ where: { id: branchId }, select: { ownerId: true } });
            if (!branch) throw new NotFoundException("User not found");
            if (branch.ownerId === id) {
                throw new ConflictException("지점 소유권을 먼저 다른 승인된 계정으로 이전해야 합니다.");
            }
            const deleted = await tx.user_branch.deleteMany({ where: { userId: id, branchId } });
            if (deleted.count !== 1) throw new NotFoundException("User not found");
            await this.appendAudit(tx, actor ?? currentAdminAuditActor(), {
                action: "user.membership.deleted",
                branchId,
                targetType: "user_branch",
                targetId: `${id}:${branchId}`,
                before: { userId: id, branchId, ownerId: branch.ownerId },
                after: null,
            });
        });
    }

    private async lockRow(
        tx: Prisma.TransactionClient,
        table: "branch" | "user",
        id: string,
    ): Promise<void> {
        if (typeof tx.$queryRawUnsafe !== "function") return;
        await tx.$queryRawUnsafe(`SELECT "id" FROM "${table}" WHERE "id" = $1 FOR UPDATE`, id);
    }

    private async appendAudit(
        tx: Prisma.TransactionClient,
        actor: AdminAuditActor | undefined,
        event: Omit<Parameters<AdminAuditEventWriter["append"]>[1], "actor" | "outcome" | "source">,
    ): Promise<void> {
        if (!this.auditWriter) {
            if (actor) throw new Error("Admin audit writer is required for audited user mutations");
            return;
        }
        if (!actor?.userId) {
            throw new Error("Authenticated actor is required for audited user mutations");
        }
        await this.auditWriter.append(tx, { ...event, actor: actor ?? null, outcome: "success", source: "backend" });
    }

    approve(
        id: string,
        params: {
            role: string;
            approvedBy: string;
            branchId: string;
            ownerBranchId?: string;
            actor?: AdminAuditActor;
        },
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

                await this.lockRow(tx, "branch", params.ownerBranchId);

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

            await this.appendAudit(tx, params.actor ?? currentAdminAuditActor(), {
                action: params.role === "admin" && params.ownerBranchId
                    ? "branch.owner_assigned"
                    : "user.approved",
                branchId: params.ownerBranchId ?? params.branchId,
                targetType: "user",
                targetId: id,
                before: { id, role: null, approvalStatus: "pending" },
                after: {
                    id,
                    role: user.role,
                    approvalStatus: user.approvalStatus,
                    ownerBranchId: params.ownerBranchId ?? null,
                },
            });

            return user;
        });
    }

    reject(id: string, actor?: AdminAuditActor): Promise<UserApprovalSummary> {
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
            await this.appendAudit(tx, actor ?? currentAdminAuditActor(), {
                action: "user.rejected",
                targetType: "user",
                targetId: id,
                before: { id, approvalStatus: "pending" },
                after: { id, approvalStatus: "rejected" },
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

async function runSerializableTransaction<T>(
    prisma: PrismaService,
    callback: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
    for (let attempt = 1; attempt <= MAX_ACCOUNT_ASSIGNMENT_TRANSACTION_ATTEMPTS; attempt += 1) {
        try {
            return await prisma.$transaction(callback, {
                isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
            });
        } catch (error) {
            if (!isPrismaTransactionWriteConflict(error) || attempt === MAX_ACCOUNT_ASSIGNMENT_TRANSACTION_ATTEMPTS) {
                throw error;
            }
        }
    }
    throw new ConflictException("동시 변경이 감지되었습니다. 최신 정보를 확인한 뒤 다시 시도해 주세요.");
}
