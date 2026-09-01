import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma.service";
import { nanoid } from "nanoid";

export interface CreateFeedbackDto {
    sessionId: string;
    messageId: string;
    userId: string;
    type: "positive" | "negative";
    comment?: string;
}

@Injectable()
export class ChatFeedbackRepository {
    constructor(private prisma: PrismaService) {}

    async create(data: CreateFeedbackDto) {
        return this.prisma.chat_feedback.create({
            data: {
                id: nanoid(),
                sessionId: data.sessionId,
                messageId: data.messageId,
                userId: data.userId,
                type: data.type,
                comment: data.comment,
            },
            include: {
                chatSession: {
                    include: { messages: { orderBy: { timestamp: 'asc' } } },
                },
                chatMessage: true,
                user: { select: { id: true, name: true, email: true } },
            },
        });
    }

    // `chat_feedback` has no branch_id column, so branch scoping (the admin analytics path,
    // AdminFeedbackController) is a nested relation filter through `chatSession` rather than a
    // direct `chat_session` query — the latter would trip the tenant-isolation Prisma
    // extension's `http_no_tenant` guard in enforce mode from this un-tenant-guarded route.
    // `chat_session.branchId` is nullable: feedback hanging off a null-branch session can never
    // satisfy `chatSession: { branchId }` for any concrete branch, so it is invisible to every
    // branch admin — fail closed, the same semantic applied to null-branch areas elsewhere.
    // branchId is required: an optional parameter would make the scoping fail
    // open by signature — a caller that forgets the argument silently gets an
    // unscoped lookup.
    async findById(id: string, branchId: string) {
        return this.prisma.chat_feedback.findFirst({
            where: { id, chatSession: { branchId } },
            include: {
                chatSession: {
                    include: { messages: { orderBy: { timestamp: 'asc' } } },
                },
                chatMessage: true,
                user: { select: { id: true, name: true, email: true } },
            },
        });
    }

    async findBySession(sessionId: string) {
        return this.prisma.chat_feedback.findMany({
            where: { sessionId: sessionId },
            include: { chatMessage: true },
            orderBy: { createdAt: 'desc' },
        });
    }

    async findManyWithPagination(params: {
        page: number;
        limit: number;
        type?: 'positive' | 'negative';
        branchId: string;
    }) {
        const { page, limit, type, branchId } = params;
        const skip = (page - 1) * limit;

        // Nested relation filter through chatSession — see the findById comment above for why
        // this can't be a direct chat_session query, and why a null-branch session's feedback
        // is fail-closed invisible here.
        const where = { ...(type ? { type } : {}), chatSession: { branchId } };

        const [data, total] = await Promise.all([
            this.prisma.chat_feedback.findMany({
                where,
                skip,
                take: limit,
                orderBy: { createdAt: 'desc' },
                include: {
                    user: { select: { id: true, name: true, email: true } },
                    chatMessage: true,
                },
            }),
            this.prisma.chat_feedback.count({ where }),
        ]);

        return { data, total };
    }

    async getStats(branchId: string) {
        // See the findById comment above: nested relation filter, fail-closed on a null-branch
        // session's feedback.
        const where = { chatSession: { branchId } };
        const [positive, negative, total] = await Promise.all([
            this.prisma.chat_feedback.count({ where: { ...where, type: 'positive' } }),
            this.prisma.chat_feedback.count({ where: { ...where, type: 'negative' } }),
            this.prisma.chat_feedback.count({ where }),
        ]);

        return { positive, negative, total };
    }
}
