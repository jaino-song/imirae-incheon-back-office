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
    archivedAt?: Date | null;
    expiresAt?: Date;
}

export interface IAgentSessionRepository {
    create(input: CreateAgentSessionInput): Promise<AgentSessionEntity>;
    list(owner: AgentSessionOwner): Promise<AgentSessionSummary[]>;
    findOwned(id: string, owner: AgentSessionOwner): Promise<AgentSessionEntity | null>;
    updateOwned(id: string, owner: AgentSessionOwner, patch: AgentSessionPatch): Promise<AgentSessionEntity | null>;
    deleteOwned(id: string, owner: AgentSessionOwner): Promise<boolean>;
    appendMessages(id: string, owner: AgentSessionOwner, messages: BjjUIMessage[], traceId?: string): Promise<boolean>;
    deleteExpired(now: Date): Promise<number>;
}

export const AGENT_SESSION_REPOSITORY = Symbol("AGENT_SESSION_REPOSITORY");
