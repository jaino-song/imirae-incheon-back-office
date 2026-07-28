import { randomUUID } from "node:crypto";
import { Prisma, message_template } from "@prisma/client";

import { MessageTemplateEntity, TemplateVariable } from "domain/entities/message-template.entity";

type MessageTemplateRow = message_template;

export class MessageTemplateMapper {
    static toDomain(row: MessageTemplateRow): MessageTemplateEntity {
        const variables = (row.variables as unknown as TemplateVariable[]) || [];
        return MessageTemplateEntity.reconstitute(
            row.id,
            row.name,
            row.content,
            variables,
            row.createdAt,
            row.updatedAt,
        );
    }

    static toPrismaCreate(entity: MessageTemplateEntity): Prisma.message_templateCreateInput {
        return {
            id: entity.id.trim() || randomUUID(),
            name: entity.name,
            content: entity.content,
            variables: entity.variables as unknown as Prisma.InputJsonValue,
            updatedAt: entity.updatedAt,
        };
    }

    static toPrismaUpdate(entity: MessageTemplateEntity): Prisma.message_templateUpdateInput {
        return {
            name: entity.name,
            content: entity.content,
            variables: entity.variables as unknown as Prisma.InputJsonValue,
        };
    }
}
