import { MessageEntity } from "../entities/message.entity";

export interface IMessageRepository {
    findById(id: number): Promise<MessageEntity | null>;
    create(message: MessageEntity): Promise<MessageEntity>;
    update(message: MessageEntity): Promise<MessageEntity>;
    delete(id: number): Promise<void>;
}

export const MESSAGE_REPOSITORY = 'MESSAGE_REPOSITORY';