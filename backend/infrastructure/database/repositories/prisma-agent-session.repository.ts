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
    AgentSessionArchiveResult,
    AgentSessionDeleteResult,
    AgentSessionPatch,
    AgentSessionUnarchiveResult,
    IAgentSessionRepository,
} from "domain/repositories/agent-session.repository.interface";
import { PrismaService } from "infrastructure/database/prisma.service";

type AgentSessionRecord = Prisma.agent_sessionGetPayload<{ include: { messages: true } }>;
const ALWAYS_BLOCKING_ACTION_STATUSES = ["executing", "uncertain"];
const EXPIRABLE_ACTION_STATUSES = ["proposed", "approved"];
const TERMINAL_ACTION_STATUSES = ["succeeded", "failed", "uncertain", "rejected", "expired", "cancelled"];

function blockingActionWhere(now: Date, owner?: AgentSessionOwner, includeUnpersistedTerminal = false) {
    const ownerScope = owner ? { userId: owner.userId, branchId: owner.branchId } : {};
    const OR: Prisma.agent_actionWhereInput[] = [
        { ...ownerScope, status: { in: ALWAYS_BLOCKING_ACTION_STATUSES } },
        { ...ownerScope, status: { in: EXPIRABLE_ACTION_STATUSES }, expiresAt: { gt: now } },
    ];
    if (includeUnpersistedTerminal) {
        OR.push({ ...ownerScope, status: { in: TERMINAL_ACTION_STATUSES }, resultPartPersistedAt: null });
    }
    return { OR };
}

function isUniqueConstraintError(error: unknown): boolean {
    if (error instanceof Prisma.PrismaClientKnownRequestError) return error.code === "P2002";
    if (!error || typeof error !== "object" || !("code" in error)) return false;
    return error.code === "P2002";
}

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

    async archiveOwned(
        id: string,
        owner: AgentSessionOwner,
        archivedAt: Date,
    ): Promise<AgentSessionArchiveResult> {
        return this.prisma.$transaction(async (transaction) => {
            const locked = await transaction.$queryRaw<Array<{ id: string }>>(Prisma.sql`
                SELECT "id"
                FROM "agent_session"
                WHERE "id" = ${id}
                  AND "user_id" = ${owner.userId}
                  AND "branch_id" = ${owner.branchId}
                FOR UPDATE
            `);
            if (locked.length === 0) return "not_found";

            const blockingAction = await transaction.agent_action.findFirst({
                where: {
                    sessionId: id,
                    ...owner,
                    ...blockingActionWhere(new Date()),
                },
                select: { id: true },
            });
            if (blockingAction) return "blocked";

            await transaction.agent_session.updateMany({
                where: { id, ...owner, archivedAt: null },
                data: { archivedAt },
            });
            return "archived";
        });
    }

    async unarchiveOwned(id: string, owner: AgentSessionOwner): Promise<AgentSessionUnarchiveResult> {
        const result = await this.prisma.agent_session.updateMany({
            where: { id, ...owner, archivedAt: { not: null } },
            data: { archivedAt: null },
        });
        if (result.count === 1) return "unarchived";

        const session = await this.prisma.agent_session.findFirst({
            where: { id, ...owner },
            select: { id: true },
        });
        return session ? "unarchived" : "not_found";
    }

    async deleteOwned(id: string, owner: AgentSessionOwner): Promise<AgentSessionDeleteResult> {
        const now = new Date();
        const result = await this.prisma.agent_session.deleteMany({
            where: {
                id,
                ...owner,
                actions: { none: blockingActionWhere(now, owner, true) },
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
            // Branch-pinned like every other session write here: under
            // TENANT_ISOLATION_MODE=enforce an update whose `where` lacks
            // branchId is rejected as unpinned_write before it runs.
            this.prisma.agent_session.updateMany({
                where: { id, ...owner },
                data: { updatedAt: new Date() },
            }),
        ];
        if (title && !session.title) {
            operations.push(this.prisma.agent_session.updateMany({
                where: { id, ...owner, title: null },
                data: { title },
            }));
        }

        await this.prisma.$transaction(operations);
        return true;
    }

    async upsertActionResultMessage(
        id: string,
        owner: AgentSessionOwner,
        message: BjjUIMessage,
        traceId?: string,
    ): Promise<boolean> {
        try {
            return await this.prisma.$transaction((transaction) => this.persistActionResultMessage(
                transaction,
                id,
                owner,
                message,
                traceId,
                true,
            ));
        } catch (error) {
            // A concurrent deterministic insert can win after the initial
            // existence check. Retry in a fresh transaction because the
            // failed INSERT has already aborted the first transaction.
            if (!isUniqueConstraintError(error)) throw error;
            return this.prisma.$transaction((transaction) => this.persistActionResultMessage(
                transaction,
                id,
                owner,
                message,
                traceId,
                false,
            ));
        }
    }

    private async persistActionResultMessage(
        transaction: Prisma.TransactionClient,
        id: string,
        owner: AgentSessionOwner,
        message: BjjUIMessage,
        traceId: string | undefined,
        createIfMissing: boolean,
    ): Promise<boolean> {
        const session = await transaction.agent_session.findFirst({
            select: { id: true },
            where: { id, ...owner },
        });
        if (!session) return false;

        const messageId = message.id || randomUUID();
        const messageData = {
            id: messageId,
            sessionId: id,
            role: message.role,
            parts: message.parts as unknown as Prisma.InputJsonValue,
            ...(traceId === undefined ? {} : { traceId }),
        };
        const existing = await transaction.agent_message.findFirst({
            where: { id: messageId, sessionId: id },
            select: { id: true },
        });
        let persisted = false;
        if (existing || !createIfMissing) {
            const updated = await transaction.agent_message.updateMany({
                where: { id: messageId, sessionId: id },
                data: {
                    role: messageData.role,
                    parts: messageData.parts,
                    ...(traceId === undefined ? {} : { traceId }),
                },
            });
            persisted = updated.count === 1;
        } else {
            await transaction.agent_message.create({ data: messageData });
            persisted = true;
        }
        if (!persisted) return false;

        const refreshed = await transaction.agent_session.updateMany({
            where: { id, ...owner },
            data: { updatedAt: new Date(), summary: null },
        });
        return refreshed.count === 1;
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
                actions: { none: blockingActionWhere(now, undefined, true) },
            },
        })).count;
    }
}
