import { IMessageRepository } from "domain/repositories/message.repository.interface";
import { MessageEntity } from "domain/entities/message.entity";
import { PrismaService } from "../prisma.service";
import { Injectable } from "@nestjs/common";
import { MessageMapper } from "../mapper/message.mapper";

@Injectable()
export class SbMessageRepository implements IMessageRepository {
    constructor(private prismaService: PrismaService) {}

    async findById(id: number): Promise<MessageEntity | null> {
        const message = await this.prismaService.message.findUnique({
            where: { id },
        });
        return message ? MessageMapper.toDomain(message) : null;
    }

    async create(message: MessageEntity): Promise<MessageEntity> {
        const created = await this.prismaService.message.create({
            data: MessageMapper.toPrismaCreate(message),
        });
        return MessageMapper.toDomain(created);
    }

    async update(message: MessageEntity): Promise<MessageEntity> {
        const updated = await this.prismaService.message.update({
            where: { id: message.id },
            data: MessageMapper.toPrismaUpdate(message),
        });
        return MessageMapper.toDomain(updated);
    }

    async delete(id: number): Promise<void> {
        await this.prismaService.message.delete({
            where: { id },
        });
    }
}