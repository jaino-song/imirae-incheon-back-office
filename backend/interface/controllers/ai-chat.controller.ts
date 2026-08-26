import {
    Controller,
    Post,
    Get,
    Delete,
    Body,
    Param,
    Query,
    Req,
    Res,
    UseGuards,
    HttpStatus,
    NotFoundException,
    BadRequestException,
    Logger,
    DefaultValuePipe,
    ParseIntPipe,
} from "@nestjs/common";
import { Request, Response } from "express";
import { AIChatService } from "application/services/ai-chat.service";
import { GetChatHistoryUsecase } from "application/usecases/ai-chat/get-chat-history.usecase";
import { CleanupChatSessionsUsecase } from "application/usecases/ai-chat/cleanup-chat-sessions.usecase";
import { ChatStreamDto, SessionIdParamDto, SessionResponse, ChatFeedbackDto, ChatPersistDto } from "interface/dto/ai-chat.dto";
import { JwtGuard } from "infrastructure/auth/jwt.guard";
import { AdminGuard } from "infrastructure/auth/admin.guard";
import { ChatFeedbackRepository } from "infrastructure/database/repositories/chat-feedback.repository";
import { PrismaService } from "infrastructure/database/prisma.service";
import { CurrentTenant, TenantGuard } from "infrastructure/tenant";

interface JwtUser {
    userId: string;
    role: string;
}

@Controller("ai/chat")
@UseGuards(JwtGuard)
export class AIChatController {
    private readonly logger = new Logger(AIChatController.name);

    constructor(
        private readonly aiChatService: AIChatService,
        private readonly getChatHistoryUsecase: GetChatHistoryUsecase,
        private readonly cleanupChatSessionsUsecase: CleanupChatSessionsUsecase,
        private readonly chatFeedbackRepository: ChatFeedbackRepository,
        private readonly prisma: PrismaService,
    ) {}

    // TenantGuard is what populates `request.tenant`; without it `@CurrentTenant()`
    // resolves to undefined and reading `tenant.branchId` below throws, which the
    // catch block reports to the client as an SSE `error` event.
    @Post("stream")
    @UseGuards(TenantGuard)
    async streamChat(
        @Body() dto: ChatStreamDto,
        @Req() req: Request,
        @Res() res: Response,
        @CurrentTenant() tenant: { branchId?: string },
    ): Promise<void> {
        const user = req.user as JwtUser;
        const userId = user.userId;

        res.setHeader("Content-Type", "text/event-stream");
        res.setHeader("Cache-Control", "no-cache");
        res.setHeader("Connection", "keep-alive");
        res.setHeader("X-Accel-Buffering", "no");
        res.flushHeaders();

        const streamAbortController = new AbortController();
        const abortStream = (): void => {
            streamAbortController.abort(new Error("AI chat client disconnected"));
        };
        res.once("close", abortStream);

        try {
            const stream = this.aiChatService.chatStream(
                dto.sessionId,
                userId,
                dto.message,
                tenant.branchId ?? "",
                streamAbortController.signal,
            );

            for await (const chunk of stream) {
                if (streamAbortController.signal.aborted) {
                    return;
                }
                const eventType = chunk.type === "error" ? "error" : "message";
                res.write(`event: ${eventType}\ndata: ${JSON.stringify(chunk)}\n\n`);
            }

            res.end();
        } catch (error) {
            if (streamAbortController.signal.aborted) {
                return;
            }
            this.logger.error(`Stream error: ${error}`);
            const errorMessage = error instanceof Error ? error.message : "Unknown error";
            res.write(`event: error\ndata: ${JSON.stringify({ type: "error", error: errorMessage })}\n\n`);
            res.end();
        } finally {
            res.off("close", abortStream);
        }
    }

    @Get("sessions/:id")
    async getSession(
        @Param() params: SessionIdParamDto,
        @Req() req: Request,
    ): Promise<SessionResponse> {
        const user = req.user as JwtUser;
        const session = await this.aiChatService.getSession(params.id);

        if (!session) {
            throw new NotFoundException("Session not found or expired");
        }

        if (session.userId !== user.userId) {
            throw new NotFoundException("Session not found");
        }

        return {
            id: session.id,
            userId: session.userId,
            messages: session.messages.map((m) => ({
                role: m.role,
                content: m.content,
                timestamp: m.timestamp,
            })),
            createdAt: session.createdAt.toISOString(),
            expiresAt: session.expiresAt.toISOString(),
        };
    }

    @Get("history")
    async getChatHistory(
        @Query("offset", new DefaultValuePipe(0), ParseIntPipe) offset: number,
        @Query("limit", new DefaultValuePipe(20), ParseIntPipe) limit: number,
        @Req() req: Request,
    ) {
        if (offset < 0) {
            throw new BadRequestException("offset must be >= 0");
        }
        if (limit < 1 || limit > 50) {
            throw new BadRequestException("limit must be between 1 and 50");
        }

        const user = req.user as JwtUser;
        return this.getChatHistoryUsecase.execute(user.userId, offset, limit);
    }

    @Post("cleanup")
    @UseGuards(AdminGuard)
    async cleanupSessions() {
        return this.cleanupChatSessionsUsecase.execute();
    }

    @Delete("sessions/:id")
    async deleteSession(
        @Param() params: SessionIdParamDto,
        @Req() req: Request,
        @Res() res: Response,
    ): Promise<void> {
        const user = req.user as JwtUser;
        const session = await this.aiChatService.getSession(params.id);

        if (!session) {
            throw new NotFoundException("Session not found");
        }

        if (session.userId !== user.userId) {
            throw new NotFoundException("Session not found");
        }

        await this.aiChatService.deleteSession(params.id);
        res.status(HttpStatus.NO_CONTENT).send();
    }

    @Post("feedback")
    async submitFeedback(
        @Body() dto: ChatFeedbackDto,
        @Req() req: Request,
    ): Promise<{ success: boolean; id: string }> {
        const user = req.user as JwtUser;

        // Find the session and verify it exists
        const session = await this.prisma.chat_session.findUnique({
            where: { id: dto.sessionId },
            include: { messages: { orderBy: { timestamp: 'asc' } } },
        });

        if (!session) {
            throw new NotFoundException("Session not found");
        }

        // Ensure users can only submit feedback for their own sessions
        if (session.userId !== user.userId) {
            throw new NotFoundException("Session not found");
        }

        // Accept both messageId (preferred) and messageIndex (backward compatibility).
        let message = dto.messageId
            ? session.messages.find((m) => m.id === dto.messageId)
            : undefined;

        if (!message && dto.messageIndex !== undefined) {
            message = session.messages[dto.messageIndex];
        }

        if (!message) {
            throw new NotFoundException("Message not found");
        }

        // Save feedback to database
        const feedback = await this.chatFeedbackRepository.create({
            sessionId: dto.sessionId,
            messageId: message.id,
            userId: user.userId,
            type: dto.type,
            comment: dto.comment,
        });

        this.logger.log(`Feedback saved: ${feedback.id} - ${dto.type} for session ${dto.sessionId}`);

        return { success: true, id: feedback.id };
    }

    @Post("persist")
    async persistMessages(
        @Body() dto: ChatPersistDto,
        @Req() req: Request,
    ): Promise<{ sessionId: string }> {
        const user = req.user as JwtUser;
        return this.aiChatService.persistMessages(
            dto.sessionId,
            user.userId,
            dto.userMessage,
            dto.assistantContent,
        );
    }
}
