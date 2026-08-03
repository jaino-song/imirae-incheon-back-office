import { Inject, Injectable } from "@nestjs/common";
import { z } from "zod";

import { AgentActionUncertainError } from "application/agent/action-coordinator.service";
import { AgentCapabilityProvider } from "application/agent/capability.decorator";
import type { AgentCapabilityProviderContract, CapabilityDefinition } from "application/agent/capability.types";
import type { AgentFormField } from "@babyjamjam/shared";
import { resolveAligoSmsMessageType } from "application/dto/aligo/send-sms.dto";
import { MessageTriggerService } from "application/services/message-trigger.service";
import { MessageTriggerJobEntity } from "domain/entities/message-trigger-job.entity";
import { MessageTriggerEventType, MessageTriggerOffsetType, MessageTriggerRecipientType, MessageTriggerTemplateKey } from "domain/constants/message-trigger-catalog";
import type { MessageTriggerRuleEntity } from "domain/entities/message-trigger-rule.entity";
import { MESSAGE_TRIGGER_JOB_REPOSITORY, type IMessageTriggerJobRepository } from "domain/repositories/message-trigger-job.repository.interface";
import { PrismaService } from "infrastructure/database/prisma.service";
import { createHash } from "node:crypto";
import { readAgentActionEffect, recordAgentActionEffect } from "application/agent/agent-action-effect-receipt";

const SmsSchema = z.object({ receiver: z.string().trim().min(1).max(200), message: z.string().trim().min(1).max(2000), senderPhone: z.string().trim().max(40).optional(), title: z.string().max(200).optional(), scheduledDate: z.string().optional(), scheduledTime: z.string().optional() });
const ScheduledSmsSchema = SmsSchema.extend({
    scheduledDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    scheduledTime: z.string().regex(/^\d{2}:\d{2}$/),
}).superRefine((value, context) => {
    const scheduledAt = new Date(`${value.scheduledDate}T${value.scheduledTime}:00+09:00`);
    if (Number.isNaN(scheduledAt.getTime()) || scheduledAt.getTime() < Date.now() + 10 * 60 * 1000) {
        context.addIssue({ code: "custom", path: ["scheduledDate"], message: "Scheduled SMS must be at least ten minutes in the future" });
    }
});
const PreviewSchema = SmsSchema.pick({ receiver: true, message: true, title: true });
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
const AutomationRuleBaseSchema = z.object({
    name: z.string().trim().min(1).max(120),
    isActive: z.boolean().default(true),
    eventType: z.enum(MessageTriggerEventType),
    offsetType: z.enum(MessageTriggerOffsetType),
    offsetDays: z.number().int().nonnegative().max(365).default(0),
    recipientType: z.enum(MessageTriggerRecipientType),
    templateKey: z.enum(MessageTriggerTemplateKey),
});
const AutomationRuleUpdateSchema = AutomationRuleBaseSchema.partial().extend({ id: z.string().min(1).max(200) });
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
    { name: "senderPhone", label: "발신번호", type: "text" },
    { name: "title", label: "제목", type: "text" },
];
const SCHEDULED_SMS_FIELDS: AgentFormField[] = [
    ...SMS_FIELDS,
    { name: "scheduledDate", label: "예약 날짜", type: "date", required: true },
    { name: "scheduledTime", label: "예약 시간", type: "text", required: true },
];

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
    ) {}

    getCapabilities(): CapabilityDefinition[] {
        const common = { domain: "messages", version: "1.0.0", requiredRoles: ["owner", "admin", "manager"], sideEffect: true, approvalPolicy: "strong" as const, idempotencyPolicy: "action-id" as const };
        return [
            {
                meta: { domain: "messages", version: "1.0.0", requiredRoles: ["owner", "admin", "manager", "user"], sideEffect: false, name: "messages.previewSms", description: "Preview SMS content and cost category", risk: "read" as const, renderer: "activity" as const, flagKey: "agent.capability.messages.previewSms" },
                inputSchema: PreviewSchema, outputSchema: SmsOutputSchema,
                formFields: SMS_FIELDS,
                execute: async (_context, rawInput) => ({ status: "preview", msgType: resolveAligoSmsMessageType(PreviewSchema.parse(rawInput)) }),
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
                inputSchema: SmsSchema, outputSchema: SmsOutputSchema,
                classifyOutcome: (rawOutput) => SmsOutputSchema.parse(rawOutput).status === "canceled"
                    ? { status: "cancelled", reason: "SMS delivery was cancelled before provider acceptance" }
                    : { status: "succeeded" },
                formFields: SMS_FIELDS,
                inspect: async (_context, rawInput) => {
                    const input = SmsSchema.parse(rawInput);
                    return {
                        title: "문자 발송",
                        summary: `${maskedReceiver(input.receiver)} 번호로 ${input.message.length}자 메시지를 발송합니다.`,
                        provider: "Aligo",
                        estimatedCost: `${resolveAligoSmsMessageType(input)} 요금제 기준`,
                    };
                },
                execute: async (context, rawInput) => {
                    const input = SmsSchema.parse(rawInput);
                    const job = await this.enqueueSms(context, input, new Date(), "AI 문자 발송");
                    const delivered = await this.messageTriggerService.dispatchPendingJobNow(job.id);
                    if (delivered.status === "sent") {
                        return { status: "sent", msgType: resolveAligoSmsMessageType(input), jobId: job.id };
                    }
                    if (delivered.status === "canceled") return { status: "canceled", msgType: resolveAligoSmsMessageType(input), jobId: job.id };
                    throw new AgentActionUncertainError("SMS delivery status is uncertain", { jobId: job.id });
                },
                reconcile: async (context, _rawInput, uncertainty) => this.reconcileSmsJob(context, uncertainty),
            },
            {
                meta: { ...common, name: "messages.scheduleSms", description: "Schedule an SMS after strong approval", risk: "external-side-effect" as const, renderer: "action-proposal" as const, flagKey: "agent.capability.messages.scheduleSms" },
                inputSchema: ScheduledSmsSchema, outputSchema: SmsOutputSchema,
                formFields: SCHEDULED_SMS_FIELDS,
                inspect: async (_context, rawInput) => {
                    const input = ScheduledSmsSchema.parse(rawInput);
                    return {
                        title: "예약 문자 등록",
                        summary: `${input.scheduledDate} ${input.scheduledTime}에 ${maskedReceiver(input.receiver)} 번호로 발송합니다.`,
                        provider: "Aligo",
                        estimatedCost: `${resolveAligoSmsMessageType(input)} 요금제 기준`,
                    };
                },
                execute: async (context, rawInput) => {
                    const input = ScheduledSmsSchema.parse(rawInput);
                    const scheduledFor = new Date(`${input.scheduledDate}T${input.scheduledTime}:00+09:00`);
                    const job = await this.enqueueSms(context, input, scheduledFor, "AI 예약 문자");
                    return { status: "scheduled", msgType: resolveAligoSmsMessageType(input), messageId: undefined, jobId: job.id };
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
                classifyOutcome: (rawOutput) => SmsOutputSchema.parse(rawOutput).status === "canceled"
                    ? { status: "cancelled", reason: "SMS retry was cancelled before provider acceptance" }
                    : { status: "succeeded" },
                formFields: [{ name: "jobId", label: "실패한 발송 작업 ID", type: "text", required: true }],
                inspect: async (context, rawInput) => {
                    const input = RetrySmsSchema.parse(rawInput);
                    const job = await this.findRetryableJob(context.principal.branchId, input.jobId);
                    return {
                        targetVersion: this.jobTargetVersion(job),
                        targetSnapshot: { id: job.id, status: job.status, scheduledFor: job.scheduledFor.toISOString() },
                        title: "문자 재시도",
                        summary: `${job.id} 작업은 제공자가 명시적으로 거절한 건으로, 새 발송을 1회 시도합니다.`,
                        provider: "Aligo",
                        estimatedCost: `${job.payload.templateVariables["msgType"] ?? "SMS/LMS"} 요금제 기준`,
                    };
                },
                execute: async (context, rawInput) => {
                    const input = RetrySmsSchema.parse(rawInput);
                    if (!context.actionId) throw new AgentActionUncertainError("SMS retry action identity is missing");
                    const source = await this.findRetryableJob(context.principal.branchId, input.jobId);
                    const retry = await this.jobRepository.upsertPending(MessageTriggerJobEntity.create({
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
                            templateVariables: { ...source.payload.templateVariables, retrySafety: "pending-agent-retry" },
                        },
                    }));
                    const delivered = await this.messageTriggerService.dispatchPendingJobNow(retry.id);
                    if (delivered.status === "sent") return { status: "sent", jobId: retry.id };
                    if (delivered.status === "canceled") return { status: "canceled", jobId: retry.id };
                    throw new AgentActionUncertainError("SMS retry delivery status is uncertain", { jobId: retry.id });
                },
                revalidate: async (context, rawInput, expectedTargetVersion) => {
                    try {
                        const job = await this.findRetryableJob(context.principal.branchId, RetrySmsSchema.parse(rawInput).jobId);
                        const currentVersion = this.jobTargetVersion(job);
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
            inspect: async (_context, rawInput) => {
                const input = AutomationRuleBaseSchema.parse(rawInput);
                return { title: "메시지 자동화 생성", summary: `${input.name} 규칙을 ${input.isActive ? "활성" : "비활성"} 상태로 생성합니다.`, provider: "Message automation scheduler", estimatedCost: "활성 규칙이 발송하는 각 문자에 SMS/LMS 요금이 발생할 수 있습니다." };
            },
            execute: async (context, rawInput) => {
                const rule = await this.messageTriggerService.createRule(context.principal.branchId, AutomationRuleBaseSchema.parse(rawInput));
                const result = { status: "created", id: rule.id, isActive: rule.isActive };
                await recordAgentActionEffect(this.prisma, context, "automation.create", "automation-rule", rule.id, result);
                return result;
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
            } catch {
                return { status: "succeeded" as const, result: { status: "deleted", id: input.id } };
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
            inspect: async (context, rawInput) => {
                const input = inputSchema.parse(rawInput);
                const rule = await this.messageTriggerService.getRule(context.principal.branchId, input.id);
                return { targetVersion: this.ruleTargetVersion(rule), targetSnapshot: this.ruleView(rule), title: description, summary: `${rule.name} 규칙을 변경합니다.`, provider: "Message automation scheduler", estimatedCost: "활성 규칙이 발송하는 각 문자에 SMS/LMS 요금이 발생할 수 있습니다." };
            },
            execute: async (context, rawInput) => execute(context.principal.branchId, inputSchema.parse(rawInput)),
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
                const status = name === "automation.setActive"
                    ? (rule.isActive ? "enabled" : "disabled")
                    : "updated";
                return { status: "succeeded", result: { status, id: rule.id, isActive: rule.isActive } };
            } catch {
                return { status: "failed", reason: "Automation rule no longer exists" };
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
        input: z.infer<typeof SmsSchema>,
        scheduledFor: Date,
        ruleName: string,
    ): Promise<MessageTriggerJobEntity> {
        if (!context.actionId) throw new AgentActionUncertainError("SMS action identity is missing");
        const ruleId = `agent-sms:${context.principal.branchId}`;
        await this.prisma.message_trigger_rule.upsert({
            where: { id: ruleId },
            create: {
                id: ruleId,
                branchId: context.principal.branchId,
                name: ruleName,
                isActive: true,
                eventType: "CLIENT_CREATED",
                offsetType: "IMMEDIATE",
                offsetDays: 0,
                recipientType: MessageTriggerRecipientType.CLIENT,
                templateKey: MessageTriggerTemplateKey.INFO,
                isDefault: false,
                jobsStale: false,
            },
            update: { isActive: true },
        });
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
                    title: input.title ?? ruleName,
                    msgType: resolveAligoSmsMessageType(input),
                },
            },
        }));
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
        return { status: "uncertain" as const, reason: "SMS provider outcome cannot be proven from the local failed job" };
    }

    private async findRetryableJob(branchId: string, jobId: string): Promise<MessageTriggerJobEntity> {
        const job = await this.jobRepository.findById(jobId);
        if (!job || job.branchId !== branchId || job.status !== "failed" || job.payload.templateVariables["retrySafety"] !== "provider-rejected") {
            throw new Error("SMS job is not safely retryable in the current branch");
        }
        return job;
    }

    private jobTargetVersion(job: MessageTriggerJobEntity): string {
        return createHash("sha256").update(JSON.stringify({ id: job.id, branchId: job.branchId, status: job.status, updatedAt: job.updatedAt.toISOString(), retrySafety: job.payload.templateVariables["retrySafety"] })).digest("hex");
    }
}
