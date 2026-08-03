import type {
    AgentSessionEntity,
    AgentSessionOwner,
    AgentSessionSummary,
    CreateAgentSessionInput,
} from "domain/entities/agent-session.entity";
import type { BjjUIMessage } from "@babyjamjam/shared";

export interface AgentSessionPatch {
    title?: string | null;
    summary?: string | null;
    locale?: string;
    selectedEntities?: Record<string, unknown>;
    expiresAt?: Date;
}

export type AgentSessionDeleteResult = "deleted" | "blocked" | "not_found";
export type AgentSessionArchiveResult = "archived" | "blocked" | "not_found";
export type AgentSessionUnarchiveResult = "unarchived" | "not_found";

export interface IAgentSessionRepository {
    create(input: CreateAgentSessionInput): Promise<AgentSessionEntity>;
    list(owner: AgentSessionOwner): Promise<AgentSessionSummary[]>;
    findOwned(id: string, owner: AgentSessionOwner): Promise<AgentSessionEntity | null>;
    updateOwned(id: string, owner: AgentSessionOwner, patch: AgentSessionPatch): Promise<AgentSessionEntity | null>;
    archiveOwned(id: string, owner: AgentSessionOwner, archivedAt: Date): Promise<AgentSessionArchiveResult>;
    unarchiveOwned(id: string, owner: AgentSessionOwner): Promise<AgentSessionUnarchiveResult>;
    deleteOwned(id: string, owner: AgentSessionOwner): Promise<AgentSessionDeleteResult>;
    appendMessages(id: string, owner: AgentSessionOwner, messages: BjjUIMessage[], traceId?: string): Promise<boolean>;
    upsertActionResultMessage(
        id: string,
        owner: AgentSessionOwner,
        message: BjjUIMessage,
        traceId?: string,
    ): Promise<boolean>;
    deleteExpired(now: Date): Promise<number>;
}

export const AGENT_SESSION_REPOSITORY = Symbol("AGENT_SESSION_REPOSITORY");
