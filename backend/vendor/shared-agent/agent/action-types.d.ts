import { z } from "zod";
export declare const AgentActionRiskSchema: z.ZodEnum<{
    read: "read";
    "reversible-write": "reversible-write";
    "irreversible-write": "irreversible-write";
    "external-side-effect": "external-side-effect";
    "paid-action": "paid-action";
    "privileged-administration": "privileged-administration";
}>;
export type AgentActionRisk = z.infer<typeof AgentActionRiskSchema>;
export declare const AgentActionStatusSchema: z.ZodEnum<{
    proposed: "proposed";
    approved: "approved";
    rejected: "rejected";
    executing: "executing";
    succeeded: "succeeded";
    failed: "failed";
    expired: "expired";
    uncertain: "uncertain";
    cancelled: "cancelled";
}>;
export type AgentActionStatus = z.infer<typeof AgentActionStatusSchema>;
export declare const ApproveAgentActionRequestSchema: z.ZodObject<{
    expectedRevision: z.ZodString;
}, z.core.$strip>;
export interface ApproveAgentActionRequest extends z.infer<typeof ApproveAgentActionRequestSchema> {
}
export declare const RejectAgentActionRequestSchema: z.ZodObject<{
    reason: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
export interface RejectAgentActionRequest extends z.infer<typeof RejectAgentActionRequestSchema> {
}
