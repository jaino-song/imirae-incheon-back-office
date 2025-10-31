import { Injectable } from "@nestjs/common";
import {
    CreateMessageUsecase,
    DeleteMessageUsecase,
    FindMessageByIdUsecase,
    UpdateMessageUsecase,
} from "application/usecases/message";
import { MessageEntity } from "domain/entities/message.entity";

@Injectable()
export class MessageService {
    constructor(
        private readonly createMessageUsecase: CreateMessageUsecase,
        private readonly findMessageByIdUsecase: FindMessageByIdUsecase,
        private readonly updateMessageUsecase: UpdateMessageUsecase,
        private readonly deleteMessageUsecase: DeleteMessageUsecase,
    ) {}

    create(title: string, text: string): Promise<MessageEntity> {
        return this.createMessageUsecase.execute(title, text);
    }

    findById(id: number): Promise<MessageEntity | null> {
        return this.findMessageByIdUsecase.execute(id);
    }

    update(id: number, title: string, text: string): Promise<MessageEntity> {
        return this.updateMessageUsecase.execute(id, title, text);
    }

    delete(id: number): Promise<void> {
        return this.deleteMessageUsecase.execute(id);
    }
}

