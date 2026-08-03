import { z } from "zod";

export const AgentActionRiskSchema = z.enum([
    "read",
    "reversible-write",
    "irreversible-write",
    "external-side-effect",
    "paid-action",
    "privileged-administration",
]);

export type AgentActionRisk = z.infer<typeof AgentActionRiskSchema>;

export const AgentActionStatusSchema = z.enum([
    "proposed",
    "approved",
    "rejected",
    "executing",
    "succeeded",
    "failed",
    "expired",
    "uncertain",
    "cancelled",
]);

export type AgentActionStatus = z.infer<typeof AgentActionStatusSchema>;

export const ApproveAgentActionRequestSchema = z.object({
    expectedRevision: z.string().min(1),
});

export interface ApproveAgentActionRequest extends z.infer<typeof ApproveAgentActionRequestSchema> {}

export const RejectAgentActionRequestSchema = z.object({
    reason: z.string().trim().min(1).max(500).optional(),
});

export interface RejectAgentActionRequest extends z.infer<typeof RejectAgentActionRequestSchema> {}
