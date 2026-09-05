import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";

import { AligoModule } from "./aligo.module";
import { SystemSettingModule } from "./system-setting.module";
import { SystemTemplateModule } from "./system-template.module";
import {
    CreateMessageUsecase,
    DeleteMessageUsecase,
    FindMessageByIdUsecase,
    ListMessagesUsecase,
    UpdateMessageUsecase,
} from "application/usecases/message";
import { MessageRetrySchedulerService } from "application/services/message-retry-scheduler.service";
import { MessageService } from "application/services/message.service";
import { MessageTriggerDeliveryService } from "application/services/message-trigger-delivery.service";
import { MessageTriggerSchedulerService } from "application/services/message-trigger-scheduler.service";
import { MessageTriggerService } from "application/services/message-trigger.service";
import { SmsRetryService } from "application/services/sms-retry.service";
import { SmsTriggerDeliveryService } from "application/services/sms-trigger-delivery.service";
import { SmsTriggerPayloadEnricherRegistry } from "application/services/sms-trigger-payload-enricher.registry";
import { BRANCH_REPOSITORY } from "domain/repositories/branch.repository.interface";
import { CLIENT_REPOSITORY } from "domain/repositories/client.repository.interface";
import { EMPLOYEE_REPOSITORY } from "domain/repositories/employee.repository.interface";
import { EMPLOYEE_SCHEDULE_REPOSITORY } from "domain/repositories/employee-schedule.repository.interface";
import { MESSAGE_REPOSITORY } from "domain/repositories/message.repository.interface";
import { MESSAGE_TRIGGER_JOB_REPOSITORY } from "domain/repositories/message-trigger-job.repository.interface";
import { MESSAGE_TRIGGER_RULE_REPOSITORY } from "domain/repositories/message-trigger-rule.repository.interface";
import { MESSAGE_TRIGGER_RULE_BRANCH_OVERRIDE_REPOSITORY } from "domain/repositories/message-trigger-rule-branch-override.repository.interface";
import { DatabaseModule } from "infrastructure/database/database.module";
import { SbBranchRepository } from "infrastructure/database/repositories/sb.branch.repository";
import { SbClientRepository } from "infrastructure/database/repositories/sb.client.repository";
import { SbEmployeeRepository } from "infrastructure/database/repositories/sb.employee.repository";
import { SbEmployeeScheduleRepository } from "infrastructure/database/repositories/sb.employee-schedule.repository";
import { SbMessageRepository } from "infrastructure/database/repositories/sb.message.repository";
import { SbMessageTriggerJobRepository } from "infrastructure/database/repositories/sb.message-trigger-job.repository";
import { SbMessageTriggerRuleRepository } from "infrastructure/database/repositories/sb.message-trigger-rule.repository";
import { SbMessageTriggerRuleBranchOverrideRepository } from "infrastructure/database/repositories/sb.message-trigger-rule-branch-override.repository";
import { MessageController } from "interface/controllers/message.controller";
import { MessageTriggerController } from "interface/controllers/message-trigger.controller";
import { MessageExternalAgentCapabilitiesProvider } from "application/usecases/message/message-external-agent-capabilities.provider";

@Module({
    imports: [
        DatabaseModule,
        ConfigModule,
        SystemSettingModule,
        AligoModule,
        SystemTemplateModule,
    ],
    controllers: [MessageController, MessageTriggerController],
    providers: [
        CreateMessageUsecase,
        ListMessagesUsecase,
        FindMessageByIdUsecase,
        UpdateMessageUsecase,
        DeleteMessageUsecase,
        MessageService,
        {
            provide: MESSAGE_REPOSITORY,
            useClass: SbMessageRepository,
        },
        { provide: CLIENT_REPOSITORY, useClass: SbClientRepository },
        { provide: BRANCH_REPOSITORY, useClass: SbBranchRepository },
        { provide: EMPLOYEE_SCHEDULE_REPOSITORY, useClass: SbEmployeeScheduleRepository },
        { provide: EMPLOYEE_REPOSITORY, useClass: SbEmployeeRepository },
        { provide: MESSAGE_TRIGGER_RULE_REPOSITORY, useClass: SbMessageTriggerRuleRepository },
        { provide: MESSAGE_TRIGGER_RULE_BRANCH_OVERRIDE_REPOSITORY, useClass: SbMessageTriggerRuleBranchOverrideRepository },
        { provide: MESSAGE_TRIGGER_JOB_REPOSITORY, useClass: SbMessageTriggerJobRepository },
        SmsRetryService,
        MessageRetrySchedulerService,
        SmsTriggerDeliveryService,
        SmsTriggerPayloadEnricherRegistry,
        MessageTriggerDeliveryService,
        MessageTriggerService,
        MessageTriggerSchedulerService,
        MessageExternalAgentCapabilitiesProvider,
    ],
    exports: [
        MessageService,
        MessageTriggerService,
        MESSAGE_TRIGGER_JOB_REPOSITORY,
        MESSAGE_TRIGGER_RULE_BRANCH_OVERRIDE_REPOSITORY,
        SmsTriggerPayloadEnricherRegistry,
        MessageTriggerSchedulerService,
    ],
})
export class MessageModule {}
