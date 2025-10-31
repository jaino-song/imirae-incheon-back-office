import { Module } from "@nestjs/common";
import {
    CreateMessageUsecase,
    DeleteMessageUsecase,
    FindMessageByIdUsecase,
    UpdateMessageUsecase,
} from "application/usecases/message";
import { MessageService } from "application/services/message.service";
import { MESSAGE_REPOSITORY } from "domain/repositories/message.repository.interface";
import { PrismaService } from "infrastructure/database/prisma.service";
import { SbMessageRepository } from "infrastructure/database/repositories/sb.message.repository";
import { MessageController } from "interface/controllers/message.controller";

@Module({
    controllers: [MessageController],
    providers: [
        CreateMessageUsecase,
        FindMessageByIdUsecase,
        UpdateMessageUsecase,
        DeleteMessageUsecase,
        MessageService,
        PrismaService,
        {
            provide: MESSAGE_REPOSITORY,
            useClass: SbMessageRepository,
        },
    ],
    exports: [MessageService],
})
export class MessageModule {}

