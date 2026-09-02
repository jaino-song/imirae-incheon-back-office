import { ChatSessionEntity, ChatMessage } from "domain/entities/chat-session.entity";
import { chat_session, chat_message } from "@prisma/client";

type ChatSessionWithMessages = chat_session & {
    messages: chat_message[];
};

export class ChatSessionMapper {
    static toDomain(row: ChatSessionWithMessages): ChatSessionEntity {
        const messages: ChatMessage[] = row.messages.map(m => ({
            role: m.role as 'user' | 'assistant' | 'system',
            content: m.content,
            timestamp: m.timestamp.toISOString(),
        }));

        return ChatSessionEntity.reconstitute(
            row.id,
            row.userId,
            messages,
            row.createdAt,
            row.expiresAt,
            row.branchId,
        );
    }

    static toPrismaCreate(entity: ChatSessionEntity) {
        return {
            userId: entity.userId,
            branchId: entity.branchId,
            expiresAt: entity.expiresAt,
        };
    }

    static toPrismaCreateMessage(sessionId: string, message: ChatMessage) {
        return {
            sessionId: sessionId,
            role: message.role,
            content: message.content,
            timestamp: new Date(message.timestamp),
        };
    }
}
