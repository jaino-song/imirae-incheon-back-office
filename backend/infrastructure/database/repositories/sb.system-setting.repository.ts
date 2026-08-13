import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "infrastructure/database/prisma.service";
import { ISystemSettingRepository } from "domain/repositories/system-setting.repository.interface";
import { SystemSettingEntity } from "domain/entities/system-setting.entity";
import { SystemSettingMapper } from "infrastructure/database/mapper/system-setting.mapper";

@Injectable()
export class SbSystemSettingRepository implements ISystemSettingRepository {
    constructor(private readonly prismaService: PrismaService) {}

    async findByKey(key: string): Promise<SystemSettingEntity | null> {
        const row = await this.prismaService.system_setting.findUnique({
            where: { key },
        });
        return row ? SystemSettingMapper.toDomain(row) : null;
    }

    async upsert(entity: SystemSettingEntity): Promise<SystemSettingEntity> {
        const upsertArgs = SystemSettingMapper.toPrismaUpsert(entity);
        const row = await this.prismaService.system_setting.upsert(upsertArgs);
        return SystemSettingMapper.toDomain(row);
    }

    async compareAndSet(
        key: string,
        expectedVersion: string,
        entity: SystemSettingEntity,
        versionOf: (value: string | null) => string,
    ): Promise<SystemSettingEntity | null> {
        try {
            const row = await this.prismaService.$transaction(async (transaction) => {
                await transaction.$queryRawUnsafe(
                    'SELECT "key" FROM "system_setting" WHERE "key" = $1 FOR UPDATE',
                    key,
                );
                const current = await transaction.system_setting.findUnique({ where: { key } });
                if (versionOf(current?.value ?? null) !== expectedVersion) return null;
                if (!current) {
                    return transaction.system_setting.create({
                        data: { key: entity.key, value: entity.value, updatedAt: entity.updatedAt },
                    });
                }
                return transaction.system_setting.update({
                    where: { key },
                    data: { value: entity.value, updatedAt: entity.updatedAt },
                });
            });
            return row ? SystemSettingMapper.toDomain(row) : null;
        } catch (error) {
            if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return null;
            throw error;
        }
    }
}
