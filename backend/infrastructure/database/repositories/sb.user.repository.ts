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

    async findByKakaoId(kakaoId: string): Promise<UserEntity | null> {
        const user = await this.prismaService.user.findUnique({
            where: { kakaoId },
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

    async delete(id: string): Promise<void> {
        await this.prismaService.user.delete({
            where: { id },
        });
    }
}