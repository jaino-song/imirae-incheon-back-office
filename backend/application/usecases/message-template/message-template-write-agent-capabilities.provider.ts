import { BadRequestException, ConflictException, Injectable } from "@nestjs/common";
import { z } from "zod";

import { AgentActionCertainFailureError } from "application/agent/action-coordinator.service";
import { AgentCapabilityProvider } from "application/agent/capability.decorator";
import type { AgentCapabilityProviderContract, CapabilityDefinition } from "application/agent/capability.types";
import { CreateMessageTemplateUsecase } from "./create-message-template.usecase";
import { UpdateMessageTemplateUsecase } from "./update-message-template.usecase";
import { FindMessageTemplateByIdUsecase } from "./find-message-template-by-id.usecase";
import type { AgentFormField } from "@babyjamjam/shared";
import { readAgentActionEffect, recordAgentActionEffect } from "application/agent/agent-action-effect-receipt";
import { PrismaService } from "infrastructure/database/prisma.service";

const VariableSchema = z.object({
    key: z.string().trim().min(1).max(60),
    type: z.enum(["text", "phone", "select", "date", "number", "textarea"]),
    label: z.string().trim().min(1).max(100),
    placeholder: z.string().max(200).optional(),
    required: z.boolean(),
    options: z.array(z.string().max(100)).max(50).optional(),
});
const CreateSchema = z.object({
    name: z.string().trim().min(1).max(100),
    content: z.string().min(1).max(10000),
    variables: z.preprocess((value) => {
        if (typeof value !== "string") return value;
        try { return JSON.parse(value); } catch { return value; }
    }, z.array(VariableSchema).max(50)),
});
const TEMPLATE_MUTABLE_FIELD_KEYS = Object.keys(CreateSchema.shape);
const UpdateSchema = CreateSchema.partial().extend({ id: z.string().min(1).max(200) }).superRefine((value, context) => {
    if (!TEMPLATE_MUTABLE_FIELD_KEYS.some((key) => value[key as keyof typeof value] !== undefined)) {
        context.addIssue({ code: "custom", message: "At least one message template field must be updated" });
    }
});
const OutputSchema = z.object({ id: z.string().min(1), name: z.string(), status: z.string() });
const TEMPLATE_CREATE_FIELDS: AgentFormField[] = [
    { name: "name", label: "템플릿 이름", type: "text", required: true },
    { name: "content", label: "메시지 내용", type: "textarea", required: true },
    { name: "variables", label: "변수 정의(JSON)", type: "textarea", required: true },
];
const TEMPLATE_UPDATE_FIELDS: AgentFormField[] = [
    { name: "id", label: "템플릿 ID", type: "text", required: true },
    ...TEMPLATE_CREATE_FIELDS.map((field) => ({ ...field, required: false })),
];

@Injectable()
@AgentCapabilityProvider()
export class MessageTemplateWriteAgentCapabilitiesProvider implements AgentCapabilityProviderContract {
    constructor(
        private readonly createTemplate: CreateMessageTemplateUsecase,
        private readonly updateTemplate: UpdateMessageTemplateUsecase,
        private readonly findTemplate: FindMessageTemplateByIdUsecase,
        private readonly prisma: PrismaService,
    ) {}

    getCapabilities(): CapabilityDefinition[] {
        const common = {
            domain: "messages", version: "1.0.0", requiredRoles: ["owner", "admin", "manager"],
            risk: "reversible-write" as const, sideEffect: true, renderer: "action-proposal" as const,
            approvalPolicy: "structured" as const, idempotencyPolicy: "action-id" as const,
        };
        return [
            {
                meta: { ...common, name: "messages.createTemplate", description: "Create a message template after explicit approval", flagKey: "agent.capability.messages.createTemplate" },
                inputSchema: CreateSchema, outputSchema: OutputSchema,
                formFields: TEMPLATE_CREATE_FIELDS,
                execute: async (context, rawInput) => {
                    return this.prisma.$transaction(async (transaction) => {
                        const template = await this.createTemplate.execute(context.principal.branchId, CreateSchema.parse(rawInput), transaction);
                        const result = { id: template.id, name: template.name, status: "created" };
                        await recordAgentActionEffect(transaction, context, "messages.createTemplate", "message-template", template.id, result);
                        return result;
                    });
                },
                reconcile: async (context) => {
                    const receipt = await readAgentActionEffect(this.prisma, context, "messages.createTemplate");
                    const result = receipt?.resourceType === "message-template" ? OutputSchema.safeParse(receipt.result) : null;
                    return result?.success
                        ? { status: "succeeded", result: result.data }
                        : { status: "uncertain", reason: "No action-bound template creation receipt was found" };
                },
            },
            {
                meta: { ...common, name: "messages.updateTemplate", description: "Update a message template after explicit approval", flagKey: "agent.capability.messages.updateTemplate" },
                inputSchema: UpdateSchema, outputSchema: OutputSchema,
                formFields: TEMPLATE_UPDATE_FIELDS,
                inspect: async (context, rawInput) => {
                    const input = UpdateSchema.parse(rawInput);
                    const template = await this.findTemplate.execute(context.principal.branchId, input.id);
                    return {
                        targetVersion: template.updatedAt.toISOString(),
                        targetSnapshot: {
                            id: template.id,
                            name: template.name,
                            content: template.content,
                            variables: template.variables,
                            createdAt: template.createdAt.toISOString(),
                            updatedAt: template.updatedAt.toISOString(),
                        },
                    };
                },
                revalidate: async (context, rawInput, expectedTargetVersion) => {
                    const input = UpdateSchema.parse(rawInput);
                    const template = await this.findTemplate.execute(context.principal.branchId, input.id);
                    const currentVersion = template.updatedAt.toISOString();
                    return { valid: currentVersion === expectedTargetVersion, currentVersion, reason: "Message template changed" };
                },
                execute: async (context, rawInput) => {
                    const input = UpdateSchema.parse(rawInput);
                    const { id, ...updates } = input;
                    const template = await this.updateTemplate.execute(context.principal.branchId, id, updates);
                    return { id: template.id, name: template.name, status: "updated" };
                },
                executeApprovedTarget: async (context, rawInput, expectedTargetVersion) => {
                    const input = UpdateSchema.parse(rawInput);
                    const { id, ...updates } = input;
                    const expectedUpdatedAt = new Date(expectedTargetVersion);
                    if (Number.isNaN(expectedUpdatedAt.getTime())) {
                        throw new AgentActionCertainFailureError("Message template approval version is invalid");
                    }
                    try {
                        const template = await this.updateTemplate.executeApproved(
                            context.principal.branchId,
                            id,
                            updates,
                            expectedUpdatedAt,
                            context.approvedTargetSnapshot,
                        );
                        return { id: template.id, name: template.name, status: "updated" };
                    } catch (error) {
                        if (error instanceof AgentActionCertainFailureError) throw error;
                        if (error instanceof ConflictException || error instanceof BadRequestException) {
                            throw new AgentActionCertainFailureError(error.message);
                        }
                        throw error;
                    }
                },
                reconcile: async (context, rawInput) => {
                    const input = UpdateSchema.parse(rawInput);
                    const template = await this.findTemplate.execute(context.principal.branchId, input.id);
                    const desired = Object.entries(input).filter(([key, value]) => key !== "id" && value !== undefined);
                    const matches = desired.every(([key, value]) => JSON.stringify(template[key as keyof typeof template]) === JSON.stringify(value));
                    return matches
                        ? { status: "succeeded", result: { id: template.id, name: template.name, status: "updated" } }
                        : { status: "uncertain", reason: "Message template does not match the approved update" };
                },
            },
        ];
    }
}
