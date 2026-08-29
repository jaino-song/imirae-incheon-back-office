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
import { ChatStreamDto, SessionIdParamDto, SessionResponse, ChatFeedbackDto, ChatPersistDto, ChatConfirmDto } from "interface/dto/ai-chat.dto";
import { JwtGuard } from "infrastructure/auth/jwt.guard";
import { AdminGuard } from "infrastructure/auth/admin.guard";
import { ChatFeedbackRepository } from "infrastructure/database/repositories/chat-feedback.repository";
import { PrismaService } from "infrastructure/database/prisma.service";
import { CurrentTenant, TenantGuard } from "infrastructure/tenant";
import { redactSensitiveLegacyChatContent } from "application/ai-chat/legacy-chat-confirmation.service";
import type { VerifiedTenantPrincipal } from "infrastructure/tenant/tenant.context";
import { sanitizeEformsignErrorMessage } from "application/utils/eformsign-error-message";

interface JwtUser {
    userId: string;
    role: string;
}

type ChatTenant = VerifiedTenantPrincipal;

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
        @CurrentTenant() tenant: VerifiedTenantPrincipal,
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
                tenant.branchId,
                tenant,
                streamAbortController.signal,
                tenant,
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
            const errorMessage = sanitizeEformsignErrorMessage(error);
            const safeErrorMessage = redactSensitiveLegacyChatContent(errorMessage);
            res.write(`event: error\ndata: ${JSON.stringify({ type: "error", error: safeErrorMessage })}\n\n`);
            res.end();
        } finally {
            res.off("close", abortStream);
        }
    }

    @Get("sessions/:id")
    @UseGuards(TenantGuard)
    async getSession(
        @Param() params: SessionIdParamDto,
        @Req() req: Request,
        @CurrentTenant() tenant: ChatTenant,
    ): Promise<SessionResponse> {
        const user = req.user as JwtUser;
        const session = await this.aiChatService.getSession(params.id, user.userId, tenant.branchId);

        if (!session) {
            throw new NotFoundException("Session not found or expired");
        }

        return {
            id: session.id,
            userId: session.userId,
            messages: session.messages.map((m) => ({
                role: m.role,
                content: redactSensitiveLegacyChatContent(m.content),
                timestamp: m.timestamp,
            })),
            createdAt: session.createdAt.toISOString(),
            expiresAt: session.expiresAt.toISOString(),
        };
    }

    @Get("history")
    @UseGuards(TenantGuard)
    async getChatHistory(
        @Query("offset", new DefaultValuePipe(0), ParseIntPipe) offset: number,
        @Query("limit", new DefaultValuePipe(20), ParseIntPipe) limit: number,
        @Req() req: Request,
        @CurrentTenant() tenant: ChatTenant,
    ) {
        if (offset < 0) {
            throw new BadRequestException("offset must be >= 0");
        }
        if (limit < 1 || limit > 50) {
            throw new BadRequestException("limit must be between 1 and 50");
        }

        const user = req.user as JwtUser;
        return this.getChatHistoryUsecase.execute(user.userId, offset, limit, tenant.branchId);
    }

    @Post("cleanup")
    @UseGuards(AdminGuard)
    async cleanupSessions() {
        return this.cleanupChatSessionsUsecase.execute();
    }

    @Delete("sessions/:id")
    @UseGuards(TenantGuard)
    async deleteSession(
        @Param() params: SessionIdParamDto,
        @Req() req: Request,
        @Res() res: Response,
        @CurrentTenant() tenant: ChatTenant,
    ): Promise<void> {
        const user = req.user as JwtUser;
        const session = await this.aiChatService.getSession(params.id, user.userId, tenant.branchId);

        if (!session) {
            throw new NotFoundException("Session not found");
        }

        await this.aiChatService.deleteSession(params.id, user.userId, tenant.branchId);
        res.status(HttpStatus.NO_CONTENT).send();
    }

    @Post("feedback")
    @UseGuards(TenantGuard)
    async submitFeedback(
        @Body() dto: ChatFeedbackDto,
        @Req() req: Request,
        @CurrentTenant() tenant: ChatTenant,
    ): Promise<{ success: boolean; id: string }> {
        const user = req.user as JwtUser;

        // Find the session and verify it exists
        const session = await this.prisma.chat_session.findFirst({
            where: { id: dto.sessionId, userId: user.userId, branchId: tenant.branchId },
            include: { messages: { orderBy: { timestamp: 'asc' } } },
        });

        if (!session) {
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
    @UseGuards(TenantGuard)
    async persistMessages(
        @Body() dto: ChatPersistDto,
        @Req() req: Request,
        @CurrentTenant() tenant: ChatTenant,
    ): Promise<{ sessionId: string }> {
        const user = req.user as JwtUser;
        return this.aiChatService.persistMessages(
            dto.sessionId,
            user.userId,
            dto.userMessage,
            dto.assistantContent,
            tenant.branchId,
        );
    }

    @Post("confirm")
    @UseGuards(TenantGuard)
    async confirmToolAction(
        @Body() dto: ChatConfirmDto,
        @Req() req: Request,
        @CurrentTenant() tenant: ChatTenant,
    ): Promise<unknown> {
        const user = req.user as JwtUser;
        return this.aiChatService.confirmToolAction(
            user.userId,
            tenant.branchId,
            { intentId: dto.intentId, nonce: dto.nonce },
            dto.sessionId,
            tenant,
        );
    }
}
