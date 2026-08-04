import { z } from "zod";

import { AgentActionRiskSchema } from "./action-types";
import { AgentRendererNameSchema } from "./message-parts";

const SEMVER_PATTERN = /^\d+\.\d+\.\d+$/;

export const AgentCapabilityMetaSchema = z.object({
    name: z.string().regex(/^[a-z][a-z0-9-]*\.[a-z][a-zA-Z0-9]*$/),
    domain: z.string().regex(/^[a-z][a-z0-9-]*$/),
    version: z.string().regex(SEMVER_PATTERN),
    description: z.string().min(1),
    risk: AgentActionRiskSchema,
    requiredRoles: z.array(z.string().min(1)).min(1),
    renderer: AgentRendererNameSchema,
    flagKey: z.string().startsWith("agent.capability."),
    sideEffect: z.boolean(),
    approvalPolicy: z.enum(["structured", "strong"]).optional(),
    idempotencyPolicy: z.enum(["action-id", "provider-key"]).optional(),
    inputSchemaHash: z.string().min(1).optional(),
    outputSchemaHash: z.string().min(1).optional(),
}).superRefine((value, context) => {
    const isRead = value.risk === "read";

    if (isRead && value.sideEffect) {
        context.addIssue({
            code: "custom",
            message: "Read capabilities cannot declare a side effect",
            path: ["sideEffect"],
        });
    }

    if (!isRead && !value.sideEffect) {
        context.addIssue({
            code: "custom",
            message: "Write capabilities must declare a side effect",
            path: ["sideEffect"],
        });
    }

    if (!isRead && !value.approvalPolicy) {
        context.addIssue({
            code: "custom",
            message: "Write capabilities require an approval policy",
            path: ["approvalPolicy"],
        });
    }

    if (!isRead && !value.idempotencyPolicy) {
        context.addIssue({
            code: "custom",
            message: "Write capabilities require an idempotency policy",
            path: ["idempotencyPolicy"],
        });
    }
});

export type AgentCapabilityMeta = z.infer<typeof AgentCapabilityMetaSchema>;
