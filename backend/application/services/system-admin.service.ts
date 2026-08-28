import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";

import { MessageSenderApprovalStatus } from "interface/dto/message-sender-approval.dto";
import {
    CreateSystemAdminBranchDto,
    SystemAdminBranchRequestDto,
    SystemAdminBranchUserDto,
    UpdateSystemAdminBranchDto,
} from "interface/dto/system-admin.dto";
import { PrismaService } from "infrastructure/database/prisma.service";
import { AdminAuditActor, AdminAuditEventWriter } from "application/services/admin-audit-event.service";
import { currentAdminAuditActor } from "application/services/admin-audit-context";

@Injectable()
export class SystemAdminService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly auditWriter?: AdminAuditEventWriter,
    ) {}

    async listBranchRequests(): Promise<SystemAdminBranchRequestDto[]> {
        const branches = await this.prisma.branch.findMany({
            orderBy: [
                { smsSenderApprovalRequestedAt: "desc" },
                { updatedAt: "desc" },
                { name: "asc" },
            ],
            select: {
                id: true,
                name: true,
                slug: true,
                region: true,
                district: true,
                address: true,
                phone: true,
                email: true,
                isActive: true,
                createdAt: true,
                updatedAt: true,
                smsSenderApprovalStatus: true,
                smsSenderApprovalRequestedAt: true,
                smsSenderApprovalApprovedAt: true,
                smsSenderApprovalRequestedBy: true,
                owner: {
                    select: {
                        id: true,
                        name: true,
                        email: true,
                        phone: true,
                        role: true,
                    },
                },
            },
        });

        const requesterIds = Array.from(
            new Set(
                branches
                    .map((branch) => branch.smsSenderApprovalRequestedBy)
                    .filter((userId): userId is string => Boolean(userId)),
            ),
        );
        const requesters = requesterIds.length > 0
            ? await this.prisma.user.findMany({
                where: { id: { in: requesterIds } },
                select: {
                    id: true,
                    name: true,
                    email: true,
                    phone: true,
                    role: true,
                },
            })
            : [];
        const requesterById = new Map<string, SystemAdminBranchUserDto>(
            requesters.map((requester) => [requester.id, requester]),
        );

        return branches.map((branch) => ({
            id: branch.id,
            name: branch.name,
            slug: branch.slug,
            region: branch.region ?? null,
            district: branch.district ?? null,
            address: branch.address ?? null,
            phone: branch.phone ?? null,
            email: branch.email ?? null,
            isActive: branch.isActive ?? false,
            createdAt: branch.createdAt?.toISOString() ?? null,
            updatedAt: branch.updatedAt?.toISOString() ?? null,
            owner: branch.owner,
            messageSenderApproval: {
                approvalStatus: normalizeMessageSenderApprovalStatus(
                    branch.smsSenderApprovalStatus,
                ),
                requestedAt: branch.smsSenderApprovalRequestedAt?.toISOString() ?? null,
                approvedAt: branch.smsSenderApprovalApprovedAt?.toISOString() ?? null,
                requestedBy: branch.smsSenderApprovalRequestedBy
                    ? requesterById.get(branch.smsSenderApprovalRequestedBy) ?? null
                    : null,
            },
        }));
    }

    async createBranch(
        dto: CreateSystemAdminBranchDto,
        onCreated?: (transaction: Prisma.TransactionClient, branchId: string) => Promise<void>,
        actor?: AdminAuditActor,
    ): Promise<SystemAdminBranchRequestDto> {
        actor = actor ?? currentAdminAuditActor();
        // Fail before opening a write transaction for legacy callers while the
        // transaction-local lookup below remains the race-safe authority check.
        if (dto.ownerId) {
            await this.getEligibleBranchManager(this.prisma, dto.ownerId);
        }
        try {
            const branch = await this.prisma.$transaction(async (tx) => {
                const createdBranch = await tx.branch.create({
                    data: {
                        name: dto.name,
                        slug: dto.slug,
                        ownerId: dto.ownerId ?? null,
                        region: normalizeOptionalText(dto.region),
                        district: normalizeOptionalText(dto.district),
                        address: normalizeOptionalText(dto.address),
                        phone: normalizeOptionalText(dto.phone),
                        email: normalizeOptionalText(dto.email),
                        isActive: dto.isActive,
                    },
                    select: { id: true },
                });

                const manager = dto.ownerId
                    ? await this.getEligibleBranchManager(tx, dto.ownerId)
                    : null;
                if (manager) {
                    await this.assignBranchManager(tx, createdBranch.id, manager);
                }
                await onCreated?.(tx, createdBranch.id);
                await this.appendAudit(tx, actor, {
                    action: "branch.created",
                    branchId: createdBranch.id,
                    targetType: "branch",
                    targetId: createdBranch.id,
                    before: null,
                    after: {
                        id: createdBranch.id,
                        ownerId: dto.ownerId ?? null,
                        isActive: dto.isActive ?? true,
                    },
                });
                return createdBranch;
            });

            return this.getBranchRequest(branch.id);
        } catch (error) {
            this.rethrowBranchMutationError(error);
        }
    }

    async updateBranch(
        branchId: string,
        dto: UpdateSystemAdminBranchDto,
        actor?: AdminAuditActor,
    ): Promise<SystemAdminBranchRequestDto> {
        actor = actor ?? currentAdminAuditActor();
        try {
            await this.prisma.$transaction(async (tx) => {
                await this.lockRow(tx, "branch", branchId);
                const existing = await tx.branch.findUnique({
                    where: { id: branchId },
                    select: { ownerId: true, isActive: true },
                });
                if (!existing) {
                    throw new NotFoundException("지점을 찾을 수 없습니다.");
                }

                const manager = dto.ownerId
                    ? await this.getEligibleBranchManager(tx, dto.ownerId)
                    : null;
                if (dto.ownerId === undefined && existing.ownerId) {
                    await this.ensureOwnerMembership(tx, branchId, existing.ownerId);
                }

                await tx.branch.update({
                    where: { id: branchId },
                    data: {
                        ...(dto.name !== undefined ? { name: dto.name } : {}),
                        ...(dto.slug !== undefined ? { slug: dto.slug } : {}),
                        ...(dto.ownerId !== undefined ? { ownerId: dto.ownerId } : {}),
                        ...(dto.region !== undefined
                            ? { region: normalizeOptionalText(dto.region) }
                            : {}),
                        ...(dto.district !== undefined
                            ? { district: normalizeOptionalText(dto.district) }
                            : {}),
                        ...(dto.address !== undefined
                            ? { address: normalizeOptionalText(dto.address) }
                            : {}),
                        ...(dto.phone !== undefined
                            ? { phone: normalizeOptionalText(dto.phone) }
                            : {}),
                        ...(dto.email !== undefined
                            ? { email: normalizeOptionalText(dto.email) }
                            : {}),
                        ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
                        updatedAt: new Date(),
                    },
                });

                if (manager) {
                    await this.assignBranchManager(tx, branchId, manager);
                }

                if (dto.ownerId !== undefined && existing.ownerId && existing.ownerId !== dto.ownerId) {
                    await tx.user_branch.updateMany({
                        where: {
                            userId: existing.ownerId,
                            branchId,
                            role: "admin",
                        },
                        data: { role: "user" },
                    });
                    // A few legacy rows used an owner-equivalent membership
                    // role. Revoke that authority as well during transfer.
                    await tx.user_branch.updateMany({
                        where: {
                            userId: existing.ownerId,
                            branchId,
                            role: "owner",
                        },
                        data: { role: "user" },
                    });
                    const stillOwnsBranch = await tx.branch.findFirst({
                        where: { ownerId: existing.ownerId },
                        select: { id: true },
                    });
                    if (!stillOwnsBranch) {
                        await tx.user.updateMany({
                            where: { id: existing.ownerId, role: "admin" },
                            data: { role: "user" },
                        });
                    }
                }

                await this.appendAudit(tx, actor, {
                    action: dto.ownerId !== undefined && existing.ownerId !== dto.ownerId
                        ? "branch.owner_transferred"
                        : "branch.updated",
                    branchId,
                    targetType: "branch",
                    targetId: branchId,
                    before: {
                        id: branchId,
                        ownerId: existing.ownerId ?? null,
                        isActive: existing.isActive ?? true,
                    },
                    after: {
                        id: branchId,
                        ownerId: dto.ownerId !== undefined ? dto.ownerId : existing.ownerId ?? null,
                        isActive: dto.isActive !== undefined
                            ? dto.isActive
                            : existing.isActive ?? true,
                    },
                });
            });

            return this.getBranchRequest(branchId);
        } catch (error) {
            this.rethrowBranchMutationError(error);
        }
    }

    private async getEligibleBranchManager(
        client: Pick<PrismaService, "user"> | Prisma.TransactionClient,
        userId: string,
    ): Promise<{ id: string; role: string }> {
        const manager = await client.user.findFirst({
            where: {
                id: userId,
                approvalStatus: "approved",
                role: { in: ["owner", "admin", "manager", "user"] },
            },
            select: { id: true, role: true },
        });

        if (!manager?.role) {
            throw new NotFoundException("승인된 계정을 찾을 수 없습니다.");
        }

        return { id: manager.id, role: manager.role };
    }

    private async assignBranchManager(
        tx: Prisma.TransactionClient,
        branchId: string,
        manager: { id: string; role: string },
    ): Promise<void> {
        const managerRole = manager.role === "owner" ? "owner" : "admin";

        await tx.user.update({
            where: { id: manager.id },
            data: { role: managerRole },
        });
        await tx.user_branch.upsert({
            where: {
                userId_branchId: { userId: manager.id, branchId },
            },
            create: {
                userId: manager.id,
                branchId,
                role: "admin",
            },
            update: { role: "admin" },
        });
    }

    private async ensureOwnerMembership(
        tx: Prisma.TransactionClient,
        branchId: string,
        ownerId: string,
    ): Promise<void> {
        // Older rows may contain owner_id without the corresponding membership.
        // Repair that narrow inconsistency inside the same locked branch
        // transaction before allowing any further branch mutation.
        if (typeof tx.user_branch.findUnique !== "function") return;
        const membership = await tx.user_branch.findUnique({
            where: { userId_branchId: { userId: ownerId, branchId } },
        });
        if (!membership) {
            await tx.user_branch.upsert({
                where: { userId_branchId: { userId: ownerId, branchId } },
                create: { userId: ownerId, branchId, role: "admin" },
                update: { role: "admin" },
            });
            return;
        }
        if (membership.role !== "admin" && membership.role !== "owner") {
            await tx.user_branch.updateMany({
                where: { userId: ownerId, branchId },
                data: { role: "admin" },
            });
        }
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
            if (actor) throw new Error("Admin audit writer is required for audited branch mutations");
            return;
        }
        if (!actor?.userId) {
            throw new Error("Authenticated actor is required for audited branch mutations");
        }
        await this.auditWriter.append(tx, {
            ...event,
            actor: actor ?? null,
            outcome: "success",
            source: "backend",
        });
    }

    private async getBranchRequest(branchId: string): Promise<SystemAdminBranchRequestDto> {
        const branch = await this.prisma.branch.findUnique({
            where: { id: branchId },
            select: {
                id: true,
                name: true,
                slug: true,
                region: true,
                district: true,
                address: true,
                phone: true,
                email: true,
                isActive: true,
                createdAt: true,
                updatedAt: true,
                smsSenderApprovalStatus: true,
                smsSenderApprovalRequestedAt: true,
                smsSenderApprovalApprovedAt: true,
                smsSenderApprovalRequestedBy: true,
                owner: {
                    select: {
                        id: true,
                        name: true,
                        email: true,
                        phone: true,
                        role: true,
                    },
                },
            },
        });

        if (!branch) {
            throw new NotFoundException("지점을 찾을 수 없습니다.");
        }

        const requester = branch.smsSenderApprovalRequestedBy
            ? await this.prisma.user.findUnique({
                where: { id: branch.smsSenderApprovalRequestedBy },
                select: {
                    id: true,
                    name: true,
                    email: true,
                    phone: true,
                    role: true,
                },
            })
            : null;

        return {
            id: branch.id,
            name: branch.name,
            slug: branch.slug,
            region: branch.region ?? null,
            district: branch.district ?? null,
            address: branch.address ?? null,
            phone: branch.phone ?? null,
            email: branch.email ?? null,
            isActive: branch.isActive ?? false,
            createdAt: branch.createdAt?.toISOString() ?? null,
            updatedAt: branch.updatedAt?.toISOString() ?? null,
            owner: branch.owner,
            messageSenderApproval: {
                approvalStatus: normalizeMessageSenderApprovalStatus(
                    branch.smsSenderApprovalStatus,
                ),
                requestedAt: branch.smsSenderApprovalRequestedAt?.toISOString() ?? null,
                approvedAt: branch.smsSenderApprovalApprovedAt?.toISOString() ?? null,
                requestedBy: requester,
            },
        };
    }

    private rethrowBranchMutationError(error: unknown): never {
        if (error instanceof Prisma.PrismaClientKnownRequestError) {
            if (error.code === "P2002") {
                throw new ConflictException("이미 사용 중인 지점 식별자입니다.");
            }
            if (error.code === "P2025") {
                throw new NotFoundException("지점을 찾을 수 없습니다.");
            }
        }

        throw error;
    }
}

function normalizeOptionalText(value: string | undefined): string | null {
    const normalized = value?.trim();
    return normalized ? normalized : null;
}

function normalizeMessageSenderApprovalStatus(
    value: string | null | undefined,
): MessageSenderApprovalStatus {
    if (value === "pending" || value === "approved") {
        return value;
    }

    return "not_requested";
}
