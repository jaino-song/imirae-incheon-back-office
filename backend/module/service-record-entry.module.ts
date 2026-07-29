import { Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { DatabaseModule } from "infrastructure/database/database.module";
import { AligoModule } from "module/aligo.module";
import { MessageModule } from "module/message.module";
import { EformsignDocModule } from "module/eformsign-doc.module";
import { AdminServiceRecordController } from "interface/controllers/admin-service-record.controller";
import { ServiceRecordEntryController } from "interface/controllers/service-record-entry.controller";
import { ScheduleChangeController } from "interface/controllers/schedule-change.controller";
import { AdminServiceRecordService } from "application/services/admin-service-record.service";
import { AdminServiceRecordHeaderEditService } from "application/services/admin-service-record-header-edit.service";
import { ServiceRecordEntryService } from "application/services/service-record-entry.service";
import { ScheduleChangeService } from "application/services/schedule-change.service";
import { ServiceRecordTokenService } from "application/services/service-record-token.service";
import { ServiceRecordHeaderEditTokenService } from "application/services/service-record-header-edit-token.service";
import { ServiceRecordLinkService } from "application/services/service-record-link.service";
import { ServiceRecordGuard } from "infrastructure/auth/service-record.guard";
import { ServiceRecordHeaderEditGuard } from "infrastructure/auth/service-record-header-edit.guard";
import { getJwtSecret } from "infrastructure/auth/jwt-secret";
import { ServiceRecordLifecycleService } from "application/services/service-record-lifecycle.service";
import { ServiceRecordFinalizationService } from "application/services/service-record-finalization.service";
import { ServiceRecordFinalizationSchedulerService } from "application/services/service-record-finalization-scheduler.service";

/**
 * No-login daily service-record capture (BJJ-247).
 * Exports the token + link services so the assignment / replacement / termination
 * hooks (employee-schedule + client modules) can issue and revoke links.
 */
@Module({
    imports: [
        DatabaseModule,
        AligoModule,
        MessageModule,
        EformsignDocModule,
        JwtModule.register({
            secret: getJwtSecret(),
            signOptions: { expiresIn: "5m" },
        }),
    ],
    controllers: [ServiceRecordEntryController, ScheduleChangeController, AdminServiceRecordController],
    providers: [
        AdminServiceRecordService,
        AdminServiceRecordHeaderEditService,
        ServiceRecordEntryService,
        ScheduleChangeService,
        ServiceRecordTokenService,
        ServiceRecordHeaderEditTokenService,
        ServiceRecordLinkService,
        ServiceRecordLifecycleService,
        ServiceRecordFinalizationService,
        ServiceRecordFinalizationSchedulerService,
        ServiceRecordGuard,
        ServiceRecordHeaderEditGuard,
    ],
    exports: [ServiceRecordTokenService, ServiceRecordLinkService, ServiceRecordLifecycleService],
})
export class ServiceRecordEntryModule {}
