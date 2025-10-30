import { Inject, Injectable } from "@nestjs/common";
import { MessageEntity } from "domain/entities/message.entity";
import { IMessageRepository, MESSAGE_REPOSITORY } from "domain/repositories/message.repository.interface";

@Injectable()
export class FindMessageByIdUsecase {
    constructor(
        @Inject(MESSAGE_REPOSITORY)
        private readonly messageRepository: IMessageRepository,
    ) {}

    execute(id: number): Promise<MessageEntity | null> {
        return this.messageRepository.findById(id);
    }
}

