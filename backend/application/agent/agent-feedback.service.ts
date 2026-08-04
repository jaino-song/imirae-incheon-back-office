import { Injectable, NotFoundException } from "@nestjs/common";

import type { AgentSessionOwner } from "domain/entities/agent-session.entity";
import { PrismaService } from "infrastructure/database/prisma.service";

@Injectable()
export class AgentFeedbackService {
    constructor(private readonly prisma: PrismaService) {}

    async submit(input: { sessionId: string; messageId: string; type: "positive" | "negative"; comment?: string }, owner: AgentSessionOwner) {
        const message = await this.prisma.agent_message.findFirst({
            where: {
                id: input.messageId,
                sessionId: input.sessionId,
                role: "assistant",
                session: { userId: owner.userId, branchId: owner.branchId, archivedAt: null, expiresAt: { gt: new Date() } },
            },
            select: { id: true, traceId: true },
        });
        if (!message) throw new NotFoundException("Agent message not found");
        return this.prisma.agent_feedback.upsert({
            where: { messageId_userId: { messageId: message.id, userId: owner.userId } },
            create: {
                sessionId: input.sessionId,
                messageId: message.id,
                traceId: message.traceId,
                userId: owner.userId,
                branchId: owner.branchId,
                type: input.type,
                comment: input.comment,
            },
            update: { type: input.type, comment: input.comment, traceId: message.traceId },
            select: { id: true, type: true, createdAt: true },
        });
    }
}
