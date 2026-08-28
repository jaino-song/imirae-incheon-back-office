import { Module } from "@nestjs/common";
import { SYSTEM_SETTING_REPOSITORY } from "domain/repositories/system-setting.repository.interface";
import { SbSystemSettingRepository } from "infrastructure/database/repositories/sb.system-setting.repository";
import { DatabaseModule } from "infrastructure/database/database.module";
import { GetSettingUsecase, UpdateSettingUsecase } from "application/usecases/system-setting";
import { SystemSettingService } from "application/services/system-setting.service";
import { MessageSenderApprovalService } from "application/services/message-sender-approval.service";
import { SystemSettingController } from "interface/controllers/system-setting.controller";
import { PublicSettingsController } from "interface/controllers/public-settings.controller";
import { AdminAuditEventWriter } from "application/services/admin-audit-event.service";

@Module({
    imports: [DatabaseModule],
    controllers: [SystemSettingController, PublicSettingsController],
    providers: [
        { provide: SYSTEM_SETTING_REPOSITORY, useClass: SbSystemSettingRepository },
        GetSettingUsecase,
        UpdateSettingUsecase,
        SystemSettingService,
        MessageSenderApprovalService,
        AdminAuditEventWriter,
    ],
    exports: [GetSettingUsecase, UpdateSettingUsecase, SystemSettingService, MessageSenderApprovalService],
})
export class SystemSettingModule {}
