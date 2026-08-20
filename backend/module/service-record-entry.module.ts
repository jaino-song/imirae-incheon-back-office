import { Module } from "@nestjs/common";
import { DatabaseModule } from "infrastructure/database/database.module";
import { AligoModule } from "module/aligo.module";
import { MessageModule } from "module/message.module";
import { EformsignDocModule } from "module/eformsign-doc.module";
import { AdminServiceRecordController } from "interface/controllers/admin-service-record.controller";
import { ServiceRecordEntryController } from "interface/controllers/service-record-entry.controller";
import { ScheduleChangeController } from "interface/controllers/schedule-change.controller";
import { AdminServiceRecordService } from "application/services/admin-service-record.service";
import { ServiceRecordEntryService } from "application/services/service-record-entry.service";
import { ScheduleChangeService } from "application/services/schedule-change.service";
import { ServiceRecordTokenService } from "application/services/service-record-token.service";
import { ServiceRecordLinkService } from "application/services/service-record-link.service";
import { ServiceRecordGuard } from "infrastructure/auth/service-record.guard";
import { ServiceRecordLifecycleService } from "application/services/service-record-lifecycle.service";
import { ServiceRecordFinalizationService } from "application/services/service-record-finalization.service";
import { ServiceRecordFinalizationSchedulerService } from "application/services/service-record-finalization-scheduler.service";
import { ServiceRecordLinkReconciliationService } from "application/services/service-record-link-reconciliation.service";
import { MessageAutomationIntentService } from "application/services/message-automation-intent.service";

/**
 * No-login daily service-record capture (BJJ-247).
 * Exports the token + link services so the assignment / replacement / termination
 * hooks (employee-schedule + client modules) can issue and revoke links.
 */
@Module({
    imports: [DatabaseModule, AligoModule, MessageModule, EformsignDocModule],
    controllers: [ServiceRecordEntryController, ScheduleChangeController, AdminServiceRecordController],
    providers: [
        AdminServiceRecordService,
        ServiceRecordEntryService,
        ScheduleChangeService,
        ServiceRecordTokenService,
        ServiceRecordLinkService,
        ServiceRecordLifecycleService,
        ServiceRecordFinalizationService,
        ServiceRecordFinalizationSchedulerService,
        ServiceRecordLinkReconciliationService,
        MessageAutomationIntentService,
        ServiceRecordGuard,
    ],
    exports: [
        ServiceRecordTokenService,
        ServiceRecordLinkService,
        ServiceRecordLifecycleService,
        MessageAutomationIntentService,
    ],
})
export class ServiceRecordEntryModule {}
