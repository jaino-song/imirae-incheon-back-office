import { Injectable, Inject } from "@nestjs/common";
import {
    ISystemSettingRepository,
    SYSTEM_SETTING_REPOSITORY,
} from "domain/repositories/system-setting.repository.interface";
import { SystemSettingEntity } from "domain/entities/system-setting.entity";

@Injectable()
export class UpdateSettingUsecase {
    constructor(
        @Inject(SYSTEM_SETTING_REPOSITORY)
        private readonly repository: ISystemSettingRepository
    ) {}

    async execute(key: string, value: string): Promise<SystemSettingEntity> {
        const entity = SystemSettingEntity.create(key, value);
        return this.repository.upsert(entity);
    }

    async executeIfVersion(
        key: string,
        value: string,
        expectedVersion: string,
        versionOf: (currentValue: string | null) => string,
    ): Promise<SystemSettingEntity | null> {
        const entity = SystemSettingEntity.create(key, value);
        return this.repository.compareAndSet(key, expectedVersion, entity, versionOf);
    }
}
