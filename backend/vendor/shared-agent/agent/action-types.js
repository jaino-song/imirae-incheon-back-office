"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RejectAgentActionRequestSchema = exports.ApproveAgentActionRequestSchema = exports.AgentActionStatusSchema = exports.AgentActionRiskSchema = void 0;
const zod_1 = require("zod");
exports.AgentActionRiskSchema = zod_1.z.enum([
    "read",
    "reversible-write",
    "irreversible-write",
    "external-side-effect",
    "paid-action",
    "privileged-administration",
]);
exports.AgentActionStatusSchema = zod_1.z.enum([
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
exports.ApproveAgentActionRequestSchema = zod_1.z.object({
    expectedRevision: zod_1.z.string().min(1),
});
exports.RejectAgentActionRequestSchema = zod_1.z.object({
    reason: zod_1.z.string().trim().min(1).max(500).optional(),
});
