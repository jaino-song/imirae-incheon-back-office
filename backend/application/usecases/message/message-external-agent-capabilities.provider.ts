import { BadRequestException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { z } from "zod";

import { AgentActionCertainFailureError, AgentActionUncertainError } from "application/agent/action-coordinator.service";
import { AgentCapabilityProvider } from "application/agent/capability.decorator";
import type { AgentCapabilityProviderContract, CapabilityDefinition } from "application/agent/capability.types";
import type { AgentFormField } from "@babyjamjam/shared";
import {
    MessageTriggerService,
    validateMessageTriggerRule,
} from "application/services/message-trigger.service";
import { MessageSenderApprovalService } from "application/services/message-sender-approval.service";
import {
    SMS_DELIVERY_SNAPSHOT_VARIABLE,
    SmsTriggerDeliveryService,
} from "application/services/sms-trigger-delivery.service";
import { MessageTriggerJobEntity } from "domain/entities/message-trigger-job.entity";
import {
    AGENT_SMS_RULE_ID_PREFIX,
    MessageTriggerEventType,
    MessageTriggerOffsetType,
    MessageTriggerRecipientType,
    MessageTriggerTemplateKey,
} from "domain/constants/message-trigger-catalog";
import type { MessageTriggerRuleEntity } from "domain/entities/message-trigger-rule.entity";
import { MESSAGE_TRIGGER_JOB_REPOSITORY, type IMessageTriggerJobRepository } from "domain/repositories/message-trigger-job.repository.interface";
import { PhoneNumber } from "domain/value-objects/phone-number.vo";
import { PrismaService } from "infrastructure/database/prisma.service";
import { createHash } from "node:crypto";
import { readAgentActionEffect, recordAgentActionEffect } from "application/agent/agent-action-effect-receipt";

const IMMEDIATE_SMS_TITLE = "AI 문자 발송";
const SCHEDULED_SMS_TITLE = "AI 예약 문자";
const SmsReceiverSchema = z.string()
    .trim()
    .min(1)
    .max(200)
    .refine((receiver) => !receiver.includes(","), "Agent SMS accepts exactly one recipient")
    .refine((receiver) => PhoneNumber.create(receiver) !== null, "Receiver must be a valid phone number");
const SmsBaseSchema = z.object({
    receiver: SmsReceiverSchema,
    message: z.string().trim().min(1).max(2000),
    title: z.string().max(200).optional(),
}).strict();

function parseScheduledSmsDate(date: string, time: string): Date | null {
    const dateParts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
    const timeParts = /^(\d{2}):(\d{2})$/.exec(time);
    if (!dateParts || !timeParts) return null;
    const year = Number(dateParts[1]);
    const month = Number(dateParts[2]);
    const day = Number(dateParts[3]);
    const hour = Number(timeParts[1]);
    const minute = Number(timeParts[2]);
    if (year < 1000 || year > 9999) return null;
    const daysInMonth = month >= 1 && month <= 12
        ? new Date(Date.UTC(year, month, 0)).getUTCDate()
        : 0;
    if (day < 1 || day > daysInMonth || hour > 23 || minute > 59) return null;
    const scheduledAt = new Date(`${date}T${time}:00+09:00`);
    if (Number.isNaN(scheduledAt.getTime())) return null;
    const local = new Date(scheduledAt.getTime() + 9 * 60 * 60 * 1000);
    return local.getUTCFullYear() === year
        && local.getUTCMonth() + 1 === month
        && local.getUTCDate() === day
        && local.getUTCHours() === hour
        && local.getUTCMinutes() === minute
        ? scheduledAt
        : null;
}

const SendSmsSchema = SmsBaseSchema.extend({
    title: z.string().max(200).default(IMMEDIATE_SMS_TITLE),
}).strict();
const ScheduledSmsSchema = SmsBaseSchema.extend({
    title: z.string().max(200).default(SCHEDULED_SMS_TITLE),
    scheduledDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    scheduledTime: z.string().regex(/^\d{2}:\d{2}$/),
}).superRefine((value, context) => {
    const scheduledAt = parseScheduledSmsDate(value.scheduledDate, value.scheduledTime);
    if (!scheduledAt || scheduledAt.getTime() < Date.now() + 10 * 60 * 1000) {
        context.addIssue({ code: "custom", path: ["scheduledDate"], message: "Scheduled SMS must be at least ten minutes in the future" });
    }
});
const PreviewSchema = SmsBaseSchema.pick({ receiver: true, message: true, title: true });
const SmsOutputSchema = z.object({ status: z.string(), msgType: z.string().optional(), messageId: z.number().optional(), jobId: z.string().optional(), uncertain: z.boolean().optional() });
const HistoryInputSchema = z.object({ limit: z.number().int().positive().max(100).default(30), cursor: z.string().min(1).max(200).optional() }).default({ limit: 30 });
const HistoryOutputSchema = z.object({
    jobs: z.array(z.object({
        id: z.string(), status: z.string(), scheduledFor: z.string(), sentAt: z.string().nullable(),
        templateKey: z.string(), receiver: z.string(), attempts: z.number().int().nonnegative(), updatedAt: z.string(),
    })),
    nextCursor: z.string().nullable(),
});
const RetrySmsSchema = z.object({ jobId: z.string().min(1).max(200) });
const AutomationRuleMutableSchema = z.object({
    name: z.string().trim().min(1).max(120),
    isActive: z.boolean(),
    eventType: z.enum(MessageTriggerEventType),
    offsetType: z.enum(MessageTriggerOffsetType),
    offsetDays: z.number().int().nonnegative().max(365),
    recipientType: z.enum(MessageTriggerRecipientType),
    templateKey: z.enum(MessageTriggerTemplateKey),
});
const AutomationRuleBaseSchema = AutomationRuleMutableSchema.extend({
    isActive: z.boolean().default(true),
    offsetDays: z.number().int().nonnegative().max(365).default(0),
});
const AUTOMATION_RULE_MUTABLE_KEYS = Object.keys(AutomationRuleMutableSchema.shape);
const AutomationRuleUpdateSchema = AutomationRuleMutableSchema.partial().extend({ id: z.string().min(1).max(200) }).superRefine((value, context) => {
    if (!AUTOMATION_RULE_MUTABLE_KEYS.some((key) => value[key as keyof typeof value] !== undefined)) {
        context.addIssue({ code: "custom", message: "At least one automation rule field must be updated" });
    }
});
const AutomationRuleIdSchema = z.object({ id: z.string().min(1).max(200) });
const AutomationRuleActiveSchema = AutomationRuleIdSchema.extend({ isActive: z.boolean() });
const AutomationRuleOutputSchema = z.object({ status: z.string(), id: z.string(), isActive: z.boolean().optional() });
const AutomationRulesOutputSchema = z.object({ rules: z.array(z.object({
    id: z.string(), name: z.string(), isActive: z.boolean(), eventType: z.string(), offsetType: z.string(),
    offsetDays: z.number().int(), recipientType: z.string(), templateKey: z.string(), isDefault: z.boolean(), jobsStale: z.boolean(), updatedAt: z.string(),
})) });
const SMS_FIELDS: AgentFormField[] = [
    { name: "receiver", label: "수신번호", type: "text", required: true },
    { name: "message", label: "메시지", type: "textarea", required: true },
    { name: "title", label: "제목", type: "text" },
];
const SCHEDULED_SMS_FIELDS: AgentFormField[] = [
    ...SMS_FIELDS,
    { name: "scheduledDate", label: "예약 날짜", type: "date", required: true },
    { name: "scheduledTime", label: "예약 시간", type: "text", required: true },
];
const AUTOMATION_RULE_FIELDS: AgentFormField[] = [
    { name: "name", label: "규칙 이름", type: "text", required: true },
    { name: "isActive", label: "활성 상태", type: "boolean" },
    { name: "eventType", label: "이벤트 유형", type: "text", required: true },
    { name: "offsetType", label: "실행 시점 유형", type: "text", required: true },
    { name: "offsetDays", label: "기준일 차이", type: "number" },
    { name: "recipientType", label: "수신자 유형", type: "text", required: true },
    { name: "templateKey", label: "템플릿 키", type: "text", required: true },
];
const AUTOMATION_ID_FIELD: AgentFormField = { name: "id", label: "자동화 규칙 ID", type: "text", required: true };
const AGENT_SMS_DELIVERY_TYPE = "LMS";
type MessageTriggerRuleValidationParams = Parameters<typeof validateMessageTriggerRule>[0];

function mergedAutomationRuleValidationInput(
    rule: MessageTriggerRuleEntity,
    updates: Partial<MessageTriggerRuleValidationParams>,
): MessageTriggerRuleValidationParams {
    return {
        eventType: updates.eventType ?? rule.eventType,
        offsetType: updates.offsetType ?? rule.offsetType,
        offsetDays: updates.offsetDays ?? rule.offsetDays,
        recipientType: updates.recipientType ?? rule.recipientType,
        templateKey: updates.templateKey ?? rule.templateKey,
    };
}

function throwCertainValidationFailure(error: unknown): void {
    if (error instanceof AgentActionCertainFailureError) throw error;
    if (error instanceof BadRequestException) throw new AgentActionCertainFailureError(error.message);
}

function maskedReceiver(value: string): string {
    const digits = value.replace(/\D/g, "");
    return digits.length >= 4 ? `••••${digits.slice(-4)}` : "마스킹된 번호";
}

@Injectable()
@AgentCapabilityProvider()
export class MessageExternalAgentCapabilitiesProvider implements AgentCapabilityProviderContract {
    constructor(
        private readonly prisma: PrismaService,
        private readonly messageTriggerService: MessageTriggerService,
        @Inject(MESSAGE_TRIGGER_JOB_REPOSITORY) private readonly jobRepository: IMessageTriggerJobRepository,
        private readonly smsTriggerDeliveryService: SmsTriggerDeliveryService,
        private readonly messageSenderApprovalService: MessageSenderApprovalService,
    ) {}

    getCapabilities(): CapabilityDefinition[] {
        const common = { domain: "messages", version: "1.0.0", requiredRoles: ["owner", "admin", "manager"], sideEffect: true, approvalPolicy: "strong" as const, idempotencyPolicy: "action-id" as const };
        return [
            {
                meta: { domain: "messages", version: "1.0.0", requiredRoles: ["owner", "admin", "manager", "user"], sideEffect: false, name: "messages.previewSms", description: "Preview SMS content and cost category", risk: "read" as const, renderer: "activity" as const, flagKey: "agent.capability.messages.previewSms" },
                inputSchema: PreviewSchema, outputSchema: SmsOutputSchema,
                formFields: SMS_FIELDS,
                execute: async (_context, rawInput) => {
                    PreviewSchema.parse(rawInput);
                    return { status: "preview", msgType: AGENT_SMS_DELIVERY_TYPE };
                },
            },
            {
                meta: { domain: "messages", version: "1.0.0", requiredRoles: ["owner", "admin", "manager"], sideEffect: false, name: "messages.deliveryHistory", description: "List SMS delivery lifecycle history for the current branch", risk: "read" as const, renderer: "activity" as const, flagKey: "agent.capability.messages.deliveryHistory" },
                inputSchema: HistoryInputSchema,
                outputSchema: HistoryOutputSchema,
                execute: async (context, rawInput) => {
                    const input = HistoryInputSchema.parse(rawInput);
                    const jobs = await this.jobRepository.findHistoryByBranch(context.principal.branchId, input.limit + 1, input.cursor);
                    const page = jobs.slice(0, input.limit);
                    return {
                        jobs: page.map((job) => ({
                            id: job.id,
                            status: job.status,
                            scheduledFor: job.scheduledFor.toISOString(),
                            sentAt: job.sentAt?.toISOString() ?? null,
                            templateKey: job.templateKey,
                            receiver: maskedReceiver(job.recipientPhone ?? ""),
                            attempts: job.attempts,
                            updatedAt: job.updatedAt.toISOString(),
                        })),
                        nextCursor: jobs.length > input.limit ? page.at(-1)?.id ?? null : null,
                    };
                },
            },
            {
                meta: { domain: "automation", version: "1.0.0", requiredRoles: ["owner", "admin", "manager", "user"], sideEffect: false, name: "automation.list", description: "List message automation rules for the current branch", risk: "read" as const, renderer: "text" as const, flagKey: "agent.capability.automation.list" },
                inputSchema: z.object({}).default({}), outputSchema: AutomationRulesOutputSchema,
                execute: async (context, rawInput) => {
                    z.object({}).parse(rawInput);
                    const rules = await this.messageTriggerService.listRules(context.principal.branchId);
                    return { rules: rules.map((rule) => this.ruleView(rule)) };
                },
            },
            {
                meta: { ...common, name: "messages.sendSms", description: "Send an SMS after strong approval", risk: "external-side-effect" as const, renderer: "action-proposal" as const, flagKey: "agent.capability.messages.sendSms" },
                inputSchema: SendSmsSchema, outputSchema: SmsOutputSchema,
                classifyOutcome: (rawOutput) => {
                    const status = SmsOutputSchema.parse(rawOutput).status;
                    if (status === "canceled") return { status: "cancelled" as const, reason: "SMS delivery was cancelled before provider acceptance" };
                    if (status === "failed") return { status: "failed" as const, reason: "SMS provider explicitly rejected the message" };
                    return { status: "succeeded" as const };
                },
                formFields: SMS_FIELDS,
                inspect: async (context, rawInput) => {
                    await this.messageSenderApprovalService.ensureApproved(context.principal.branchId);
                    const input = SendSmsSchema.parse(rawInput);
                    return {
                        title: "문자 발송",
                        summary: `${maskedReceiver(input.receiver)} 번호로 ${input.message.length}자 메시지를 발송합니다.`,
                        provider: "Aligo",
                        estimatedCost: `${AGENT_SMS_DELIVERY_TYPE} 요금제 기준`,
                    };
                },
                execute: async (context, rawInput) => {
                    const input = SendSmsSchema.parse(rawInput);
                    const job = await this.enqueueSms(context, input, new Date(), IMMEDIATE_SMS_TITLE);
                    let delivered: MessageTriggerJobEntity;
                    try {
                        delivered = await this.messageTriggerService.dispatchPendingJobNow(job.id);
                    } catch {
                        throw new AgentActionUncertainError("SMS delivery status is uncertain", { jobId: job.id });
                    }
                    if (delivered.status === "sent") {
                        return { status: "sent", msgType: AGENT_SMS_DELIVERY_TYPE, jobId: job.id };
                    }
                    if (delivered.status === "canceled") return { status: "canceled", msgType: AGENT_SMS_DELIVERY_TYPE, jobId: job.id };
                    if (delivered.status === "failed" && this.isProviderRejected(delivered)) {
                        return { status: "failed", msgType: AGENT_SMS_DELIVERY_TYPE, jobId: job.id };
                    }
                    throw new AgentActionUncertainError("SMS delivery status is uncertain", { jobId: job.id });
                },
                reconcile: async (context, _rawInput, uncertainty) => this.reconcileSmsJob(context, uncertainty),
            },
            {
                meta: { ...common, name: "messages.scheduleSms", description: "Schedule an SMS after strong approval", risk: "external-side-effect" as const, renderer: "action-proposal" as const, flagKey: "agent.capability.messages.scheduleSms" },
                inputSchema: ScheduledSmsSchema, outputSchema: SmsOutputSchema,
                formFields: SCHEDULED_SMS_FIELDS,
                inspect: async (context, rawInput) => {
                    await this.messageSenderApprovalService.ensureApproved(context.principal.branchId);
                    const input = ScheduledSmsSchema.parse(rawInput);
                    return {
                        title: "예약 문자 등록",
                        summary: `${input.scheduledDate} ${input.scheduledTime}에 ${maskedReceiver(input.receiver)} 번호로 발송합니다.`,
                        provider: "Aligo",
                        estimatedCost: `${AGENT_SMS_DELIVERY_TYPE} 요금제 기준`,
                    };
                },
                execute: async (context, rawInput) => {
                    const parsed = ScheduledSmsSchema.safeParse(rawInput);
                    if (!parsed.success) {
                        throw new AgentActionCertainFailureError("Scheduled SMS is no longer at least ten minutes in the future");
                    }
                    const input = parsed.data;
                    const scheduledFor = parseScheduledSmsDate(input.scheduledDate, input.scheduledTime);
                    if (!scheduledFor) throw new AgentActionCertainFailureError("Scheduled SMS date or time is invalid");
                    const job = await this.enqueueSms(context, input, scheduledFor, SCHEDULED_SMS_TITLE);
                    return { status: "scheduled", msgType: AGENT_SMS_DELIVERY_TYPE, messageId: undefined, jobId: job.id };
                },
                reconcile: async (context) => {
                    if (!context.actionId) return { status: "uncertain", reason: "Scheduled SMS action identity is missing" };
                    const job = await this.prisma.message_trigger_job.findFirst({
                        where: { branchId: context.principal.branchId, dedupeKey: `agent-sms:${context.actionId}` },
                    });
                    return job
                        ? { status: "succeeded", result: { status: "scheduled", jobId: job.id } }
                        : { status: "failed", reason: "Scheduled SMS job was not persisted" };
                },
            },
            {
                meta: { ...common, name: "messages.retrySms", description: "Retry a provider-rejected SMS after strong approval", risk: "external-side-effect" as const, renderer: "action-proposal" as const, flagKey: "agent.capability.messages.retrySms" },
                inputSchema: RetrySmsSchema,
                outputSchema: SmsOutputSchema,
                classifyOutcome: (rawOutput) => {
                    const status = SmsOutputSchema.parse(rawOutput).status;
                    if (status === "canceled") return { status: "cancelled" as const, reason: "SMS retry was cancelled before provider acceptance" };
                    if (status === "failed") return { status: "failed" as const, reason: "SMS provider explicitly rejected the retry" };
                    return { status: "succeeded" as const };
                },
                formFields: [{ name: "jobId", label: "실패한 발송 작업 ID", type: "text", required: true }],
                inspect: async (context, rawInput) => {
                    await this.messageSenderApprovalService.ensureApproved(context.principal.branchId);
                    const input = RetrySmsSchema.parse(rawInput);
                    const job = await this.findRetryableJob(context.principal.branchId, input.jobId);
                    const snapshot = await this.smsTriggerDeliveryService.resolveDeliverySnapshot(job);
                    return {
                        targetVersion: this.jobTargetVersion(job, snapshot),
                        targetSnapshot: {
                            id: job.id,
                            status: job.status,
                            scheduledFor: job.scheduledFor.toISOString(),
                            ...this.smsTriggerDeliveryService.snapshotForApproval(snapshot),
                        },
                        title: "문자 재시도",
                        summary: `${job.id} 작업은 ${snapshot.maskedReceiver} 번호로 ${snapshot.templateKey} 템플릿을 ${snapshot.deliveryType}(${snapshot.estimatedCost}) 유형으로 재시도합니다. 제목: ${snapshot.title || "(없음)"}. 본문: ${snapshot.message || "(없음)"}. 제공자가 명시적으로 거절한 건에 대해 새 발송을 1회 시도합니다.`,
                        provider: "Aligo",
                        estimatedCost: snapshot.estimatedCost,
                    };
                },
                execute: async (context, rawInput) => this.executeRetrySms(context, rawInput, context.approvedTargetVersion),
                executeApprovedTarget: async (context, rawInput, expectedTargetVersion) => this.executeRetrySms(context, rawInput, expectedTargetVersion),
                revalidate: async (context, rawInput, expectedTargetVersion) => {
                    try {
                        const job = await this.findRetryableJob(context.principal.branchId, RetrySmsSchema.parse(rawInput).jobId);
                        const snapshot = await this.smsTriggerDeliveryService.resolveDeliverySnapshot(job);
                        const currentVersion = this.jobTargetVersion(job, snapshot);
                        return { valid: currentVersion === expectedTargetVersion, currentVersion, reason: "SMS job changed after proposal" };
                    } catch {
                        return { valid: false, currentVersion: "missing-or-not-retryable", reason: "SMS job is no longer safely retryable" };
                    }
                },
                reconcile: async (context, _rawInput, uncertainty) => this.reconcileSmsJob(context, uncertainty),
            },
            this.automationCreate(common),
            this.automationUpdate(common),
            this.automationSetActive(common),
            this.automationDelete(common),
        ];
    }

    private automationCreate(common: Record<string, unknown>): CapabilityDefinition {
        return {
            meta: { ...common, domain: "automation", name: "automation.create", description: "Create a message automation rule after strong approval", risk: "external-side-effect", renderer: "action-proposal", flagKey: "agent.capability.automation.create" } as CapabilityDefinition["meta"],
            inputSchema: AutomationRuleBaseSchema, outputSchema: AutomationRuleOutputSchema,
            formFields: AUTOMATION_RULE_FIELDS,
            inspect: async (_context, rawInput) => {
                const input = AutomationRuleBaseSchema.parse(rawInput);
                validateMessageTriggerRule(input);
                return { title: "메시지 자동화 생성", summary: `${input.name} 규칙을 ${input.isActive ? "활성" : "비활성"} 상태로 생성합니다.`, provider: "Message automation scheduler", estimatedCost: "활성 규칙이 발송하는 각 문자에 SMS/LMS 요금이 발생할 수 있습니다." };
            },
            execute: async (context, rawInput) => {
                const input = AutomationRuleBaseSchema.parse(rawInput);
                try {
                    validateMessageTriggerRule(input);
                    return await this.prisma.$transaction(async (transaction) => {
                        const rule = await this.messageTriggerService.createRule(context.principal.branchId, input, transaction);
                        const result = { status: "created", id: rule.id, isActive: rule.isActive };
                        await recordAgentActionEffect(transaction, context, "automation.create", "automation-rule", rule.id, result);
                        return result;
                    });
                } catch (error) {
                    throwCertainValidationFailure(error);
                    throw error;
                }
            },
            reconcile: async (context) => {
                const receipt = await readAgentActionEffect(this.prisma, context, "automation.create");
                const result = receipt?.resourceType === "automation-rule" ? AutomationRuleOutputSchema.safeParse(receipt.result) : null;
                return result?.success
                    ? { status: "succeeded", result: result.data }
                    : { status: "uncertain", reason: "No action-bound automation creation receipt was found" };
            },
        };
    }

    private automationUpdate(common: Record<string, unknown>): CapabilityDefinition {
        return this.automationExistingRuleCapability(common, "automation.update", "Update a message automation rule after strong approval", AutomationRuleUpdateSchema, async (branchId, input) => {
            const existing = await this.messageTriggerService.getRule(branchId, input.id);
            validateMessageTriggerRule(
                mergedAutomationRuleValidationInput(existing, input),
                existing.templateKey,
            );
            const { id, ...updates } = input;
            const rule = await this.messageTriggerService.updateRule(branchId, id, updates);
            return { status: "updated", id: rule.id, isActive: rule.isActive };
        });
    }

    private automationSetActive(common: Record<string, unknown>): CapabilityDefinition {
        return this.automationExistingRuleCapability(common, "automation.setActive", "Enable or disable a message automation rule after strong approval", AutomationRuleActiveSchema, async (branchId, input) => {
            const rule = await this.messageTriggerService.updateRule(branchId, input.id, { isActive: input.isActive });
            return { status: input.isActive ? "enabled" : "disabled", id: rule.id, isActive: rule.isActive };
        });
    }

    private automationDelete(common: Record<string, unknown>): CapabilityDefinition {
        const capability = this.automationExistingRuleCapability(common, "automation.delete", "Delete a message automation rule and cancel pending jobs after strong approval", AutomationRuleIdSchema, async (branchId, input) => {
            await this.messageTriggerService.deleteRule(branchId, input.id);
            return { status: "deleted", id: input.id };
        });
        capability.meta.risk = "irreversible-write";
        capability.reconcile = async (context, rawInput) => {
            const input = AutomationRuleIdSchema.parse(rawInput);
            try {
                await this.messageTriggerService.getRule(context.principal.branchId, input.id);
                return { status: "uncertain" as const, reason: "Automation rule still exists" };
            } catch (error) {
                return error instanceof NotFoundException
                    ? { status: "succeeded" as const, result: { status: "deleted", id: input.id } }
                    : { status: "uncertain" as const, reason: "Automation rule lookup failed" };
            }
        };
        return capability;
    }

    private automationExistingRuleCapability<T extends z.ZodType<{ id: string }>>(
        common: Record<string, unknown>,
        name: string,
        description: string,
        inputSchema: T,
        execute: (branchId: string, input: z.infer<T>) => Promise<z.infer<typeof AutomationRuleOutputSchema>>,
    ): CapabilityDefinition {
        const capability: CapabilityDefinition = {
            meta: { ...common, domain: "automation", name, description, risk: "external-side-effect", renderer: "action-proposal", flagKey: `agent.capability.${name}` } as CapabilityDefinition["meta"],
            inputSchema, outputSchema: AutomationRuleOutputSchema,
            formFields: name === "automation.update"
                ? [AUTOMATION_ID_FIELD, ...AUTOMATION_RULE_FIELDS.map((field) => ({ ...field, required: false }))]
                : name === "automation.setActive"
                    ? [AUTOMATION_ID_FIELD, { name: "isActive", label: "활성 상태", type: "boolean", required: true }]
                    : [AUTOMATION_ID_FIELD],
            inspect: async (context, rawInput) => {
                const input = inputSchema.parse(rawInput);
                const rule = await this.messageTriggerService.getRule(context.principal.branchId, input.id);
                if (name === "automation.update") {
                    validateMessageTriggerRule(
                        mergedAutomationRuleValidationInput(
                            rule,
                            input as Partial<MessageTriggerRuleValidationParams>,
                        ),
                        rule.templateKey,
                    );
                }
                return {
                    targetVersion: this.ruleTargetVersion(rule),
                    targetSnapshot: { ...this.ruleView(rule), branchId: rule.branchId, createdAt: rule.createdAt.toISOString() },
                    title: description,
                    summary: `${rule.name} 규칙을 변경합니다.`,
                    provider: "Message automation scheduler",
                    estimatedCost: "활성 규칙이 발송하는 각 문자에 SMS/LMS 요금이 발생할 수 있습니다.",
                };
            },
            execute: async (context, rawInput) => {
                try {
                    return await execute(context.principal.branchId, inputSchema.parse(rawInput));
                } catch (error) {
                    throwCertainValidationFailure(error);
                    throw error;
                }
            },
            executeApprovedTarget: async (context, rawInput, expectedTargetVersion) => {
                const input = inputSchema.parse(rawInput) as { id: string; [key: string]: unknown };
                try {
                    if (name === "automation.delete") {
                        await this.messageTriggerService.deleteRuleApprovedTarget(
                            context.principal.branchId,
                            input.id,
                            expectedTargetVersion,
                            context.approvedTargetSnapshot,
                        );
                        return { status: "deleted", id: input.id };
                    }
                    const { id, ...updates } = input;
                    const updated = await this.messageTriggerService.updateRuleApprovedTarget(
                        context.principal.branchId,
                        id,
                        updates,
                        expectedTargetVersion,
                        context.approvedTargetSnapshot,
                    );
                    const status = name === "automation.setActive"
                        ? (updated.isActive ? "enabled" : "disabled")
                        : "updated";
                    return { status, id: updated.id, isActive: updated.isActive };
                } catch (error) {
                    if (error instanceof AgentActionCertainFailureError) throw error;
                    if (error instanceof BadRequestException || error instanceof NotFoundException) {
                        throw new AgentActionCertainFailureError(error.message);
                    }
                    throw error;
                }
            },
            revalidate: async (context, rawInput, expectedTargetVersion) => {
                try {
                    const rule = await this.messageTriggerService.getRule(context.principal.branchId, inputSchema.parse(rawInput).id);
                    const currentVersion = this.ruleTargetVersion(rule);
                    return { valid: currentVersion === expectedTargetVersion, currentVersion, reason: "Automation rule changed after proposal" };
                } catch {
                    return { valid: false, currentVersion: "missing", reason: "Automation rule is no longer available" };
                }
            },
        };
        capability.reconcile = async (context, rawInput) => {
            const input = inputSchema.parse(rawInput);
            try {
                const rule = await this.messageTriggerService.getRule(context.principal.branchId, input.id);
                const desired = Object.entries(input).filter(([key, value]) => key !== "id" && value !== undefined);
                const matches = desired.every(([key, value]) => JSON.stringify(rule[key as keyof typeof rule]) === JSON.stringify(value));
                if (!matches) return { status: "uncertain", reason: "Automation rule does not match the approved update" };
                if (name !== "automation.delete") {
                    const complete = await this.messageTriggerService.isRuleMutationComplete(
                        context.principal.branchId,
                        rule.id,
                        Object.fromEntries(desired),
                    );
                    if (!complete) {
                        return { status: "uncertain", reason: "Automation rule jobs have not completed fencing and rebuild" };
                    }
                }
                const status = name === "automation.setActive"
                    ? (rule.isActive ? "enabled" : "disabled")
                    : "updated";
                return { status: "succeeded", result: { status, id: rule.id, isActive: rule.isActive } };
            } catch (error) {
                return error instanceof NotFoundException
                    ? { status: "failed", reason: "Automation rule no longer exists" }
                    : { status: "uncertain", reason: "Automation rule lookup failed" };
            }
        };
        return capability;
    }

    private ruleView(rule: MessageTriggerRuleEntity) {
        return { id: rule.id, name: rule.name, isActive: rule.isActive, eventType: rule.eventType, offsetType: rule.offsetType, offsetDays: rule.offsetDays, recipientType: rule.recipientType, templateKey: rule.templateKey, isDefault: rule.isDefault, jobsStale: rule.jobsStale, updatedAt: rule.updatedAt.toISOString() };
    }

    private ruleTargetVersion(rule: MessageTriggerRuleEntity): string {
        return createHash("sha256").update(JSON.stringify(this.ruleView(rule))).digest("hex");
    }

    private async enqueueSms(
        context: Parameters<CapabilityDefinition["execute"]>[0],
        input: { receiver: string; message: string; title: string },
        scheduledFor: Date,
        ruleName: string,
    ): Promise<MessageTriggerJobEntity> {
        if (!context.actionId) throw new AgentActionUncertainError("SMS action identity is missing");
        await this.ensureSmsApprovedForExecution(context.principal.branchId);
        const ruleId = `${AGENT_SMS_RULE_ID_PREFIX}${context.principal.branchId}`;
        await this.prisma.message_trigger_rule.upsert({
            where: { id: ruleId },
            create: {
                id: ruleId,
                branchId: context.principal.branchId,
                name: ruleName,
                isActive: false,
                eventType: "CLIENT_CREATED",
                offsetType: "IMMEDIATE",
                offsetDays: 0,
                recipientType: MessageTriggerRecipientType.CLIENT,
                templateKey: MessageTriggerTemplateKey.INFO,
                isDefault: false,
                jobsStale: false,
            },
            update: { isActive: false },
        });
        await this.ensureSmsApprovedForExecution(context.principal.branchId);
        return this.jobRepository.upsertPending(MessageTriggerJobEntity.create({
            branchId: context.principal.branchId,
            ruleId,
            scheduledFor,
            recipientType: MessageTriggerRecipientType.CLIENT,
            recipientPhone: input.receiver,
            templateKey: MessageTriggerTemplateKey.INFO,
            dedupeKey: `agent-sms:${context.actionId}`,
            payload: {
                memberId: `agent-action:${context.actionId}`,
                recipientName: "수신자",
                recipientPhone: input.receiver,
                messageBody: input.message,
                templateVariables: {
                    triggerType: "agent_scheduled",
                    title: input.title,
                    msgType: AGENT_SMS_DELIVERY_TYPE,
                },
            },
        }));
    }

    private async executeRetrySms(
        context: Parameters<CapabilityDefinition["execute"]>[0],
        rawInput: unknown,
        expectedTargetVersion: string | undefined,
    ) {
        const input = RetrySmsSchema.parse(rawInput);
        if (!context.actionId) throw new AgentActionUncertainError("SMS retry action identity is missing");
        if (!expectedTargetVersion || !context.approvedTargetSnapshot) {
            throw new AgentActionCertainFailureError("SMS retry approval snapshot is missing");
        }
        await this.ensureSmsApprovedForExecution(context.principal.branchId);
        const source = await this.findRetryableJob(context.principal.branchId, input.jobId);
        const canonical = await this.smsTriggerDeliveryService.resolveCanonicalDeliverySnapshot(source);
        const currentTargetVersion = this.jobTargetVersion(source, canonical);
        if (currentTargetVersion !== expectedTargetVersion) {
            throw new AgentActionCertainFailureError("SMS job or provider snapshot changed after approval");
        }
        let snapshot;
        try {
            snapshot = this.smsTriggerDeliveryService.approvedSnapshotForExecution(
                source,
                context.approvedTargetSnapshot,
                canonical,
            );
        } catch {
            throw new AgentActionCertainFailureError("SMS approval snapshot no longer matches the provider-bound target");
        }
        const retryCandidate = MessageTriggerJobEntity.create({
            branchId: context.principal.branchId,
            ruleId: source.ruleId,
            scheduledFor: new Date(),
            clientId: source.clientId,
            employeeScheduleId: source.employeeScheduleId,
            recipientType: source.recipientType,
            recipientPhone: source.recipientPhone,
            templateKey: source.templateKey,
            dedupeKey: `agent-sms-retry:${context.actionId}`,
            payload: {
                ...source.payload,
                memberId: `agent-action:${context.actionId}`,
                templateVariables: {
                    ...source.payload.templateVariables,
                    retrySafety: "pending-agent-retry",
                    [SMS_DELIVERY_SNAPSHOT_VARIABLE]: this.smsTriggerDeliveryService.serializeSnapshot(snapshot),
                },
            },
        });
        await this.ensureSmsApprovedForExecution(context.principal.branchId);
        const retry = await this.jobRepository.claimProviderRejectedForRetry(
            context.principal.branchId,
            source.id,
            expectedTargetVersion,
            canonical.snapshotHash,
            source,
            retryCandidate,
        );
        if (!retry) {
            throw new AgentActionCertainFailureError("SMS source job changed before the retry could be claimed");
        }
        let delivered: MessageTriggerJobEntity;
        try {
            delivered = await this.messageTriggerService.dispatchPendingJobNow(retry.id);
        } catch {
            throw new AgentActionUncertainError("SMS retry delivery status is uncertain", { jobId: retry.id });
        }
        if (delivered.status === "sent") return { status: "sent", jobId: retry.id };
        if (delivered.status === "canceled") return { status: "canceled", jobId: retry.id };
        if (delivered.status === "failed" && this.isProviderRejected(delivered)) {
            return { status: "failed", jobId: retry.id };
        }
        throw new AgentActionUncertainError("SMS retry delivery status is uncertain", { jobId: retry.id });
    }

    private async ensureSmsApprovedForExecution(branchId: string): Promise<void> {
        try {
            await this.messageSenderApprovalService.ensureApproved(branchId);
        } catch (error) {
            throw new AgentActionCertainFailureError(
                error instanceof Error ? error.message : "Message sender approval is required",
            );
        }
    }

    private isProviderRejected(job: { payload: unknown }): boolean {
        const payload = job.payload;
        if (!payload || typeof payload !== "object" || Array.isArray(payload)) return false;
        const variables = (payload as { templateVariables?: unknown }).templateVariables;
        return Boolean(
            variables
            && typeof variables === "object"
            && !Array.isArray(variables)
            && (variables as Record<string, unknown>)["retrySafety"] === "provider-rejected",
        );
    }

    private async reconcileSmsJob(
        context: Parameters<NonNullable<CapabilityDefinition["reconcile"]>>[0],
        uncertainty: Record<string, unknown> | null,
    ) {
        const actionId = context.actionId;
        const jobId = typeof uncertainty?.["jobId"] === "string" ? uncertainty["jobId"] : undefined;
        const job = jobId
            ? await this.prisma.message_trigger_job.findFirst({ where: { id: jobId, branchId: context.principal.branchId } })
            : actionId
                ? await this.prisma.message_trigger_job.findFirst({ where: { branchId: context.principal.branchId, OR: [{ dedupeKey: `agent-sms:${actionId}` }, { dedupeKey: `agent-sms-retry:${actionId}` }] } })
                : null;
        if (!job || job.status === "pending" || job.status === "processing") {
            return { status: "uncertain" as const, reason: "SMS delivery is not terminal" };
        }
        if (job.status === "sent") {
            return { status: "succeeded" as const, result: { status: "sent", jobId: job.id } };
        }
        if (job.status === "canceled") {
            return { status: "failed" as const, result: { status: "canceled", jobId: job.id }, reason: job.cancelReason ?? "SMS delivery was canceled before provider dispatch" };
        }
        if (job.status === "failed" && this.isProviderRejected(job)) {
            return { status: "failed" as const, result: { status: "failed", jobId: job.id } };
        }
        return { status: "uncertain" as const, reason: "SMS provider outcome cannot be proven from the local failed job" };
    }

    private async findRetryableJob(branchId: string, jobId: string): Promise<MessageTriggerJobEntity> {
        const job = await this.jobRepository.findById(jobId);
        if (!job || job.branchId !== branchId || job.status !== "failed" || job.payload.templateVariables["retrySafety"] !== "provider-rejected") {
            throw new Error("SMS job is not safely retryable in the current branch");
        }
        return job;
    }

    private jobTargetVersion(job: MessageTriggerJobEntity, snapshot: { snapshotHash: string }): string {
        return createHash("sha256").update(JSON.stringify({
            id: job.id,
            branchId: job.branchId,
            ruleId: job.ruleId,
            status: job.status,
            scheduledFor: job.scheduledFor.toISOString(),
            sentAt: job.sentAt?.toISOString() ?? null,
            canceledAt: job.canceledAt?.toISOString() ?? null,
            cancelReason: job.cancelReason,
            clientId: job.clientId,
            employeeScheduleId: job.employeeScheduleId,
            recipientType: job.recipientType,
            recipientPhone: job.recipientPhone,
            templateKey: job.templateKey,
            payload: job.payload,
            attempts: job.attempts,
            nextAttemptAt: job.nextAttemptAt?.toISOString() ?? null,
            createdAt: job.createdAt.toISOString(),
            updatedAt: job.updatedAt.toISOString(),
            deliverySnapshotHash: snapshot.snapshotHash,
        })).digest("hex");
    }
}
