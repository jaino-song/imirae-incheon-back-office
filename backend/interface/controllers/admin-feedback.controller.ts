import {
    Controller,
    ForbiddenException,
    Get,
    Param,
    Query,
    Request,
    UseGuards,
    NotFoundException,
    ParseIntPipe,
    DefaultValuePipe,
} from '@nestjs/common';
import { JwtGuard } from 'infrastructure/auth/jwt.guard';
import { OwnerOrAdminGuard } from 'infrastructure/auth/owner-or-admin.guard';
import { ChatFeedbackRepository } from 'infrastructure/database/repositories/chat-feedback.repository';
import {
    PaginatedFeedbackDto,
    FeedbackStatsDto,
    FeedbackDetailDto,
    FeedbackItemDto,
} from 'interface/dto/admin-feedback.dto';

@Controller('admin/feedback')
@UseGuards(JwtGuard, OwnerOrAdminGuard)
export class AdminFeedbackController {
    constructor(
        private readonly feedbackRepository: ChatFeedbackRepository,
    ) {}

    @Get()
    async listFeedback(
        @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
        @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number,
        @Query('type') type: 'positive' | 'negative' | undefined,
        @Request() req: any,
    ): Promise<PaginatedFeedbackDto> {
        const branchId = this.requireBranchId(req);
        const { data, total } = await this.feedbackRepository.findManyWithPagination({
            page,
            limit,
            type,
            branchId,
        });

        const feedbackItems: FeedbackItemDto[] = data.map((feedback: any) => ({
            id: feedback.id,
            type: feedback.type as 'positive' | 'negative',
            comment: feedback.comment,
            createdAt: feedback.createdAt,
            user: {
                id: feedback.user.id,
                name: feedback.user.name,
                email: feedback.user.email,
            },
            message: {
                id: feedback.chatMessage.id,
                content: feedback.chatMessage.content,
                role: feedback.chatMessage.role,
                timestamp: feedback.chatMessage.timestamp,
            },
        }));

        const totalPages = Math.ceil(total / limit);

        return {
            data: feedbackItems,
            total,
            page,
            limit,
            totalPages,
        };
    }

    @Get('stats')
    async getStats(@Request() req: any): Promise<FeedbackStatsDto> {
        const branchId = this.requireBranchId(req);
        return this.feedbackRepository.getStats(branchId);
    }

    @Get(':id')
    async getFeedbackDetail(@Param('id') id: string, @Request() req: any): Promise<FeedbackDetailDto> {
        const branchId = this.requireBranchId(req);
        const feedback = await this.feedbackRepository.findById(id, branchId);

        if (!feedback) {
            throw new NotFoundException('Feedback not found');
        }

        const f = feedback as any;
        return {
            id: f.id,
            type: f.type as 'positive' | 'negative',
            comment: f.comment,
            createdAt: f.createdAt,
            user: {
                id: f.user.id,
                name: f.user.name,
                email: f.user.email,
            },
            message: {
                id: f.chatMessage.id,
                content: f.chatMessage.content,
                role: f.chatMessage.role,
                timestamp: f.chatMessage.timestamp,
            },
            session: {
                id: f.chatSession.id,
                messages: f.chatSession.messages.map((msg: any) => ({
                    id: msg.id,
                    role: msg.role,
                    content: msg.content,
                    timestamp: msg.timestamp,
                })),
            },
        };
    }

    // The caller's branch comes only from the JWT-derived session (request.user.branchId,
    // populated by JwtStrategy once POST /auth/select-branch has run) — never from a
    // client-supplied value. Fail closed rather than let an unresolved branch reach a Prisma
    // query, where an `undefined` filter key would silently be dropped and become "no filter".
    private requireBranchId(req: any): string {
        const branchId = req.user?.branchId;
        if (!branchId) {
            throw new ForbiddenException('Branch selection required');
        }
        return branchId;
    }
}
