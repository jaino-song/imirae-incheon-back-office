import { Injectable } from "@nestjs/common";
import { IChatSessionRepository } from "domain/repositories/chat-session.repository.interface";
import { ChatSessionEntity } from "domain/entities/chat-session.entity";
import { PrismaService } from "../prisma.service";
import { ChatSessionMapper } from "../mapper/chat-session.mapper";
import { randomUUID } from "crypto";

@Injectable()
export class SbChatSessionRepository implements IChatSessionRepository {
    constructor(private prismaService: PrismaService) {}

    async findById(id: string, userId?: string, branchId?: string): Promise<ChatSessionEntity | null> {
        // A session created before branch binding has a NULL branch_id. Never
        // return it through a caller that omitted the tenant tuple.
        if (!userId || !branchId) {
            return null;
        }

        const session = await this.prismaService.chat_session.findFirst({
            where: { id, userId, branchId },
            include: { messages: { orderBy: { timestamp: 'asc' } } },
        });
        if (!session) return null;
        
        const entity = ChatSessionMapper.toDomain(session);
        return entity.isExpired() ? null : entity;
    }

    async findByUserId(userId: string, branchId?: string): Promise<ChatSessionEntity | null> {
        if (!branchId) {
            return null;
        }

        const session = await this.prismaService.chat_session.findFirst({
            where: { userId, branchId },
            orderBy: { createdAt: 'desc' },
            include: { messages: { orderBy: { timestamp: 'asc' } } },
        });
        return session ? ChatSessionMapper.toDomain(session) : null;
    }

    async findActiveByUserId(userId: string, branchId?: string): Promise<ChatSessionEntity | null> {
        if (!branchId) {
            return null;
        }

        const now = new Date();
        const session = await this.prismaService.chat_session.findFirst({
            where: {
                userId,
                branchId,
                expiresAt: { gt: now },
            },
            orderBy: { createdAt: 'desc' },
            include: { messages: { orderBy: { timestamp: 'asc' } } },
        });
        return session ? ChatSessionMapper.toDomain(session) : null;
    }

    async create(session: ChatSessionEntity): Promise<ChatSessionEntity> {
        if (!session.branchId) {
            throw new Error("Branch-bound chat sessions are required");
        }

        const created = await this.prismaService.chat_session.create({
            data: {
                // Some DB environments miss default UUID generators on chat tables.
                // Generate IDs in-app to avoid hard failures in production chat.
                id: randomUUID(),
                ...ChatSessionMapper.toPrismaCreate(session),
            },
            include: { messages: true },
        });
        return ChatSessionMapper.toDomain(created);
    }

    async update(session: ChatSessionEntity, userId?: string, branchId?: string): Promise<ChatSessionEntity> {
        const ownerUserId = userId ?? session.userId;
        const ownerBranchId = branchId ?? session.branchId ?? undefined;
        if (!ownerUserId || !ownerBranchId) {
            throw new Error("Branch-bound chat sessions are required");
        }

        // Get existing messages count
        const existing = await this.prismaService.chat_message.count({
            where: { sessionId: session.id },
        });
        
        // Create new messages (those beyond existing count)
        const newMessages = session.messages.slice(existing);
        
        if (newMessages.length > 0) {
            const ownedSession = await this.prismaService.chat_session.findFirst({
                where: { id: session.id, userId: ownerUserId, branchId: ownerBranchId },
                select: { id: true },
            });
            if (!ownedSession) {
                throw new Error("Chat session not found");
            }

            await this.prismaService.chat_message.createMany({
                data: newMessages.map(m => ({
                    id: randomUUID(),
                    ...ChatSessionMapper.toPrismaCreateMessage(session.id, m),
                })),
            });
        }

        // Update session expiry
        const updateResult = await this.prismaService.chat_session.updateMany({
            where: { id: session.id, userId: ownerUserId, branchId: ownerBranchId },
            data: { expiresAt: session.expiresAt },
        });
        if (updateResult.count !== 1) {
            throw new Error("Chat session not found");
        }

        const updated = await this.prismaService.chat_session.findFirst({
            where: { id: session.id, userId: ownerUserId, branchId: ownerBranchId },
            include: { messages: { orderBy: { timestamp: 'asc' } } },
        });

        if (!updated) {
            throw new Error("Chat session not found");
        }
        
        return ChatSessionMapper.toDomain(updated);
    }

    async delete(id: string, userId?: string, branchId?: string): Promise<void> {
        if (!userId || !branchId) {
            throw new Error("Branch-bound chat sessions are required");
        }

        await this.prismaService.chat_session.deleteMany({
            where: { id, userId, branchId },
        });
    }

    async deleteExpired(): Promise<number> {
        const now = new Date();
        const result = await this.prismaService.chat_session.deleteMany({
            where: { expiresAt: { lt: now } },
        });
        return result.count;
    }

    async deleteOlderThan(cutoffDate: Date): Promise<number> {
        const result = await this.prismaService.chat_session.deleteMany({
            where: { createdAt: { lt: cutoffDate } },
        });
        return result.count;
    }
}
