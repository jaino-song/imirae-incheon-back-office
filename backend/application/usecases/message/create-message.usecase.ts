import { Inject, Injectable } from "@nestjs/common";
import { MessageEntity } from "domain/entities/message.entity";
import { IMessageRepository, MESSAGE_REPOSITORY } from "domain/repositories/message.repository.interface";

@Injectable()
export class CreateMessageUsecase {
    constructor(
        @Inject(MESSAGE_REPOSITORY)
        private readonly messageRepository: IMessageRepository,
    ) {}

    execute(title: string, text: string): Promise<MessageEntity> {
        const message = MessageEntity.create(title, text);
        return this.messageRepository.create(message);
    }
}

