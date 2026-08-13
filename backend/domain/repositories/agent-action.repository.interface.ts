import type { AgentActionRisk, AgentActionStatus } from "@babyjamjam/shared";

import type { AgentActionEntity, AgentActionOwner } from "domain/entities/agent-action.entity";

export interface CreateAgentActionInput extends AgentActionOwner {
    id: string;
    sessionId: string;
    capability: string;
    capabilityVersion: string;
    risk: AgentActionRisk;
    status: AgentActionStatus;
    proposal: Record<string, unknown>;
    proposalRevision: string;
    inputHash: string;
    targetSnapshot?: Record<string, unknown> | null;
    targetVersion?: string | null;
    authorizationContext: Record<string, unknown>;
    expiresAt: Date;
    idempotencyKey: string;
    requestDedupeKey: string;
    dedupeExpiresAt: Date;
}

export type AgentActionCreateResult =
    | { status: "created"; action: AgentActionEntity }
    | { status: "not_found" | "archived" | "expired" };

export interface IAgentActionRepository {
    /**
     * Lock the owner-scoped session row and create the action before releasing
     * the lock. This serializes proposal creation with archive/delete checks.
     */
    createInActiveSession(input: CreateAgentActionInput): Promise<AgentActionCreateResult>;
}

export const AGENT_ACTION_REPOSITORY = Symbol("AGENT_ACTION_REPOSITORY");
