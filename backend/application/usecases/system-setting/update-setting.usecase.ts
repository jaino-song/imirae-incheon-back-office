import { Injectable, Inject } from "@nestjs/common";
import {
    ISystemSettingRepository,
    SYSTEM_SETTING_REPOSITORY,
} from "domain/repositories/system-setting.repository.interface";
import { SystemSettingEntity } from "domain/entities/system-setting.entity";
import { SystemSettingAuditContext } from "domain/repositories/system-setting.repository.interface";

@Injectable()
export class UpdateSettingUsecase {
    constructor(
        @Inject(SYSTEM_SETTING_REPOSITORY)
        private readonly repository: ISystemSettingRepository
    ) {}

    async execute(
        key: string,
        value: string,
        auditContext?: SystemSettingAuditContext,
    ): Promise<SystemSettingEntity> {
        const entity = SystemSettingEntity.create(key, value);
        return auditContext === undefined
            ? this.repository.upsert(entity)
            : this.repository.upsert(entity, auditContext);
    }

    async executeIfVersion(
        key: string,
        value: string,
        expectedVersion: string,
        versionOf: (currentValue: string | null) => string,
        auditContext?: SystemSettingAuditContext,
    ): Promise<SystemSettingEntity | null> {
        const entity = SystemSettingEntity.create(key, value);
        return auditContext === undefined
            ? this.repository.compareAndSet(key, expectedVersion, entity, versionOf)
            : this.repository.compareAndSet(key, expectedVersion, entity, versionOf, auditContext);
    }
}
