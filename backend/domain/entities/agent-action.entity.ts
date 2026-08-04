import type { AgentActionRisk, AgentActionStatus } from "@babyjamjam/shared";

export interface AgentActionOwner {
    userId: string;
    branchId: string;
}

export interface AgentActionEntity extends AgentActionOwner {
    id: string;
    sessionId: string;
    capability: string;
    capabilityVersion: string;
    risk: AgentActionRisk;
    status: AgentActionStatus;
    proposal: Record<string, unknown>;
    proposalRevision: string;
    inputHash: string;
    targetSnapshot: Record<string, unknown> | null;
    targetVersion: string | null;
    authorizationContext: Record<string, unknown>;
    approvedBy: string | null;
    approvedAt: Date | null;
    rejectedBy: string | null;
    rejectedAt: Date | null;
    expiresAt: Date;
    idempotencyKey: string;
    requestDedupeKey: string;
    dedupeExpiresAt: Date;
    result: unknown;
    error: Record<string, unknown> | null;
    createdAt: Date;
    updatedAt: Date;
    executedAt: Date | null;
    executionAttemptCount: number;
    resultPartPersistedAt: Date | null;
}
