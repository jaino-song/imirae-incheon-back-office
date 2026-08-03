import type { AgentCapabilityMeta, AgentFormField } from "@babyjamjam/shared";
import type { z } from "zod";

import type { AgentContext } from "./agent-context";

export type AgentReconciliationOutcome =
    | { status: "succeeded"; result: unknown; reason?: string }
    | { status: "failed"; result?: unknown; reason?: string }
    | { status: "uncertain"; reason?: string };

export type AgentExecutionOutcome =
    | { status: "succeeded" }
    | { status: "failed"; reason?: string }
    | { status: "cancelled"; reason?: string };

export type AgentTargetRevalidation = {
    valid: boolean;
    currentVersion?: string;
    reason?: string;
};

export type AgentProposalInspection = {
    targetVersion?: string;
    targetSnapshot?: Record<string, unknown>;
    title?: string;
    summary?: string;
    provider?: string;
    estimatedCost?: string;
};

export interface CapabilityDefinition<TInput = unknown, TOutput = unknown> {
    meta: AgentCapabilityMeta;
    inputSchema: z.ZodType<TInput>;
    outputSchema: z.ZodType<TOutput>;
    formFields?: AgentFormField[];
    /** Resolve immutable review details before the durable proposal is created. */
    inspect?(context: AgentContext, input: TInput): Promise<AgentProposalInspection>;
    execute(context: AgentContext, input: TInput): Promise<TOutput>;
    /**
     * Execute a versioned, approved target through the provider's atomic
     * compare-and-swap or durable staging boundary. The coordinator never
     * falls back to `execute` when an action carries a target version.
     */
    executeApprovedTarget?(context: AgentContext, input: TInput, expectedTargetVersion: string): Promise<TOutput>;
    /** Classify a schema-valid provider response whose transport succeeded. */
    classifyOutcome?(output: TOutput): AgentExecutionOutcome;
    /** Re-read the canonical target immediately before execution; it must not mutate state. */
    revalidate?(context: AgentContext, input: TInput, expectedTargetVersion: string): Promise<AgentTargetRevalidation>;
    /** Read-only provider-status lookup; implementations must never replay a side effect. */
    reconcile?(context: AgentContext, input: TInput, uncertainty: Record<string, unknown> | null): Promise<AgentReconciliationOutcome>;
    /**
     * Idempotently finish an exact, durably staged, already-authorized effect.
     * A provider call is allowed only when the staged operation is itself
     * idempotent; recovery must never create a new or broader side effect.
     */
    recover?(context: AgentContext, input: TInput, uncertainty: Record<string, unknown> | null): Promise<void>;
}

export interface AgentCapabilityProviderContract {
    getCapabilities(): CapabilityDefinition[];
}
