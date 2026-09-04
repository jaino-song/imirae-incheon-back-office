import { Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { EformsignWebhookController } from "interface/controllers/eformsign-webhook.controller";
import { EformsignWebhookService } from "application/services/eformsign-webhook.service";
import { EformsignWebhookEventWriter } from "application/services/eformsign-webhook-event.service";
import { EFORMSIGN_WEBHOOK_EVENT_REPOSITORY } from "domain/repositories/eformsign-webhook-event.repository.interface";
import { SbEformsignWebhookEventRepository } from "infrastructure/database/repositories/sb.eformsign-webhook-event.repository";
import {
    UpdateEformsignDocStatusUsecase,
    LinkDocumentToClientUsecase,
} from "application/usecases/eformsign-doc";
import { EFORMSIGN_DOC_REPOSITORY } from "domain/repositories/eformsign-doc.repository.interface";
import { EFORMSIGN_CLIENT_REPOSITORY } from "domain/repositories/eformsign.client.interface";
import { CLIENT_REPOSITORY } from "domain/repositories/client.repository.interface";
import { EMPLOYEE_SCHEDULE_REPOSITORY } from "domain/repositories/employee-schedule.repository.interface";
import { EMPLOYEE_REPOSITORY } from "domain/repositories/employee.repository.interface";
import { SbEformsignDocRepository } from "infrastructure/database/repositories/sb.eformsign-doc.repository";
import { SbClientRepository } from "infrastructure/database/repositories/sb.client.repository";
import { SbEmployeeScheduleRepository } from "infrastructure/database/repositories/sb.employee-schedule.repository";
import { SbEmployeeRepository } from "infrastructure/database/repositories/sb.employee.repository";
import { DatabaseModule } from "infrastructure/database/database.module";
import { WebhookGuard } from "infrastructure/auth/webhook.guard";
import { createEformsignClientRepository } from "infrastructure/vendor-stubs/e2e-vendor-stubs";
import { EformsignDocModule } from "./eformsign-doc.module";
import { NotificationModule } from "./notification.module";
import { ServiceRecordEntryModule } from "./service-record-entry.module";

@Module({
    imports: [DatabaseModule, EformsignDocModule, NotificationModule, ServiceRecordEntryModule],
    controllers: [EformsignWebhookController],
    providers: [
        WebhookGuard,
        EformsignWebhookService,
        EformsignWebhookEventWriter,
        {
            provide: EFORMSIGN_WEBHOOK_EVENT_REPOSITORY,
            useClass: SbEformsignWebhookEventRepository,
        },
        UpdateEformsignDocStatusUsecase,
        LinkDocumentToClientUsecase,
        {
            provide: EFORMSIGN_DOC_REPOSITORY,
            useClass: SbEformsignDocRepository,
        },
        {
            provide: EFORMSIGN_CLIENT_REPOSITORY,
            inject: [ConfigService],
            useFactory: createEformsignClientRepository,
        },
        {
            provide: CLIENT_REPOSITORY,
            useClass: SbClientRepository,
        },
        {
            provide: EMPLOYEE_SCHEDULE_REPOSITORY,
            useClass: SbEmployeeScheduleRepository,
        },
        {
            provide: EMPLOYEE_REPOSITORY,
            useClass: SbEmployeeRepository,
        },
    ],
})
export class EformsignWebhookModule {}
