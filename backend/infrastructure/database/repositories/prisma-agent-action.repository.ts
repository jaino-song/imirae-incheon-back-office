import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";

import type { AgentActionEntity } from "domain/entities/agent-action.entity";
import type {
    AgentActionCreateResult,
    CreateAgentActionInput,
    IAgentActionRepository,
} from "domain/repositories/agent-action.repository.interface";
import { PrismaService } from "infrastructure/database/prisma.service";

type AgentActionRecord = Prisma.agent_actionGetPayload<Prisma.agent_actionDefaultArgs>;

function jsonObject(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    return value as Record<string, unknown>;
}

function toEntity(record: AgentActionRecord): AgentActionEntity {
    return {
        id: record.id,
        sessionId: record.sessionId,
        userId: record.userId,
        branchId: record.branchId,
        capability: record.capability,
        capabilityVersion: record.capabilityVersion,
        risk: record.risk as AgentActionEntity["risk"],
        status: record.status as AgentActionEntity["status"],
        proposal: jsonObject(record.proposal),
        proposalRevision: record.proposalRevision,
        inputHash: record.inputHash,
        targetSnapshot: record.targetSnapshot ? jsonObject(record.targetSnapshot) : null,
        targetVersion: record.targetVersion,
        authorizationContext: jsonObject(record.authorizationContext),
        approvedBy: record.approvedBy,
        approvedAt: record.approvedAt,
        rejectedBy: record.rejectedBy,
        rejectedAt: record.rejectedAt,
        expiresAt: record.expiresAt,
        idempotencyKey: record.idempotencyKey,
        requestDedupeKey: record.requestDedupeKey,
        dedupeExpiresAt: record.dedupeExpiresAt,
        result: record.result,
        error: record.error ? jsonObject(record.error) : null,
        createdAt: record.createdAt,
        updatedAt: record.updatedAt,
        executedAt: record.executedAt,
        executionAttemptCount: record.executionAttemptCount,
        resultPartPersistedAt: record.resultPartPersistedAt,
    };
}

@Injectable()
export class PrismaAgentActionRepository implements IAgentActionRepository {
    constructor(private readonly prisma: PrismaService) {}

    async createInActiveSession(input: CreateAgentActionInput): Promise<AgentActionCreateResult> {
        const now = new Date();
        return this.prisma.$transaction(async (transaction) => {
            const locked = await transaction.$queryRaw<Array<{ id: string; archivedAt: Date | null; expiresAt: Date }>>(Prisma.sql`
                SELECT "id", "archived_at" AS "archivedAt", "expires_at" AS "expiresAt"
                FROM "agent_session"
                WHERE "id" = ${input.sessionId}
                  AND "user_id" = ${input.userId}
                  AND "branch_id" = ${input.branchId}
                FOR UPDATE
            `);
            const session = locked[0];
            if (!session) return { status: "not_found" };
            if (session.archivedAt) return { status: "archived" };
            if (session.expiresAt <= now) return { status: "expired" };

            const record = await transaction.agent_action.create({
                data: {
                    id: input.id,
                    sessionId: input.sessionId,
                    userId: input.userId,
                    branchId: input.branchId,
                    capability: input.capability,
                    capabilityVersion: input.capabilityVersion,
                    risk: input.risk,
                    status: input.status,
                    proposal: input.proposal as Prisma.InputJsonValue,
                    proposalRevision: input.proposalRevision,
                    inputHash: input.inputHash,
                    ...(input.targetSnapshot == null
                        ? {}
                        : { targetSnapshot: input.targetSnapshot as Prisma.InputJsonValue }),
                    targetVersion: input.targetVersion ?? null,
                    authorizationContext: input.authorizationContext as Prisma.InputJsonValue,
                    expiresAt: input.expiresAt,
                    idempotencyKey: input.idempotencyKey,
                    requestDedupeKey: input.requestDedupeKey,
                    dedupeExpiresAt: input.dedupeExpiresAt,
                },
            });
            return { status: "created", action: toEntity(record) };
        });
    }
}
