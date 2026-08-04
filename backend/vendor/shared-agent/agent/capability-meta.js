"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AgentCapabilityMetaSchema = void 0;
const zod_1 = require("zod");
const action_types_1 = require("./action-types");
const message_parts_1 = require("./message-parts");
const SEMVER_PATTERN = /^\d+\.\d+\.\d+$/;
exports.AgentCapabilityMetaSchema = zod_1.z.object({
    name: zod_1.z.string().regex(/^[a-z][a-z0-9-]*\.[a-z][a-zA-Z0-9]*$/),
    domain: zod_1.z.string().regex(/^[a-z][a-z0-9-]*$/),
    version: zod_1.z.string().regex(SEMVER_PATTERN),
    description: zod_1.z.string().min(1),
    risk: action_types_1.AgentActionRiskSchema,
    requiredRoles: zod_1.z.array(zod_1.z.string().min(1)).min(1),
    renderer: message_parts_1.AgentRendererNameSchema,
    flagKey: zod_1.z.string().startsWith("agent.capability."),
    sideEffect: zod_1.z.boolean(),
    approvalPolicy: zod_1.z.enum(["structured", "strong"]).optional(),
    idempotencyPolicy: zod_1.z.enum(["action-id", "provider-key"]).optional(),
    inputSchemaHash: zod_1.z.string().min(1).optional(),
    outputSchemaHash: zod_1.z.string().min(1).optional(),
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
