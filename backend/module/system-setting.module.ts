import { Module } from "@nestjs/common";
import { SYSTEM_SETTING_REPOSITORY } from "domain/repositories/system-setting.repository.interface";
import { SbSystemSettingRepository } from "infrastructure/database/repositories/sb.system-setting.repository";
import { DatabaseModule } from "infrastructure/database/database.module";
import { GetSettingUsecase, UpdateSettingUsecase } from "application/usecases/system-setting";
import { SystemSettingService } from "application/services/system-setting.service";
import { EformsignAutomationStatusService } from "application/services/eformsign-automation-status.service";
import { MessageSenderApprovalService } from "application/services/message-sender-approval.service";
import { SystemSettingController } from "interface/controllers/system-setting.controller";
import { PublicSettingsController } from "interface/controllers/public-settings.controller";
import { AdminAuditEventWriter } from "application/services/admin-audit-event.service";
import { EformsignWebhookEventWriter } from "application/services/eformsign-webhook-event.service";
import { EFORMSIGN_WEBHOOK_EVENT_REPOSITORY } from "domain/repositories/eformsign-webhook-event.repository.interface";
import { SbEformsignWebhookEventRepository } from "infrastructure/database/repositories/sb.eformsign-webhook-event.repository";

@Module({
    imports: [DatabaseModule],
    controllers: [SystemSettingController, PublicSettingsController],
    providers: [
        { provide: SYSTEM_SETTING_REPOSITORY, useClass: SbSystemSettingRepository },
        GetSettingUsecase,
        UpdateSettingUsecase,
        SystemSettingService,
        MessageSenderApprovalService,
        EformsignAutomationStatusService,
        EformsignWebhookEventWriter,
        {
            provide: EFORMSIGN_WEBHOOK_EVENT_REPOSITORY,
            useClass: SbEformsignWebhookEventRepository,
        },
        AdminAuditEventWriter,
    ],
    exports: [GetSettingUsecase, UpdateSettingUsecase, SystemSettingService, MessageSenderApprovalService],
})
export class SystemSettingModule {}
