import { IMessageRepository } from "domain/repositories/message.repository.interface";
import { MessageEntity } from "domain/entities/message.entity";
import { PrismaService } from "../prisma.service";
import { Injectable } from "@nestjs/common";

@Injectable()
export class SbMessageRepository implements IMessageRepository {
    constructor(private prismaService: PrismaService) {}

    async findById(id: number): Promise<MessageEntity | null> {
        const message = await this.prismaService.message.findUnique({
            where: { id },
        });
        return message ? MessageEntity.fromPrisma(message) : null;
    }

    async create(message: MessageEntity): Promise<MessageEntity> {
        const created = await this.prismaService.message.create({
            data: {
                title: message.title,
                text: message.text,
            },
        });
        return MessageEntity.fromPrisma(created);
    }

    async update(message: MessageEntity): Promise<MessageEntity> {
        const updated = await this.prismaService.message.update({
            where: { id: message.id },
            data: {
                title: message.title,
                text: message.text,
                edited_at: message.editedAt ?? null,
            },
        });
        return MessageEntity.fromPrisma(updated);
    }

    async delete(id: number): Promise<void> {
        await this.prismaService.message.delete({
            where: { id },
        });
    }
}