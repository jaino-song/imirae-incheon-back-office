import { Inject, Injectable } from "@nestjs/common";
import { ChatMessage } from "domain/entities/chat-session.entity";
import { CHAT_SESSION_REPOSITORY, IChatSessionRepository } from "domain/repositories/chat-session.repository.interface";
import { redactSensitiveLegacyChatContent } from "application/ai-chat/legacy-chat-confirmation.service";

export interface GetChatHistoryResult {
    messages: ChatMessage[];
    total: number;
    hasMore: boolean;
    sessionId: string | null;
    isSessionActive: boolean;
}

@Injectable()
export class GetChatHistoryUsecase {
    constructor(
        @Inject(CHAT_SESSION_REPOSITORY)
        private readonly sessionRepository: IChatSessionRepository,
    ) {}

    async execute(userId: string, offset: number, limit: number, branchId?: string): Promise<GetChatHistoryResult> {
        if (!branchId) {
            return {
                messages: [],
                total: 0,
                hasMore: false,
                sessionId: null,
                isSessionActive: false,
            };
        }

        const session = await this.sessionRepository.findActiveByUserId(userId, branchId);

        if (!session) {
            return {
                messages: [],
                total: 0,
                hasMore: false,
                sessionId: null,
                isSessionActive: false,
            };
        }

        const total = session.getTotalMessageCount();
        const messages = session.getMessagesPaginated(offset, limit);
        const hasMore = (total - offset - messages.length) > 0;
        const isSessionActive = !session.isExpired();

        return {
            messages: messages.map((message) => ({
                ...message,
                content: redactSensitiveLegacyChatContent(message.content),
            })),
            total,
            hasMore,
            sessionId: session.id,
            isSessionActive,
        };
    }
}
