import { Injectable } from "@nestjs/common";
import { IMessageTemplateRepository } from "domain/repositories/message-template.repository.interface";
import { MessageTemplateEntity } from "domain/entities/message-template.entity";
import { PrismaService } from "infrastructure/database/prisma.service";
import { MessageTemplateMapper } from "infrastructure/database/mapper/message-template.mapper";
import type { Prisma } from "@prisma/client";

@Injectable()
export class MessageTemplateRepository implements IMessageTemplateRepository {
    constructor(private readonly prismaService: PrismaService) {}

    async findById(branchid: string, id: string): Promise<MessageTemplateEntity | null> {
        const row = await this.prismaService.message_template.findFirst({
            where: { id, branchId: branchid },
        });
        return row ? MessageTemplateMapper.toDomain(row) : null;
    }

    async findAll(branchid: string): Promise<MessageTemplateEntity[]> {
        const rows = await this.prismaService.message_template.findMany({
            where: { branchId: branchid },
            orderBy: { createdAt: "desc" },
        });
        return rows.map(MessageTemplateMapper.toDomain);
    }

    async create(branchid: string, template: MessageTemplateEntity, transaction?: Prisma.TransactionClient): Promise<MessageTemplateEntity> {
        const { branch, ...data } = MessageTemplateMapper.toPrismaCreate(template);
        void branch;
        const created = await (transaction ?? this.prismaService).message_template.create({
            data: {
                ...data,
                branchId: branchid,
            },
        });
        return MessageTemplateMapper.toDomain(created);
    }

    async update(branchid: string, template: MessageTemplateEntity): Promise<MessageTemplateEntity> {
        const result = await this.prismaService.message_template.updateMany({
            where: { id: template.id, branchId: branchid },
            data: MessageTemplateMapper.toPrismaUpdate(template),
        });
        if (result.count === 0) {
            throw new Error("Message template not found for branch");
        }
        const updated = await this.prismaService.message_template.findFirst({
            where: { id: template.id, branchId: branchid },
        });
        if (!updated) {
            throw new Error("Message template not found after update");
        }
        return MessageTemplateMapper.toDomain(updated);
    }

    async delete(branchid: string, id: string): Promise<void> {
        const result = await this.prismaService.message_template.deleteMany({
            where: { id, branchId: branchid },
        });
        if (result.count === 0) {
            throw new Error("Message template not found for branch");
        }
    }
}
