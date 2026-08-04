import { Module } from "@nestjs/common";
import {
    CreateMessageTemplateUsecase,
    UpdateMessageTemplateUsecase,
    DeleteMessageTemplateUsecase,
    ListMessageTemplatesUsecase,
    FindMessageTemplateByIdUsecase,
} from "application/usecases/message-template";
import { MessageTemplateService } from "application/services/message-template.service";
import { MESSAGE_TEMPLATE_REPOSITORY } from "domain/repositories/message-template.repository.interface";
import { DatabaseModule } from "infrastructure/database/database.module";
import { MessageTemplateRepository } from "infrastructure/database/repositories/message-template.repository";
import { MessageTemplateController } from "interface/controllers/message-template.controller";
import { MessageTemplateWriteAgentCapabilitiesProvider } from "application/usecases/message-template/message-template-write-agent-capabilities.provider";

@Module({
    imports: [DatabaseModule],
    controllers: [MessageTemplateController],
    providers: [
        CreateMessageTemplateUsecase,
        UpdateMessageTemplateUsecase,
        DeleteMessageTemplateUsecase,
        ListMessageTemplatesUsecase,
        FindMessageTemplateByIdUsecase,
        MessageTemplateService,
        MessageTemplateWriteAgentCapabilitiesProvider,
        {
            provide: MESSAGE_TEMPLATE_REPOSITORY,
            useClass: MessageTemplateRepository,
        },
    ],
    exports: [MessageTemplateService],
})
export class MessageTemplateModule {}
