import { MessageTemplateEntity } from "domain/entities/message-template.entity";
import type { Prisma } from "@prisma/client";

export interface IMessageTemplateRepository {
    findById(branchid: string, id: string): Promise<MessageTemplateEntity | null>;
    findAll(branchid: string): Promise<MessageTemplateEntity[]>;
    create(branchid: string, template: MessageTemplateEntity, transaction?: Prisma.TransactionClient): Promise<MessageTemplateEntity>;
    update(branchid: string, template: MessageTemplateEntity): Promise<MessageTemplateEntity>;
    delete(branchid: string, id: string): Promise<void>;
}

export const MESSAGE_TEMPLATE_REPOSITORY = "MESSAGE_TEMPLATE_REPOSITORY";
