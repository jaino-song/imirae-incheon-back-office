import { MessageEntity } from "domain/entities/message.entity";

type MessageRow = {
    id: number;
    title: string | null;
    text: string | null;
    created_at: Date;
    edited_at: Date | null;
};

export class MessageMapper {
    static toDomain(row: MessageRow): MessageEntity {
        return new MessageEntity(
            row.id,
            row.title || '',
            row.text || '',
            row.created_at,
            row.edited_at,
        );
    }

    static toPrismaCreate(entity: MessageEntity) {
        return {
            title: entity.title,
            text: entity.text,
        };
    }

    static toPrismaUpdate(entity: MessageEntity) {
        return {
            title: entity.title,
            text: entity.text,
            edited_at: entity.editedAt,
        };
    }
}


