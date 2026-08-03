import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { randomUUID } from "crypto";

import type { BjjUIMessage } from "@babyjamjam/shared";
import type {
    AgentSessionEntity,
    AgentSessionOwner,
    AgentSessionSummary,
    CreateAgentSessionInput,
} from "domain/entities/agent-session.entity";
import type {
    AgentSessionDeleteResult,
    AgentSessionPatch,
    IAgentSessionRepository,
} from "domain/repositories/agent-session.repository.interface";
import { PrismaService } from "infrastructure/database/prisma.service";

type AgentSessionRecord = Prisma.agent_sessionGetPayload<{ include: { messages: true } }>;
const NONTERMINAL_ACTION_STATUSES = ["proposed", "approved", "executing", "uncertain"];

function toEntity(record: AgentSessionRecord): AgentSessionEntity {
    return {
        ...record,
        title: record.title ?? null,
        summary: record.summary ?? null,
        archivedAt: record.archivedAt ?? null,
        selectedEntities: record.selectedEntities as Record<string, unknown>,
        messages: record.messages
            .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id))
            .map((message) => ({
                id: message.id,
                role: message.role as BjjUIMessage["role"],
                parts: message.parts as unknown as BjjUIMessage["parts"],
            })),
    };
}

@Injectable()
export class PrismaAgentSessionRepository implements IAgentSessionRepository {
    constructor(private readonly prisma: PrismaService) {}

    async create(input: CreateAgentSessionInput): Promise<AgentSessionEntity> {
        const record = await this.prisma.agent_session.create({
            data: { id: randomUUID(), ...input, selectedEntities: {} },
            include: { messages: true },
        });
        return toEntity(record);
    }

    async list(owner: AgentSessionOwner): Promise<AgentSessionSummary[]> {
        const records = await this.prisma.agent_session.findMany({
            where: { ...owner, archivedAt: null, expiresAt: { gt: new Date() } },
            select: {
                id: true,
                userId: true,
                branchId: true,
                locale: true,
                title: true,
                model: true,
                agentVersion: true,
                createdAt: true,
                updatedAt: true,
                expiresAt: true,
                archivedAt: true,
            },
            orderBy: { updatedAt: "desc" },
            take: 100,
        });
        return records;
    }

    async findOwned(id: string, owner: AgentSessionOwner): Promise<AgentSessionEntity | null> {
        const record = await this.prisma.agent_session.findFirst({
            where: { id, ...owner, archivedAt: null, expiresAt: { gt: new Date() } },
            include: { messages: true },
        });
        return record ? toEntity(record) : null;
    }

    async updateOwned(
        id: string,
        owner: AgentSessionOwner,
        patch: AgentSessionPatch,
    ): Promise<AgentSessionEntity | null> {
        const data: Prisma.agent_sessionUpdateManyMutationInput = {
            ...patch,
            selectedEntities: patch.selectedEntities as Prisma.InputJsonValue | undefined,
        };
        const result = await this.prisma.agent_session.updateMany({ where: { id, ...owner }, data });
        if (result.count !== 1) return null;
        const record = await this.prisma.agent_session.findFirst({
            where: { id, ...owner, expiresAt: { gt: new Date() } },
            include: { messages: true },
        });
        return record ? toEntity(record) : null;
    }

    async deleteOwned(id: string, owner: AgentSessionOwner): Promise<AgentSessionDeleteResult> {
        const result = await this.prisma.agent_session.deleteMany({
            where: {
                id,
                ...owner,
                actions: { none: { status: { in: NONTERMINAL_ACTION_STATUSES } } },
            },
        });
        if (result.count === 1) return "deleted";
        const session = await this.prisma.agent_session.findFirst({ where: { id, ...owner }, select: { id: true } });
        return session ? "blocked" : "not_found";
    }

    async appendMessages(
        id: string,
        owner: AgentSessionOwner,
        messages: BjjUIMessage[],
        traceId?: string,
    ): Promise<boolean> {
        const session = await this.prisma.agent_session.findFirst({ select: { id: true, title: true }, where: { id, ...owner } });
        if (!session) return false;
        const title = this.titleFromMessages(messages);
        const timestamp = Date.now();
        const operations: Prisma.PrismaPromise<unknown>[] = [
            this.prisma.agent_message.createMany({
                data: messages.map((message, index) => ({
                    id: message.id || randomUUID(),
                    sessionId: id,
                    role: message.role,
                    parts: message.parts as unknown as Prisma.InputJsonValue,
                    traceId,
                    createdAt: new Date(timestamp + index),
                })),
                skipDuplicates: true,
            }),
            this.prisma.agent_session.update({
                where: { id },
                data: { updatedAt: new Date() },
            }),
        ];
        if (title && !session.title) {
            operations.push(this.prisma.agent_session.updateMany({
                where: { id, title: null },
                data: { title },
            }));
        }

        await this.prisma.$transaction(operations);
        return true;
    }

    private titleFromMessages(messages: BjjUIMessage[]): string | undefined {
        const text = messages.find((message) => message.role === "user")?.parts
            .filter((part): part is { type: "text"; text: string } => part.type === "text")
            .map((part) => part.text.trim())
            .filter(Boolean)
            .join(" ")
            .slice(0, 120);
        return text || undefined;
    }

    async deleteExpired(now: Date): Promise<number> {
        return (await this.prisma.agent_session.deleteMany({
            where: {
                expiresAt: { lte: now },
                actions: { none: { status: { in: NONTERMINAL_ACTION_STATUSES } } },
            },
        })).count;
    }
}
