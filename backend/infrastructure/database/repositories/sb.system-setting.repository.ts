import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "infrastructure/database/prisma.service";
import { ISystemSettingRepository } from "domain/repositories/system-setting.repository.interface";
import { SystemSettingEntity } from "domain/entities/system-setting.entity";
import { SystemSettingMapper } from "infrastructure/database/mapper/system-setting.mapper";
import { AdminAuditEventWriter } from "application/services/admin-audit-event.service";
import { SystemSettingAuditContext } from "domain/repositories/system-setting.repository.interface";
import { createHash } from "node:crypto";

@Injectable()
export class SbSystemSettingRepository implements ISystemSettingRepository {
    constructor(
        private readonly prismaService: PrismaService,
        private readonly auditWriter?: AdminAuditEventWriter,
    ) {}

    async findByKey(key: string): Promise<SystemSettingEntity | null> {
        const row = await this.prismaService.system_setting.findUnique({
            where: { key },
        });
        return row ? SystemSettingMapper.toDomain(row) : null;
    }

    async upsert(
        entity: SystemSettingEntity,
        auditContext?: SystemSettingAuditContext,
    ): Promise<SystemSettingEntity> {
        const upsertArgs = SystemSettingMapper.toPrismaUpsert(entity);
        if (auditContext) {
            if (!this.auditWriter) {
                throw new Error("Admin audit writer is required for audited setting mutations");
            }
            const row = await this.prismaService.$transaction(async (transaction) => {
                const before = await transaction.system_setting.findUnique({ where: { key: entity.key } });
                const updated = await transaction.system_setting.upsert(upsertArgs);
                await this.auditWriter!.append(transaction, {
                    actor: auditContext.actor,
                    branchId: auditContext.branchId,
                    action: auditContext.action ?? "system_setting.updated",
                    targetType: "system_setting",
                    targetId: entity.key,
                    before: before ? { key: before.key, valueDigest: digest(before.value) } : null,
                    after: { key: updated.key, valueDigest: digest(updated.value) },
                    outcome: "success",
                    source: auditContext.source ?? "backend",
                });
                return updated;
            });
            return SystemSettingMapper.toDomain(row);
        }
        const row = await this.prismaService.system_setting.upsert(upsertArgs);
        return SystemSettingMapper.toDomain(row);
    }

    async compareAndSet(
        key: string,
        expectedVersion: string,
        entity: SystemSettingEntity,
        versionOf: (value: string | null) => string,
        auditContext?: SystemSettingAuditContext,
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
                    const created = await transaction.system_setting.create({
                        data: { key: entity.key, value: entity.value, updatedAt: entity.updatedAt },
                    });
                    if (auditContext) {
                        if (!this.auditWriter) {
                            throw new Error("Admin audit writer is required for audited setting mutations");
                        }
                        await this.auditWriter.append(transaction, {
                            actor: auditContext.actor,
                            branchId: auditContext.branchId,
                            action: auditContext.action ?? "system_setting.updated",
                            targetType: "system_setting",
                            targetId: entity.key,
                            before: null,
                            after: { key: created.key, valueDigest: digest(created.value) },
                            outcome: "success",
                            source: auditContext.source ?? "backend",
                        });
                    }
                    return created;
                }
                const updated = await transaction.system_setting.update({
                    where: { key },
                    data: { value: entity.value, updatedAt: entity.updatedAt },
                });
                if (auditContext) {
                    if (!this.auditWriter) {
                        throw new Error("Admin audit writer is required for audited setting mutations");
                    }
                    await this.auditWriter.append(transaction, {
                        actor: auditContext.actor,
                        branchId: auditContext.branchId,
                        action: auditContext.action ?? "system_setting.updated",
                        targetType: "system_setting",
                        targetId: entity.key,
                        before: { key: current.key, valueDigest: digest(current.value) },
                        after: { key: updated.key, valueDigest: digest(updated.value) },
                        outcome: "success",
                        source: auditContext.source ?? "backend",
                    });
                }
                return updated;
            });
            return row ? SystemSettingMapper.toDomain(row) : null;
        } catch (error) {
            if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return null;
            throw error;
        }
    }
}

function digest(value: string): string {
    return createHash("sha256").update(value).digest("hex").slice(0, 16);
}
