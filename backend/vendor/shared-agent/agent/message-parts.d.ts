import type { UIMessage } from "ai";
import { z } from "zod";
export declare const AgentRendererNameSchema: z.ZodEnum<{
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
export type AgentRendererName = z.infer<typeof AgentRendererNameSchema>;
export declare const AgentMessageMetadataSchema: z.ZodObject<{
    sessionId: z.ZodString;
    traceId: z.ZodString;
    createdAt: z.ZodISODateTime;
    model: z.ZodString;
    agentVersion: z.ZodString;
}, z.core.$strip>;
export interface AgentMessageMetadata extends z.infer<typeof AgentMessageMetadataSchema> {
}
export declare const AgentActivityPartSchema: z.ZodObject<{
    label: z.ZodString;
    status: z.ZodEnum<{
        succeeded: "succeeded";
        failed: "failed";
        pending: "pending";
        running: "running";
    }>;
    detail: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
export declare const AgentEntityChoicePartSchema: z.ZodObject<{
    entityType: z.ZodString;
    prompt: z.ZodString;
    choices: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        label: z.ZodString;
        description: z.ZodOptional<z.ZodString>;
        metadata: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
    }, z.core.$strip>>;
}, z.core.$strip>;
export declare const AgentActionProposalPartSchema: z.ZodObject<{
    actionId: z.ZodString;
    capability: z.ZodString;
    title: z.ZodString;
    summary: z.ZodString;
    expiresAt: z.ZodISODateTime;
    expectedRevision: z.ZodString;
    risk: z.ZodOptional<z.ZodString>;
    branchId: z.ZodOptional<z.ZodString>;
    target: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
    changes: z.ZodRecord<z.ZodString, z.ZodUnknown>;
    provider: z.ZodOptional<z.ZodString>;
    estimatedCost: z.ZodOptional<z.ZodString>;
    acknowledgementToken: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
export declare const AgentActionResultPartSchema: z.ZodObject<{
    actionId: z.ZodString;
    status: z.ZodEnum<{
        rejected: "rejected";
        succeeded: "succeeded";
        failed: "failed";
        expired: "expired";
        uncertain: "uncertain";
        cancelled: "cancelled";
    }>;
    summary: z.ZodString;
    result: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
    completedAt: z.ZodOptional<z.ZodISODateTime>;
    href: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
export declare const AgentNavigationPartSchema: z.ZodObject<{
    href: z.ZodString;
    label: z.ZodString;
}, z.core.$strip>;
export declare const AgentErrorPartSchema: z.ZodObject<{
    code: z.ZodString;
    category: z.ZodEnum<{
        model: "model";
        capability: "capability";
        provider: "provider";
        routing: "routing";
        validation: "validation";
        authorization: "authorization";
        persistence: "persistence";
        client: "client";
    }>;
    message: z.ZodString;
    retryable: z.ZodBoolean;
    effectState: z.ZodOptional<z.ZodEnum<{
        "nothing-happened": "nothing-happened";
        "succeeded-unconfirmed": "succeeded-unconfirmed";
        partial: "partial";
    }>>;
}, z.core.$strip>;
export declare const AgentAttachmentPartSchema: z.ZodObject<{
    id: z.ZodString;
    name: z.ZodString;
    mediaType: z.ZodString;
    size: z.ZodNumber;
}, z.core.$strip>;
export declare const AgentFormFieldSchema: z.ZodObject<{
    name: z.ZodString;
    label: z.ZodString;
    type: z.ZodEnum<{
        number: "number";
        boolean: "boolean";
        text: "text";
        date: "date";
        textarea: "textarea";
    }>;
    required: z.ZodOptional<z.ZodBoolean>;
}, z.core.$strip>;
export type AgentFormField = z.infer<typeof AgentFormFieldSchema>;
export declare const AgentFormPartSchema: z.ZodObject<{
    formId: z.ZodString;
    title: z.ZodString;
    schemaVersion: z.ZodString;
    fields: z.ZodOptional<z.ZodArray<z.ZodObject<{
        name: z.ZodString;
        label: z.ZodString;
        type: z.ZodEnum<{
            number: "number";
            boolean: "boolean";
            text: "text";
            date: "date";
            textarea: "textarea";
        }>;
        required: z.ZodOptional<z.ZodBoolean>;
    }, z.core.$strip>>>;
}, z.core.$strip>;
export declare const AgentFormSubmitPartSchema: z.ZodObject<{
    formId: z.ZodString;
    values: z.ZodRecord<z.ZodString, z.ZodUnknown>;
}, z.core.$strip>;
export declare const AgentFeedbackPartSchema: z.ZodObject<{
    messageId: z.ZodString;
    traceId: z.ZodOptional<z.ZodString>;
    prompt: z.ZodDefault<z.ZodString>;
}, z.core.$strip>;
export type AgentDataParts = {
    activity: z.infer<typeof AgentActivityPartSchema>;
    "entity-choice": z.infer<typeof AgentEntityChoicePartSchema>;
    "action-proposal": z.infer<typeof AgentActionProposalPartSchema>;
    "action-result": z.infer<typeof AgentActionResultPartSchema>;
    navigation: z.infer<typeof AgentNavigationPartSchema>;
    error: z.infer<typeof AgentErrorPartSchema>;
    attachment: z.infer<typeof AgentAttachmentPartSchema>;
    form: z.infer<typeof AgentFormPartSchema>;
    "form-submit": z.infer<typeof AgentFormSubmitPartSchema>;
    feedback: z.infer<typeof AgentFeedbackPartSchema>;
};
export type BjjUITools = Record<string, {
    input: unknown;
    output: unknown | undefined;
}>;
export type BjjUIMessage = UIMessage<AgentMessageMetadata, AgentDataParts, BjjUITools>;
