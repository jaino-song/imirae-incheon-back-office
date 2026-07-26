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

@Injectable()
export class SystemAdminService {
    constructor(private readonly prisma: PrismaService) {}

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

    async createBranch(dto: CreateSystemAdminBranchDto): Promise<SystemAdminBranchRequestDto> {
        const manager = dto.ownerId ? await this.getEligibleBranchManager(dto.ownerId) : null;

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

                if (manager) {
                    await this.assignBranchManager(tx, createdBranch.id, manager);
                }
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
    ): Promise<SystemAdminBranchRequestDto> {
        const manager = dto.ownerId
            ? await this.getEligibleBranchManager(dto.ownerId)
            : null;

        try {
            await this.prisma.$transaction(async (tx) => {
                const existing = await tx.branch.findUnique({
                    where: { id: branchId },
                    select: { ownerId: true },
                });
                if (!existing) {
                    throw new NotFoundException("지점을 찾을 수 없습니다.");
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
            });

            return this.getBranchRequest(branchId);
        } catch (error) {
            this.rethrowBranchMutationError(error);
        }
    }

    private async getEligibleBranchManager(
        userId: string,
    ): Promise<{ id: string; role: string }> {
        const manager = await this.prisma.user.findFirst({
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
