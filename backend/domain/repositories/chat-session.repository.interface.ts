import { ChatSessionEntity } from "../entities/chat-session.entity";

export interface IChatSessionRepository {
    /** Owner-scoped reads. Omitting branchId is fail-closed for legacy callers. */
    findById(id: string, userId?: string, branchId?: string): Promise<ChatSessionEntity | null>;
    findByUserId(userId: string, branchId?: string): Promise<ChatSessionEntity | null>;
    findActiveByUserId(userId: string, branchId?: string): Promise<ChatSessionEntity | null>;
    create(session: ChatSessionEntity): Promise<ChatSessionEntity>;
    update(session: ChatSessionEntity, userId?: string, branchId?: string): Promise<ChatSessionEntity>;
    delete(id: string, userId?: string, branchId?: string): Promise<void>;
    deleteExpired(): Promise<number>;
    deleteOlderThan(cutoffDate: Date): Promise<number>;
}

export const CHAT_SESSION_REPOSITORY = 'CHAT_SESSION_REPOSITORY';
