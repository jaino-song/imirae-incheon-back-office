import { IUserRepository } from "domain/repositories/user.repository.interface";
import { UserEntity } from "domain/entities/user.entity";
import { PrismaService } from "../prisma.service";
import { Injectable } from "@nestjs/common";
import { UserMapper } from "../mapper/user.mapper";

@Injectable()
export class SbUserRepository implements IUserRepository {
    constructor(private prismaService: PrismaService) {}

    async findById(id: string): Promise<UserEntity | null> {
        const user = await this.prismaService.user.findUnique({
            where: { id },
        });
        return user ? UserMapper.toDomain(user) : null;
    }

    async findByIdInBranch(id: string, branchId: string): Promise<UserEntity | null> {
        const user = await this.prismaService.user.findFirst({
            where: {
                id,
                OR: [
                    { userBranches: { some: { branchId } } },
                    { ownedBranches: { some: { id: branchId } } },
                ],
            },
        });
        return user ? UserMapper.toDomain(user) : null;
    }

    async findByKakaoId(kakaoId: string): Promise<UserEntity | null> {
        const user = await this.prismaService.user.findUnique({
            where: { kakaoId: kakaoId },
        });
        return user ? UserMapper.toDomain(user) : null;
    }

    async findByEmail(email: string): Promise<UserEntity | null> {
        const user = await this.prismaService.user.findUnique({
            where: { email: email },
        });
        return user ? UserMapper.toDomain(user) : null;
    }

    async create(user: UserEntity): Promise<UserEntity> {
        const created = await this.prismaService.user.create({
            data: UserMapper.toPrismaCreate(user),
        });
        return UserMapper.toDomain(created);
    }

    async update(user: UserEntity): Promise<UserEntity> {
        const updated = await this.prismaService.user.update({
            where: { id: user.id },
            data: UserMapper.toPrismaUpdate(user),
        });
        return UserMapper.toDomain(updated);
    }

    async updateInBranch(
        user: UserEntity,
        branchId: string,
        branchRole?: string,
    ): Promise<UserEntity | null> {
        return this.prismaService.$transaction(async (tx) => {
            const updated = await tx.user.updateMany({
                where: {
                    id: user.id,
                    userBranches: { some: { branchId } },
                },
                data: UserMapper.toPrismaUpdate(user),
            });

            if (updated.count !== 1) {
                return null;
            }

            if (branchRole !== undefined) {
                const membership = await tx.user_branch.updateMany({
                    where: {
                        userId: user.id,
                        branchId,
                    },
                    data: { role: branchRole },
                });
                if (membership.count !== 1) {
                    return null;
                }
            }

            const persisted = await tx.user.findFirst({
                where: {
                    id: user.id,
                    userBranches: { some: { branchId } },
                },
            });
            return persisted ? UserMapper.toDomain(persisted) : null;
        });
    }

    async delete(id: string): Promise<void> {
        await this.prismaService.user.delete({
            where: { id },
        });
    }

    async deleteMembership(id: string, branchId: string): Promise<boolean> {
        const deleted = await this.prismaService.user_branch.deleteMany({
            where: {
                userId: id,
                branchId,
            },
        });
        return deleted.count === 1;
    }

    async clearBranchOwnerships(
        userId: string,
        membershipRole: "admin" | "manager" | "user",
    ): Promise<void> {
        await this.prismaService.$transaction(async (tx) => {
            const ownedBranches = await tx.branch.findMany({
                where: { ownerId: userId },
                select: { id: true },
            });
            const branchIds = ownedBranches.map((branch) => branch.id);
            if (branchIds.length === 0) {
                return;
            }

            await tx.branch.updateMany({
                where: {
                    id: { in: branchIds },
                    ownerId: userId,
                },
                data: { ownerId: null },
            });
            await tx.user_branch.updateMany({
                where: {
                    userId,
                    branchId: { in: branchIds },
                    role: "admin",
                },
                data: { role: membershipRole },
            });
        });
    }

    async findByRoles(roles: string[]): Promise<UserEntity[]> {
        const users = await this.prismaService.user.findMany({
            where: {
                role: { in: roles },
            },
        });
        return users.map(UserMapper.toDomain);
    }

    async findNotificationRecipientsByBranchId(branchId: string): Promise<UserEntity[]> {
        const users = await this.prismaService.user.findMany({
            where: {
                OR: [
                    { ownedBranches: { some: { id: branchId } } },
                    { userBranches: { some: { branchId } } },
                ],
            },
        });
        return users.map(UserMapper.toDomain);
    }
}
