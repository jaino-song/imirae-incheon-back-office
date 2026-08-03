import { z } from "zod";
export declare const AgentCapabilityMetaSchema: z.ZodObject<{
    name: z.ZodString;
    domain: z.ZodString;
    version: z.ZodString;
    description: z.ZodString;
    risk: z.ZodEnum<{
        read: "read";
        "reversible-write": "reversible-write";
        "irreversible-write": "irreversible-write";
        "external-side-effect": "external-side-effect";
        "paid-action": "paid-action";
        "privileged-administration": "privileged-administration";
    }>;
    requiredRoles: z.ZodArray<z.ZodString>;
    renderer: z.ZodEnum<{
        error: "error";
        text: "text";
        activity: "activity";
        "entity-choice": "entity-choice";
        "action-proposal": "action-proposal";
        "action-result": "action-result";
        navigation: "navigation";
        attachment: "attachment";
        form: "form";
        feedback: "feedback";
    }>;
    flagKey: z.ZodString;
    sideEffect: z.ZodBoolean;
    approvalPolicy: z.ZodOptional<z.ZodEnum<{
        structured: "structured";
        strong: "strong";
    }>>;
    idempotencyPolicy: z.ZodOptional<z.ZodEnum<{
        "action-id": "action-id";
        "provider-key": "provider-key";
    }>>;
    inputSchemaHash: z.ZodOptional<z.ZodString>;
    outputSchemaHash: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
export type AgentCapabilityMeta = z.infer<typeof AgentCapabilityMetaSchema>;
