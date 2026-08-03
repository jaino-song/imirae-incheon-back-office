import { SystemSettingEntity } from "domain/entities/system-setting.entity";

export interface ISystemSettingRepository {
    findByKey(key: string): Promise<SystemSettingEntity | null>;
    upsert(entity: SystemSettingEntity): Promise<SystemSettingEntity>;
    compareAndSet(
        key: string,
        expectedVersion: string,
        entity: SystemSettingEntity,
        versionOf: (value: string | null) => string,
    ): Promise<SystemSettingEntity | null>;
}

export const SYSTEM_SETTING_REPOSITORY = "SYSTEM_SETTING_REPOSITORY";
