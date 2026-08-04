import type { BjjUIMessage } from "@babyjamjam/shared";

export interface AgentSessionOwner {
    userId: string;
    branchId: string;
}

export interface AgentSessionEntity extends AgentSessionOwner {
    id: string;
    locale: string;
    title: string | null;
    summary: string | null;
    selectedEntities: Record<string, unknown>;
    model: string;
    agentVersion: string;
    createdAt: Date;
    updatedAt: Date;
    expiresAt: Date;
    archivedAt: Date | null;
    messages: BjjUIMessage[];
}

export type AgentSessionSummary = Pick<
    AgentSessionEntity,
    "id" | "userId" | "branchId" | "locale" | "title" | "model" | "agentVersion"
    | "createdAt" | "updatedAt" | "expiresAt" | "archivedAt"
>;

export interface CreateAgentSessionInput extends AgentSessionOwner {
    locale: string;
    title?: string;
    model: string;
    agentVersion: string;
    expiresAt: Date;
}
