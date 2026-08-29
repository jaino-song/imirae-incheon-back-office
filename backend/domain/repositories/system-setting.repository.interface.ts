import { SystemSettingEntity } from "domain/entities/system-setting.entity";

export interface SystemSettingAuditContext {
    actor?: {
        userId?: string | null;
        globalRole?: string | null;
        branchRole?: string | null;
    } | null;
    branchId?: string | null;
    action?: string;
    source?: string;
}

export interface ISystemSettingRepository {
    findByKey(key: string): Promise<SystemSettingEntity | null>;
    upsert(
        entity: SystemSettingEntity,
        auditContext?: SystemSettingAuditContext,
    ): Promise<SystemSettingEntity>;
    compareAndSet(
        key: string,
        expectedVersion: string,
        entity: SystemSettingEntity,
        versionOf: (value: string | null) => string,
        auditContext?: SystemSettingAuditContext,
    ): Promise<SystemSettingEntity | null>;
}

export const SYSTEM_SETTING_REPOSITORY = "SYSTEM_SETTING_REPOSITORY";
