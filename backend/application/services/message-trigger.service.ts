import {
    BadRequestException,
    Inject,
    Injectable,
    Logger,
    NotFoundException,
    Optional,
    ServiceUnavailableException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "infrastructure/database/prisma.service";
import {
    MESSAGE_TRIGGER_TEMPLATE_CATALOG,
    EVENT_OFFSET_OPTIONS,
    EVENT_RECIPIENT_OPTIONS,
    getMessageTriggerTemplateCatalog,
    isCompatibleMessageTriggerTemplate,
    MessageTriggerEventType,
    MessageTriggerOffsetType,
    MessageTriggerRecipientType,
    MessageTriggerTemplateKey,
} from "domain/constants/message-trigger-catalog";
import {
    PAST_OCCURRENCE_GRACE_MS,
    SEND_HOUR_KST,
    TRIGGER_JOB_PROCESSING_RECLAIM_MS,
} from "domain/constants/message-automation-policy";
import { MessageTriggerRuleEntity } from "domain/entities/message-trigger-rule.entity";
import { MessageTriggerJobEntity } from "domain/entities/message-trigger-job.entity";
import { MessageLogEntity } from "domain/entities/message-log.entity";
import { TriggerJobDeferredError } from "domain/errors/trigger-job-deferred.error";
import {
    MESSAGE_TRIGGER_RULE_REPOSITORY,
    IMessageTriggerRuleRepository,
} from "domain/repositories/message-trigger-rule.repository.interface";
import {
    MESSAGE_TRIGGER_JOB_REPOSITORY,
    IMessageTriggerJobRepository,
} from "domain/repositories/message-trigger-job.repository.interface";
import {
    MESSAGE_LOG_REPOSITORY,
    IMessageLogRepository,
} from "domain/repositories/message-log.repository.interface";
import { MessageTriggerDeliveryService } from "./message-trigger-delivery.service";
import { hasColumn, hasTable } from "infrastructure/database/schema-capabilities";
import { MessageSenderApprovalService } from "./message-sender-approval.service";
import { buildSmsClientVariables } from "./sms-client-variables";
import { normalizePhone } from "application/utils/normalize-phone";
import { SystemSettingService } from "./system-setting.service";
import {
    DEFAULT_MESSAGE_AUTOMATION_PAST_TRIGGER_CONFIG,
    MessageAutomationPastTriggerConfig,
} from "domain/entities/system-setting.entity";

interface UpsertRuleParams {
    name: string;
    isActive?: boolean;
    eventType: MessageTriggerEventType;
    offsetType: MessageTriggerOffsetType;
    offsetDays?: number;
    recipientType: MessageTriggerRecipientType;
    templateKey: MessageTriggerTemplateKey;
}

const DEFAULT_SERVICE_INFO_TRIGGER: UpsertRuleParams = {
    name: "서비스 시작 7일 전 서비스 안내",
    isActive: true,
    eventType: MessageTriggerEventType.SERVICE_START,
    offsetType: MessageTriggerOffsetType.BEFORE_DAYS,
    offsetDays: 7,
    recipientType: MessageTriggerRecipientType.CLIENT,
    templateKey: MessageTriggerTemplateKey.SERVICE_INFO,
};

const DEFAULT_CLIENT_GREETING_TRIGGER: UpsertRuleParams = {
    name: "신규 고객 인사 메시지",
    isActive: true,
    eventType: MessageTriggerEventType.CLIENT_CREATED,
    offsetType: MessageTriggerOffsetType.IMMEDIATE,
    offsetDays: 0,
    recipientType: MessageTriggerRecipientType.CLIENT,
    templateKey: MessageTriggerTemplateKey.CLIENT_GREETING,
};

const MESSAGE_SENDER_APPROVAL_REQUIRED_CANCEL_REASON = "메시지 발송 승인 필요";
const ORPHANED_TRIGGER_JOB_CANCEL_REASON = "Related client or schedule deleted";
const EXPIRED_PENDING_JOB_CANCEL_REASON = "기존 발송 예정 24시간 경과";
const MISSING_CATCH_UP_PREDECESSOR_CANCEL_REASON = "보충 발송 이전 순위 job 없음";
const MS_PER_MINUTE = 60 * 1000;

function isPrismaUniqueViolation(error: unknown): boolean {
    return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

export interface UpcomingMessageTriggerJobView {
    id: string;
    ruleId: string;
    ruleName: string;
    eventType: MessageTriggerEventType | null;
    offsetType: MessageTriggerOffsetType | null;
    offsetDays: number;
    recipientType: MessageTriggerRecipientType;
    recipientPhone: string | null;
    templateKey: MessageTriggerTemplateKey;
    status: string;
    scheduledFor: Date;
    sentAt: Date | null;
    canceledAt: Date | null;
    cancelReason: string | null;
    clientId: number | null;
    employeeScheduleId: number | null;
    payload: MessageTriggerJobEntity["payload"];
    createdAt: Date;
    updatedAt: Date;
}

export interface MessageLogRecordView {
    id: number | string;
    provider: string;
    templateKey: string;
    triggerJobId: string | null;
    receiver: string;
    clientId: number | null;
    recipientPhone: string | null;
    messageBody: string;
    variables: Record<string, string>;
    status: MessageLogEntity["status"] | "canceled";
    aligoMid: string | null;
    errorMessage: string | null;
    attempts: number;
    lastAttemptAt: Date | null;
    nextRetryAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
    ruleId: string | null;
    ruleName: string | null;
    eventType: MessageTriggerEventType | null;
    offsetType: MessageTriggerOffsetType | null;
    offsetDays: number;
    scheduledFor: Date | null;
    recipientType: MessageTriggerRecipientType | null;
    recipientName: string | null;
    clientName: string | null;
    employeeName: string | null;
}

interface ClientTriggerSource {
    id: number;
    name: string;
    phone: string | null;
    type: string | null;
    startDate: Date | null;
    endDate: Date | null;
    createdAt?: Date | null;
    duration?: number | null;
    fullPrice?: string | null;
    grant?: string | null;
    actualPrice?: string | null;
    area?: { bankAccountInfo: { bankName: string | null; accNum: string | null } | null } | null;
}

type ClientRuleJobCandidate = {
    rule: MessageTriggerRuleEntity;
    job: MessageTriggerJobEntity;
};

@Injectable()
export class MessageTriggerService {
    private readonly logger = new Logger(MessageTriggerService.name);

    constructor(
        private readonly prisma: PrismaService,
        private readonly deliveryService: MessageTriggerDeliveryService,
        private readonly messageSenderApprovalService: MessageSenderApprovalService,
        @Inject(MESSAGE_TRIGGER_RULE_REPOSITORY)
        private readonly ruleRepository: IMessageTriggerRuleRepository,
        @Inject(MESSAGE_TRIGGER_JOB_REPOSITORY)
        private readonly jobRepository: IMessageTriggerJobRepository,
        @Inject(MESSAGE_LOG_REPOSITORY)
        private readonly messageLogRepository: IMessageLogRepository,
        @Optional()
        private readonly systemSettingService?: SystemSettingService,
    ) {}

    async listRules(branchId: string): Promise<MessageTriggerRuleEntity[]> {
        if (!(await this.hasTriggerSchema())) {
            return [];
        }
        const rules = await this.ruleRepository.findAll(branchId);
        if (!(await this.messageSenderApprovalService.isApproved(branchId))) {
            return rules;
        }
        return this.ensureDefaultServiceInfoTrigger(branchId, rules);
    }

    async ensureDefaultRulesForBranch(branchId: string): Promise<void> {
        if (!(await this.hasTriggerSchema())) return;
        if (!(await this.messageSenderApprovalService.isApproved(branchId))) return;

        const rules = await this.ruleRepository.findAll(branchId);
        await this.ensureDefaultServiceInfoTrigger(branchId, rules);
    }

    async listUpcomingJobs(
        branchId: string,
        limit = 200,
    ): Promise<UpcomingMessageTriggerJobView[]> {
        if (!(await this.hasTriggerSchema())) {
            return [];
        }

        await this.reconcileOrphanedClientJobs(branchId);
        const jobs = await this.jobRepository.findUpcomingPendingByBranch(branchId, limit);
        const manualScheduledLogs = await this.listManualScheduledSmsLogs(branchId, limit);
        if (jobs.length === 0 && manualScheduledLogs.length === 0) {
            return [];
        }

        const rules = jobs.length > 0 ? await this.ruleRepository.findAll(branchId) : [];
        const rulesById = new Map(rules.map((rule) => [rule.id, rule]));

        const triggerJobs = jobs.map((job): UpcomingMessageTriggerJobView => {
            const rule = rulesById.get(job.ruleId);

            return {
                id: job.id,
                ruleId: job.ruleId,
                ruleName: rule?.name ?? "알 수 없는 규칙",
                eventType: rule?.eventType ?? null,
                offsetType: rule?.offsetType ?? null,
                offsetDays: rule?.offsetDays ?? 0,
                recipientType: job.recipientType,
                recipientPhone: job.recipientPhone,
                templateKey: job.templateKey,
                status: job.status,
                scheduledFor: job.scheduledFor,
                sentAt: job.sentAt,
                canceledAt: job.canceledAt,
                cancelReason: job.cancelReason,
                clientId: job.clientId,
                employeeScheduleId: job.employeeScheduleId,
                payload: job.payload,
                createdAt: job.createdAt,
                updatedAt: job.updatedAt,
            };
        });

        return [...triggerJobs, ...manualScheduledLogs]
            .sort((left, right) => left.scheduledFor.getTime() - right.scheduledFor.getTime())
            .slice(0, limit);
    }

    async listHistory(
        branchId: string,
        limit = 200,
        skip = 0,
    ): Promise<MessageLogRecordView[]> {
        const candidateLimit = limit + skip;
        const hasMessageLogTable = await hasTable(this.prisma, "message_log");
        const logs = hasMessageLogTable
            ? await this.messageLogRepository.findRecentByBranch(branchId, candidateLimit, 0)
            : [];
        const terminalJobs = await this.hasTriggerSchema()
            ? await this.jobRepository.findTerminalByBranch(branchId, candidateLimit)
            : [];

        if (logs.length === 0 && terminalJobs.length === 0) {
            return [];
        }

        const triggerJobIds = logs
            .map((log) => log.triggerJobId)
            .filter((id): id is string => !!id);

        const jobs = triggerJobIds.length > 0
            ? await this.prisma.message_trigger_job.findMany({
                where: { id: { in: triggerJobIds } },
                select: {
                    id: true,
                    ruleId: true,
                    scheduledFor: true,
                    recipientType: true,
                    payload: true,
                },
            })
            : [];

        const jobsById = new Map(jobs.map((job) => [job.id, job]));
        const rules = await this.ruleRepository.findAll(branchId);
        const rulesById = new Map(rules.map((rule) => [rule.id, rule]));

        const logRecords = logs.map((log): MessageLogRecordView => {
            const job = log.triggerJobId ? jobsById.get(log.triggerJobId) : null;
            const payload = (job?.payload as MessageTriggerJobEntity["payload"] | undefined) ?? null;
            const rule = job ? rulesById.get(job.ruleId) ?? null : null;

            return {
                id: log.id,
                provider: log.provider,
                templateKey: log.templateKey,
                triggerJobId: log.triggerJobId,
                receiver: log.receiver,
                clientId: log.clientId,
                recipientPhone: log.recipientPhone ?? log.receiver,
                messageBody: log.messageBody,
                variables: log.variables,
                status: log.status,
                aligoMid: log.aligoMid,
                errorMessage: log.errorMessage,
                attempts: log.attempts,
                lastAttemptAt: log.lastAttemptAt,
                nextRetryAt: log.nextRetryAt,
                createdAt: log.createdAt,
                updatedAt: log.updatedAt,
                ruleId: job?.ruleId ?? null,
                ruleName: rule?.name ?? null,
                eventType: rule?.eventType ?? null,
                offsetType: rule?.offsetType ?? null,
                offsetDays: rule?.offsetDays ?? 0,
                scheduledFor: job?.scheduledFor ?? null,
                recipientType: (job?.recipientType as MessageTriggerRecipientType | undefined) ?? null,
                recipientName: log.recipientName ?? payload?.recipientName ?? null,
                clientName: payload?.clientName ?? null,
                employeeName: payload?.employeeName ?? null,
            };
        });

        const loggedTriggerJobIds = new Set(
            logs
                .map((log) => log.triggerJobId)
                .filter((id): id is string => Boolean(id)),
        );
        const terminalJobRecords = terminalJobs
            .filter((job) => !loggedTriggerJobIds.has(job.id))
            .map((job): MessageLogRecordView => {
                const rule = rulesById.get(job.ruleId) ?? null;
                const receiver = job.recipientPhone ?? job.payload.recipientPhone ?? "";

                return {
                    id: `job:${job.id}`,
                    provider: "message_job",
                    templateKey: job.templateKey,
                    triggerJobId: job.id,
                    receiver,
                    clientId: job.clientId,
                    recipientPhone: receiver || null,
                    messageBody: job.payload.messageBody ?? "",
                    variables: {
                        ...job.payload.templateVariables,
                        recipientName: job.payload.recipientName,
                        historySource: "message_trigger_job",
                    },
                    status: job.status === "canceled" ? "canceled" : "failed",
                    aligoMid: null,
                    errorMessage: job.cancelReason,
                    attempts: job.attempts,
                    lastAttemptAt: job.updatedAt,
                    nextRetryAt: null,
                    createdAt: job.createdAt,
                    updatedAt: job.updatedAt,
                    ruleId: job.ruleId,
                    ruleName: rule?.name ?? null,
                    eventType: rule?.eventType ?? null,
                    offsetType: rule?.offsetType ?? null,
                    offsetDays: rule?.offsetDays ?? 0,
                    scheduledFor: job.scheduledFor,
                    recipientType: job.recipientType,
                    recipientName: job.payload.recipientName,
                    clientName: job.payload.clientName ?? null,
                    employeeName: job.payload.employeeName ?? null,
                };
            });

        return [...logRecords, ...terminalJobRecords]
            .sort((left, right) => right.updatedAt.getTime() - left.updatedAt.getTime())
            .slice(skip, skip + limit);
    }

    async getRule(branchId: string, id: string): Promise<MessageTriggerRuleEntity> {
        await this.ensureTriggerSchemaReady();
        const rule = await this.ruleRepository.findById(branchId, id);
        if (!rule) {
            throw new NotFoundException(`Trigger rule ${id} not found`);
        }
        return rule;
    }

    listTemplates(params: {
        eventType?: MessageTriggerEventType;
        recipientType?: MessageTriggerRecipientType;
    }) {
        return getMessageTriggerTemplateCatalog("sms").filter((item) => {
            if (params.eventType && !item.allowedEventTypes.includes(params.eventType)) return false;
            if (
                params.recipientType &&
                !item.allowedRecipientTypes.includes(params.recipientType)
            ) {
                return false;
            }
            return true;
        });
    }

    async createRule(
        branchId: string,
        params: UpsertRuleParams,
        transaction?: Prisma.TransactionClient,
    ): Promise<MessageTriggerRuleEntity> {
        await this.ensureTriggerSchemaReady();
        await this.messageSenderApprovalService.ensureApproved(branchId);
        this.validateRule(params);
        const rule = await this.ruleRepository.create(
            branchId,
            MessageTriggerRuleEntity.create({
                branchId,
                ...params,
                offsetDays: this.normalizeOffsetDays(params.offsetType, params.offsetDays),
            }),
            transaction,
        );
        await this.ruleRepository.markJobsStale(rule.id, transaction);
        return rule;
    }

    async updateRule(
        branchId: string,
        id: string,
        params: Partial<UpsertRuleParams>,
    ): Promise<MessageTriggerRuleEntity> {
        await this.ensureTriggerSchemaReady();
        await this.messageSenderApprovalService.ensureApproved(branchId);
        const rule = await this.getRule(branchId, id);
        const nextState: UpsertRuleParams = {
            name: params.name ?? rule.name,
            isActive: params.isActive ?? rule.isActive,
            eventType: params.eventType ?? rule.eventType,
            offsetType: params.offsetType ?? rule.offsetType,
            offsetDays: params.offsetDays ?? rule.offsetDays,
            recipientType: params.recipientType ?? rule.recipientType,
            templateKey: params.templateKey ?? rule.templateKey,
        };

        this.validateRule(nextState);
        rule.update({
            ...nextState,
            offsetDays: this.normalizeOffsetDays(nextState.offsetType, nextState.offsetDays),
        });
        const updated = await this.ruleRepository.update(branchId, rule);
        await this.cancelPendingJobsForRule(updated.id, "Rule updated");
        await this.ruleRepository.markJobsStale(updated.id);
        return updated;
    }

    async deleteRule(branchId: string, id: string): Promise<void> {
        await this.ensureTriggerSchemaReady();
        await this.getRule(branchId, id);
        await this.cancelPendingJobsForRule(id, "Rule deleted");
        await this.ruleRepository.delete(branchId, id);
    }

    async dispatchDueJobs(): Promise<void> {
        if (!(await this.hasTriggerSchema())) {
            return;
        }

        await this.jobRepository.cancelOrphanedPending(ORPHANED_TRIGGER_JOB_CANCEL_REASON);
        await this.reclaimStaleProcessingJobs();
        const jobs = await this.jobRepository.findDuePending(100);

        if (jobs.length > 0) {
            const approvedBranchIds = await this.messageSenderApprovalService.getApprovedBranchIds(
                [...new Set(jobs.map((job) => job.branchId).filter((id): id is string => !!id))],
            );
            const sentIds = await this.messageLogRepository.findSentTriggerJobIds(
                jobs.map((job) => job.id),
            );
            for (const job of jobs) {
                try {
                    await this.dispatchClaimedJob(job, sentIds, approvedBranchIds);
                } catch (error) {
                    this.logger.error(
                        `[Message Automation] Failed to dispatch trigger job ${job.id}`,
                        error instanceof Error ? error.stack : String(error),
                    );
                }
            }
        }

        await this.recoverApprovedBranches();
        await this.processStaleRuleRebuilds();
    }

    async dispatchPendingJobNow(jobId: string): Promise<MessageTriggerJobEntity> {
        const job = await this.jobRepository.findById(jobId);
        if (!job) {
            throw new NotFoundException("Message trigger job not found");
        }
        if (job.status !== "pending") {
            return job;
        }

        const approvedBranchIds = await this.messageSenderApprovalService.getApprovedBranchIds(
            job.branchId ? [job.branchId] : [],
        );
        const sentIds = await this.messageLogRepository.findSentTriggerJobIds([job.id]);
        await this.dispatchClaimedJob(job, sentIds, approvedBranchIds);

        return await this.jobRepository.findById(jobId) ?? job;
    }

    async syncClientRulesForClient(
        branchId: string,
        clientId: number,
        includePast: boolean,
        suppressGreeting = false,
    ): Promise<void> {
        if (!(await this.hasTriggerSchema())) {
            return;
        }

        if (!(await this.messageSenderApprovalService.isApproved(branchId))) {
            return;
        }

        const supportsCreatedAt = await hasColumn(this.prisma, "client", "created_at");
        const supportsAreaId = await hasColumn(this.prisma, "client", "area_id");
        // Prisma's type inference does not correctly narrow the `area` relation type when
        // the select key is inside a conditional spread; cast to ClientTriggerSource explicitly.
        const client = await this.prisma.client.findFirst({
            where: { id: clientId, branchId },
            select: {
                id: true,
                name: true,
                phone: true,
                type: true,
                startDate: true,
                endDate: true,
                duration: true,
                fullPrice: true,
                grant: true,
                actualPrice: true,
                ...(supportsAreaId ? { area: { select: { bankAccountInfo: { select: { bankName: true, accNum: true } } } } } : {}),
                ...(supportsCreatedAt ? { createdAt: true } : {}),
            },
        }) as ClientTriggerSource | null;
        if (!client) return;

        const rules = await this.ruleRepository.findActiveByEventTypes(branchId, [
            MessageTriggerEventType.CLIENT_CREATED,
            MessageTriggerEventType.SERVICE_START,
            MessageTriggerEventType.SERVICE_END,
        ]);

        if (includePast) {
            await this.cancelPendingJobsForClient(
                rules.map((rule) => rule.id),
                clientId,
                "Client data changed",
            );
        } else {
            const immediateRules = rules.filter(
                (rule) => rule.offsetType === MessageTriggerOffsetType.IMMEDIATE,
            );
            const nonImmediateRules = rules.filter(
                (rule) => rule.offsetType !== MessageTriggerOffsetType.IMMEDIATE,
            );

            if (nonImmediateRules.length > 0) {
                await this.cancelPendingJobsForClient(
                    nonImmediateRules.map((rule) => rule.id),
                    clientId,
                    "Client data changed",
                );
            }

            await this.refreshPendingImmediateClientJobs(immediateRules, clientId, client);
        }

        const candidateJobs: ClientRuleJobCandidate[] = [];
        for (const rule of rules) {
            if (rule.eventType === MessageTriggerEventType.CLIENT_CREATED && !supportsCreatedAt) {
                continue;
            }
            if (rule.templateKey === MessageTriggerTemplateKey.CLIENT_GREETING && suppressGreeting) {
                continue;
            }
            if (includePast && this.shouldSkipPreStartCatchUp(rule, client)) {
                continue;
            }
            const job = this.buildClientJob(rule, client);
            if (!job) continue;
            candidateJobs.push({ rule, job });
        }

        const jobsToPersist = includePast
            ? await this.applyRetroactiveSendConfig(branchId, candidateJobs)
            : candidateJobs;

        for (const { rule, job } of jobsToPersist) {
            await this.persistPendingJob(job, rule, includePast);
        }
    }

    async cancelPendingJobsForClientDeletion(branchId: string, clientId: number): Promise<void> {
        if (!(await this.hasTriggerSchema())) {
            return;
        }

        await this.jobRepository.cancelPendingByClientContext(
            branchId,
            clientId,
            "Client deleted",
        );
    }

    private async reconcileOrphanedClientJobs(branchId: string): Promise<void> {
        const orphanedJobs = await this.jobRepository.findRecoverableOrphanedClientJobs(branchId);
        await this.jobRepository.cancelOrphanedPending(
            ORPHANED_TRIGGER_JOB_CANCEL_REASON,
            branchId,
        );
        if (orphanedJobs.length === 0) {
            return;
        }
        if (!(await this.messageSenderApprovalService.isApproved(branchId))) {
            return;
        }

        const clients = await this.prisma.client.findMany({
            where: { branchId, phone: { not: null } },
            select: { id: true, phone: true, createdAt: true, suppressGreetingSms: true },
        });
        const clientsByPhone = new Map<string, typeof clients>();
        for (const client of clients) {
            const phone = normalizePhone(client.phone);
            if (!phone) continue;
            const matches = clientsByPhone.get(phone) ?? [];
            matches.push(client);
            clientsByPhone.set(phone, matches);
        }

        const orphanIdsByReplacementClient = new Map<number, string[]>();
        for (const job of orphanedJobs) {
            const phone = normalizePhone(job.recipientPhone ?? job.payload.recipientPhone);
            if (!phone) continue;
            const matches = clientsByPhone.get(phone) ?? [];
            if (matches.length !== 1) continue;
            const [replacementClient] = matches;
            if (!replacementClient || replacementClient.createdAt <= job.createdAt) continue;

            const jobIds = orphanIdsByReplacementClient.get(replacementClient.id) ?? [];
            jobIds.push(job.id);
            orphanIdsByReplacementClient.set(replacementClient.id, jobIds);
        }

        for (const [clientId, jobIds] of orphanIdsByReplacementClient) {
            const client = clients.find((candidate) => candidate.id === clientId);
            await this.syncClientRulesForClient(
                branchId,
                clientId,
                true,
                client?.suppressGreetingSms ?? false,
            );
            await this.jobRepository.markOrphanedJobsReconciled(jobIds, clientId);
        }
    }

    async syncEmployeeAssignmentRulesForSchedule(
        branchId: string,
        employeeScheduleId: number,
        includePast: boolean,
    ): Promise<void> {
        if (!(await this.hasTriggerSchema())) {
            return;
        }
        if (!(await this.messageSenderApprovalService.isApproved(branchId))) {
            return;
        }

        const schedule = await this.prisma.employee_schedule.findFirst({
            where: { id: employeeScheduleId, branchId },
            include: {
                client: true,
                primaryEmployee: true,
                secondaryEmployee: true,
            },
        });
        if (!schedule) return;

        const rules = await this.ruleRepository.findActiveByEventTypes(branchId, [
            MessageTriggerEventType.EMPLOYEE_ASSIGNED,
        ]);

        await this.cancelPendingJobsForEmployeeSchedule(
            rules.map((rule) => rule.id),
            employeeScheduleId,
            "Employee assignment changed",
        );

        for (const rule of rules) {
            const job = this.buildEmployeeAssignmentJob(rule, schedule);
            if (!job) continue;
            if (await this.hasSentEmployeeAssignmentJobForSameEmployee(job)) {
                continue;
            }
            await this.persistPendingJob(job, rule, includePast);
        }
    }

    async hasActiveRulesForEvents(
        branchId: string,
        eventTypes: MessageTriggerEventType[],
    ): Promise<boolean> {
        if (!(await this.hasTriggerSchema())) {
            return false;
        }
        const rules = await this.ruleRepository.findActiveByEventTypes(branchId, eventTypes);
        return rules.length > 0;
    }

    private async ensureDefaultTrigger(
        branchId: string,
        rules: MessageTriggerRuleEntity[],
        defaults: UpsertRuleParams,
        matchTemplateKeyOnly = false,
    ): Promise<{ rules: MessageTriggerRuleEntity[]; created: MessageTriggerRuleEntity | null }> {
        const matchesDefault = (rule: MessageTriggerRuleEntity): boolean => {
            if (matchTemplateKeyOnly) {
                return rule.templateKey === defaults.templateKey;
            }

            return (
                rule.eventType === defaults.eventType &&
                rule.offsetType === defaults.offsetType &&
                rule.offsetDays === (defaults.offsetDays ?? 0) &&
                rule.recipientType === defaults.recipientType &&
                rule.templateKey === defaults.templateKey
            );
        };

        // Once a provisioned default exists, admin edits must be respected. Template-key-only
        // matching prevents an edited default from being silently recreated with the old tuple.
        const existing = rules.find(matchesDefault);
        if (existing) return { rules, created: null };

        let created: MessageTriggerRuleEntity;
        try {
            created = await this.ruleRepository.create(
                branchId,
                MessageTriggerRuleEntity.create({
                    branchId,
                    ...defaults,
                    isDefault: true,
                }),
            );
        } catch (error) {
            if (!isPrismaUniqueViolation(error)) {
                throw error;
            }

            const latestRules = await this.ruleRepository.findAll(branchId);
            const existingAfterRace = latestRules.find(matchesDefault);
            if (existingAfterRace) {
                return { rules: latestRules, created: null };
            }
            throw error;
        }
        await this.rebuildJobsForRule(branchId, created, false);
        return { rules: [created, ...rules], created };
    }

    private async ensureDefaultServiceInfoTrigger(
        branchId: string,
        rules: MessageTriggerRuleEntity[],
    ): Promise<MessageTriggerRuleEntity[]> {
        if (!branchId) return rules;

        const { rules: rulesAfterServiceInfo } = await this.ensureDefaultTrigger(
            branchId,
            rules,
            DEFAULT_SERVICE_INFO_TRIGGER,
            true,
        );

        const { rules: finalRules } = await this.ensureDefaultTrigger(
            branchId,
            rulesAfterServiceInfo,
            DEFAULT_CLIENT_GREETING_TRIGGER,
            true,
        );

        return finalRules;
    }

    private async rebuildJobsForRule(
        branchId: string | null,
        rule: MessageTriggerRuleEntity,
        includePast: boolean,
    ): Promise<void> {
        if (!rule.isActive) return;
        if (!branchId) return;

        if (!(await this.messageSenderApprovalService.isApproved(branchId))) {
            return;
        }

        if (rule.eventType === MessageTriggerEventType.EMPLOYEE_ASSIGNED) {
            return;
        }

        if (rule.offsetType === MessageTriggerOffsetType.IMMEDIATE) return;

        const supportsCreatedAt = await hasColumn(this.prisma, "client", "created_at");
        if (rule.eventType === MessageTriggerEventType.CLIENT_CREATED && !supportsCreatedAt) {
            return;
        }

        const supportsAreaId = await hasColumn(this.prisma, "client", "area_id");
        // Prisma's type inference does not correctly narrow the `area` relation type when
        // the select key is inside a conditional spread; cast to ClientTriggerSource[] explicitly.
        const clients = await this.prisma.client.findMany({
            where: { branchId },
            select: {
                id: true,
                name: true,
                phone: true,
                type: true,
                startDate: true,
                endDate: true,
                duration: true,
                fullPrice: true,
                grant: true,
                actualPrice: true,
                ...(supportsAreaId ? { area: { select: { bankAccountInfo: { select: { bankName: true, accNum: true } } } } } : {}),
                ...(supportsCreatedAt ? { createdAt: true } : {}),
            },
        }) as ClientTriggerSource[];

        for (const client of clients) {
            const job = this.buildClientJob(rule, client);
            await this.persistPendingJob(job, rule, includePast);
        }
    }

    private async persistPendingJob(
        job: MessageTriggerJobEntity | null,
        rule: MessageTriggerRuleEntity,
        includePast: boolean,
    ): Promise<void> {
        if (!job) return;
        if (!includePast) {
            const now = Date.now();
            const scheduledForTime = job.scheduledFor.getTime();
            if (scheduledForTime < now - PAST_OCCURRENCE_GRACE_MS) {
                return;
            }

            // IMMEDIATE jobs must fire only on the live create/assign path (includePast=true).
            if (
                rule.offsetType === MessageTriggerOffsetType.IMMEDIATE &&
                scheduledForTime <= now
            ) {
                return;
            }
        }
        await this.jobRepository.upsertPending(job);
    }

    private async applyRetroactiveSendConfig(
        branchId: string,
        candidates: ClientRuleJobCandidate[],
    ): Promise<ClientRuleJobCandidate[]> {
        if (candidates.length === 0) return candidates;

        const config = await this.getRetroactiveSendConfig(branchId);
        const now = Date.now();
        const baseScheduledFor = new Date(now);
        const dueCandidates = candidates.filter(({ job }) => job.scheduledFor.getTime() <= now);
        const futureCandidates = candidates
            .filter(({ job }) => job.scheduledFor.getTime() > now)
            .sort((left, right) => left.job.scheduledFor.getTime() - right.job.scheduledFor.getTime());

        const orderedDueCandidates = this.orderRetroactiveCandidates(
            dueCandidates,
            config.ruleOrder,
        );

        orderedDueCandidates.forEach(({ rule, job }, index) => {
            const originalScheduledFor = job.scheduledFor.toISOString();
            const scheduledFor = new Date(
                baseScheduledFor.getTime() + (index * config.sendIntervalMinutes * MS_PER_MINUTE),
            );
            job.scheduledFor = scheduledFor;
            if (job.clientId !== null) {
                job.dedupeKey = this.buildDedupeKey(
                    rule.id,
                    `client:${job.clientId}`,
                    scheduledFor,
                    rule.recipientType,
                );
            }
            job.payload.catchUp = {
                batchId: `client:${job.clientId ?? "unknown"}:${baseScheduledFor.toISOString()}`,
                sequence: index + 1,
                intervalMinutes: config.sendIntervalMinutes,
                originalScheduledFor,
                predecessorDedupeKey: index > 0
                    ? orderedDueCandidates[index - 1]?.job.dedupeKey ?? null
                    : null,
            };
        });

        return [...orderedDueCandidates, ...futureCandidates];
    }

    private async getRetroactiveSendConfig(
        branchId: string,
    ): Promise<MessageAutomationPastTriggerConfig> {
        if (!this.systemSettingService) {
            return DEFAULT_MESSAGE_AUTOMATION_PAST_TRIGGER_CONFIG;
        }
        return this.systemSettingService.getMessageAutomationPastTriggerConfig(branchId);
    }

    private orderRetroactiveCandidates(
        candidates: ClientRuleJobCandidate[],
        ruleOrder: string[],
    ): ClientRuleJobCandidate[] {
        const orderMap = new Map(ruleOrder.map((ruleId, index) => [ruleId, index]));

        return [...candidates].sort((left, right) => {
            const leftOrder = orderMap.get(left.rule.id);
            const rightOrder = orderMap.get(right.rule.id);

            if (leftOrder !== undefined && rightOrder !== undefined) {
                return leftOrder - rightOrder;
            }
            if (leftOrder !== undefined) return -1;
            if (rightOrder !== undefined) return 1;

            const scheduledForDiff = left.job.scheduledFor.getTime() - right.job.scheduledFor.getTime();
            if (scheduledForDiff !== 0) return scheduledForDiff;

            return left.rule.createdAt.getTime() - right.rule.createdAt.getTime();
        });
    }

    private async refreshPendingImmediateClientJobs(
        rules: MessageTriggerRuleEntity[],
        clientId: number,
        client: ClientTriggerSource,
    ): Promise<void> {
        if (rules.length === 0) return;

        const rulesById = new Map(rules.map((rule) => [rule.id, rule]));
        const jobs = await this.jobRepository.findPendingByRuleIdsAndClientId(
            rules.map((rule) => rule.id),
            clientId,
        );

        for (const job of jobs) {
            const rule = rulesById.get(job.ruleId);
            if (!rule) continue;

            const refreshedJob = this.buildClientJob(rule, client);
            if (!refreshedJob) continue;

            job.recipientPhone = refreshedJob.recipientPhone;
            job.payload = {
                ...refreshedJob.payload,
                ...(job.payload.catchUp ? { catchUp: job.payload.catchUp } : {}),
            };
            await this.jobRepository.update(job);
        }
    }

    private buildClientJob(
        rule: MessageTriggerRuleEntity,
        client: ClientTriggerSource,
    ): MessageTriggerJobEntity | null {
        if (!client.phone) return null;

        const anchorDate = this.getClientAnchorDate(rule.eventType, client);
        if (!anchorDate) return null;

        const scheduledFor = this.computeScheduledFor(anchorDate, rule);
        const payload = {
            clientId: client.id,
            clientName: client.name,
            memberId: client.id.toString(),
            recipientName: client.name,
            recipientPhone: client.phone,
            templateVariables: this.buildClientTemplateVariables(rule, client),
        };

        return MessageTriggerJobEntity.create({
            branchId: rule.branchId ?? undefined,
            ruleId: rule.id,
            scheduledFor,
            clientId: client.id,
            recipientType: rule.recipientType,
            recipientPhone: client.phone,
            templateKey: rule.templateKey,
            dedupeKey: this.buildDedupeKey(rule.id, `client:${client.id}`, scheduledFor, rule.recipientType),
            payload,
        });
    }

    private buildEmployeeAssignmentJob(
        rule: MessageTriggerRuleEntity,
        schedule: {
            id: number;
            clientId: number;
            startDate: Date;
            primaryEmployeeId: number;
            secondaryEmployeeId: number | null;
            client: { id: number; name: string };
            primaryEmployee: { id: number; name: string; phone: string } | null;
            secondaryEmployee: { id: number; name: string; phone: string } | null;
        },
    ): MessageTriggerJobEntity | null {
        const employee =
            rule.recipientType === MessageTriggerRecipientType.PRIMARY_EMPLOYEE
                ? schedule.primaryEmployee
                : schedule.secondaryEmployee;
        if (!employee?.phone) return null;

        const scheduledFor = new Date();
        const memberId = `employee:${employee.id}`;
        return MessageTriggerJobEntity.create({
            branchId: rule.branchId ?? undefined,
            ruleId: rule.id,
            scheduledFor,
            clientId: schedule.clientId,
            employeeScheduleId: schedule.id,
            recipientType: rule.recipientType,
            recipientPhone: employee.phone,
            templateKey: rule.templateKey,
            dedupeKey: `${rule.id}:schedule:${schedule.id}:employee:${employee.id}:${rule.recipientType}`,
            payload: {
                clientId: schedule.clientId,
                clientName: schedule.client.name,
                employeeId: employee.id,
                employeeName: employee.name,
                memberId,
                recipientName: employee.name,
                recipientPhone: employee.phone,
                templateVariables: {
                    employeeName: employee.name,
                    clientName: schedule.client.name,
                    serviceStartDate: this.formatDate(schedule.startDate),
                },
            },
        });
    }

    private async hasSentEmployeeAssignmentJobForSameEmployee(
        job: MessageTriggerJobEntity,
    ): Promise<boolean> {
        if (job.employeeScheduleId === null) return false;

        const sentJobs = await this.jobRepository.findSentByRuleIdAndEmployeeScheduleId(
            job.ruleId,
            job.employeeScheduleId,
        );
        return sentJobs.some((sentJob) => this.isSameEmployeeAssignmentRecipient(sentJob, job));
    }

    private isSameEmployeeAssignmentRecipient(
        sentJob: MessageTriggerJobEntity,
        newJob: MessageTriggerJobEntity,
    ): boolean {
        if (sentJob.recipientType !== newJob.recipientType) return false;

        const sentEmployeeId = sentJob.payload.employeeId;
        const newEmployeeId = newJob.payload.employeeId;
        if (typeof sentEmployeeId === "number" && typeof newEmployeeId === "number") {
            return sentEmployeeId === newEmployeeId;
        }

        return Boolean(
            sentJob.recipientPhone &&
            newJob.recipientPhone &&
            sentJob.recipientPhone === newJob.recipientPhone,
        );
    }

    private buildClientTemplateVariables(
        rule: MessageTriggerRuleEntity,
        client: ClientTriggerSource,
    ): Record<string, string> {
        switch (rule.templateKey) {
            case MessageTriggerTemplateKey.CLIENT_WELCOME:
                return {
                    clientName: client.name,
                    registrationDate: this.formatDate(client.createdAt ?? null),
                    serviceType: client.type ?? "방문요양",
                };
            case MessageTriggerTemplateKey.SERVICE_START_REMINDER:
                return {
                    clientName: client.name,
                    serviceStartDate: this.formatDate(client.startDate),
                    timingText: this.describeTiming(rule, "서비스 시작"),
                };
            case MessageTriggerTemplateKey.SERVICE_END_REMINDER:
                return {
                    clientName: client.name,
                    serviceEndDate: this.formatDate(client.endDate),
                    timingText: this.describeTiming(rule, "서비스 종료"),
                };
            case MessageTriggerTemplateKey.PRICE_INFO:
                // PRICE_INFO is the only SMS template that renders price/bank fields,
                // so it is the only one that carries them into the job payload (data minimization).
                return buildSmsClientVariables(client);
            case MessageTriggerTemplateKey.SERVICE_INFO:
            case MessageTriggerTemplateKey.CLIENT_GREETING:
            case MessageTriggerTemplateKey.REMINDER:
            case MessageTriggerTemplateKey.THANKS:
            case MessageTriggerTemplateKey.SURVEY:
            case MessageTriggerTemplateKey.INFO:
                return { name: client.name, clientName: client.name, phone: client.phone ?? "" };
            default:
                return {};
        }
    }

    private getClientAnchorDate(
        eventType: MessageTriggerEventType,
        client: Pick<ClientTriggerSource, "createdAt" | "startDate" | "endDate">,
    ): Date | null {
        switch (eventType) {
            case MessageTriggerEventType.CLIENT_CREATED:
                return client.createdAt ?? null;
            case MessageTriggerEventType.SERVICE_START:
                return client.startDate;
            case MessageTriggerEventType.SERVICE_END:
                return client.endDate;
            default:
                return null;
        }
    }

    private computeScheduledFor(anchorDate: Date, rule: MessageTriggerRuleEntity): Date {
        if (rule.offsetType === MessageTriggerOffsetType.IMMEDIATE) {
            return new Date();
        }

        let offsetDays = 0;
        if (rule.offsetType === MessageTriggerOffsetType.BEFORE_DAYS) {
            offsetDays = -rule.offsetDays;
        } else if (rule.offsetType === MessageTriggerOffsetType.AFTER_DAYS) {
            offsetDays = rule.offsetDays;
        }

        const targetDate = this.getKstCalendarDate(anchorDate, offsetDays);
        const sendHour = String(SEND_HOUR_KST).padStart(2, "0");
        return new Date(`${targetDate}T${sendHour}:00:00+09:00`);
    }

    private getKstCalendarDate(referenceDate: Date, offsetDays: number): string {
        const formatter = new Intl.DateTimeFormat("en-CA", {
            timeZone: "Asia/Seoul",
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
        });
        const parts = new Map(
            formatter.formatToParts(referenceDate).map((part) => [part.type, part.value]),
        );
        const year = Number(parts.get("year"));
        const month = Number(parts.get("month"));
        const day = Number(parts.get("day"));
        const date = new Date(Date.UTC(year, month - 1, day));
        date.setUTCDate(date.getUTCDate() + offsetDays);
        return [
            date.getUTCFullYear(),
            String(date.getUTCMonth() + 1).padStart(2, "0"),
            String(date.getUTCDate()).padStart(2, "0"),
        ].join("-");
    }

    private buildDedupeKey(
        ruleId: string,
        sourceKey: string,
        scheduledFor: Date,
        recipientType: MessageTriggerRecipientType,
    ): string {
        return `${ruleId}:${sourceKey}:${recipientType}:${scheduledFor.toISOString()}`;
    }

    private describeTiming(rule: MessageTriggerRuleEntity, anchorLabel: string): string {
        switch (rule.offsetType) {
            case MessageTriggerOffsetType.SAME_DAY:
                return `${anchorLabel} 당일 안내`;
            case MessageTriggerOffsetType.BEFORE_DAYS:
                return `${anchorLabel} ${rule.offsetDays}일 전 안내`;
            case MessageTriggerOffsetType.AFTER_DAYS:
                return `${anchorLabel} ${rule.offsetDays}일 후 안내`;
            case MessageTriggerOffsetType.IMMEDIATE:
                return "즉시 안내";
            default:
                return "알림 안내";
        }
    }

    private formatDate(date: Date | null): string {
        if (!date) return "";
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, "0");
        const day = String(date.getDate()).padStart(2, "0");
        return `${year}-${month}-${day}`;
    }

    private normalizeOffsetDays(
        offsetType: MessageTriggerOffsetType,
        offsetDays?: number,
    ): number {
        if (
            offsetType === MessageTriggerOffsetType.IMMEDIATE ||
            offsetType === MessageTriggerOffsetType.SAME_DAY
        ) {
            return 0;
        }
        return offsetDays ?? 0;
    }

    private validateRule(params: UpsertRuleParams): void {
        const template = MESSAGE_TRIGGER_TEMPLATE_CATALOG[params.templateKey];
        if (!template) {
            throw new BadRequestException("Unknown template key");
        }

        if (!template.providers.sms) {
            throw new BadRequestException("SMS 발송 채널이 없는 템플릿입니다.");
        }

        if (!EVENT_RECIPIENT_OPTIONS[params.eventType].includes(params.recipientType)) {
            throw new BadRequestException("Invalid recipient for selected event type");
        }

        if (!EVENT_OFFSET_OPTIONS[params.eventType].includes(params.offsetType)) {
            throw new BadRequestException("Invalid offset type for selected event type");
        }

        const normalizedOffsetDays = this.normalizeOffsetDays(params.offsetType, params.offsetDays);
        if (
            (params.offsetType === MessageTriggerOffsetType.BEFORE_DAYS ||
                params.offsetType === MessageTriggerOffsetType.AFTER_DAYS) &&
            normalizedOffsetDays <= 0
        ) {
            throw new BadRequestException("Offset days must be greater than 0");
        }

        if (
            !isCompatibleMessageTriggerTemplate({
                templateKey: params.templateKey,
                eventType: params.eventType,
                recipientType: params.recipientType,
            })
        ) {
            throw new BadRequestException("Template is not compatible with the selected event and recipient");
        }

    }

    private async cancelPendingJobsForRule(ruleId: string, reason: string): Promise<void> {
        await this.jobRepository.cancelPendingByRuleId(ruleId, reason);
    }

    private async listManualScheduledSmsLogs(
        branchId: string,
        limit: number,
    ): Promise<UpcomingMessageTriggerJobView[]> {
        if (!this.prisma.message_log) {
            return [];
        }
        if (!(await hasTable(this.prisma, "message_log"))) {
            return [];
        }

        const logs = await this.prisma.message_log.findMany({
            where: {
                branchId,
                provider: "aligo_sms",
                status: "pending",
                variables: {
                    path: ["triggerType"],
                    equals: "scheduled",
                },
            },
            orderBy: { createdAt: "desc" },
            take: limit,
        });

        return logs.flatMap((log) => {
            const variables = this.toStringRecord(log.variables);
            const scheduledFor = this.parseManualScheduledAt(
                variables["scheduledDate"],
                variables["scheduledTime"],
            );
            if (!scheduledFor) {
                return [];
            }

            const recipientName = log.recipientName?.trim() || "수신자";
            const recipientPhone = log.recipientPhone?.trim() || log.receiver;

            return [{
                id: `log:${log.id}`,
                ruleId: `manual-sms:${log.id}`,
                ruleName: variables["title"]?.trim() || "수동 예약 발송",
                eventType: null,
                offsetType: null,
                offsetDays: 0,
                recipientType: MessageTriggerRecipientType.CLIENT,
                recipientPhone,
                templateKey: MessageTriggerTemplateKey.INFO,
                status: "pending",
                scheduledFor,
                sentAt: null,
                canceledAt: null,
                cancelReason: null,
                clientId: log.clientId,
                employeeScheduleId: null,
                payload: {
                    clientId: log.clientId,
                    clientName: recipientName,
                    memberId: `message-log:${log.id}`,
                    recipientName,
                    recipientPhone,
                    templateVariables: variables,
                    messageBody: log.messageBody,
                },
                createdAt: log.createdAt,
                updatedAt: log.updatedAt,
            }];
        });
    }

    private toStringRecord(value: Prisma.JsonValue): Record<string, string> {
        if (!value || Array.isArray(value) || typeof value !== "object") {
            return {};
        }

        return Object.fromEntries(
            Object.entries(value)
                .filter((entry): entry is [string, string] => typeof entry[1] === "string"),
        );
    }

    private parseManualScheduledAt(
        scheduledDate?: string,
        scheduledTime?: string,
    ): Date | null {
        if (!scheduledDate || !scheduledTime) return null;

        const date = scheduledDate.replace(/\D/g, "");
        const time = scheduledTime.replace(/\D/g, "");
        if (date.length !== 8 || time.length !== 4) return null;

        const parsed = new Date(
            `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}T${time.slice(0, 2)}:${time.slice(2, 4)}:00+09:00`,
        );
        return Number.isNaN(parsed.getTime()) ? null : parsed;
    }

    private async cancelPendingJobsForClient(
        ruleIds: string[],
        clientId: number,
        reason: string,
    ): Promise<void> {
        const jobs = await this.jobRepository.findPendingByRuleIdsAndClientId(ruleIds, clientId);
        for (const job of jobs) {
            job.cancel(reason);
            await this.jobRepository.update(job);
        }
    }

    private async cancelPendingJobsForEmployeeSchedule(
        ruleIds: string[],
        employeeScheduleId: number,
        reason: string,
    ): Promise<void> {
        const jobs = await this.jobRepository.findPendingByRuleIdsAndEmployeeScheduleId(
            ruleIds,
            employeeScheduleId,
        );
        for (const job of jobs) {
            job.cancel(reason);
            await this.jobRepository.update(job);
        }
    }

    private async dispatchClaimedJob(
        job: MessageTriggerJobEntity,
        sentIds: ReadonlySet<string>,
        approvedBranchIds: ReadonlySet<string>,
    ): Promise<void> {
        const claimed = await this.jobRepository.claimPending(job.id);
        if (!claimed) {
            return;
        }

        if (sentIds.has(job.id)) {
            job.markSent();
            await this.persistTriggerJobStatus(job, "persist sent trigger job reconciliation");
            return;
        }

        if (job.scheduledFor.getTime() <= Date.now() - PAST_OCCURRENCE_GRACE_MS) {
            job.cancel(EXPIRED_PENDING_JOB_CANCEL_REASON);
            await this.persistTriggerJobStatus(job, "persist expired trigger job");
            return;
        }

        if (!job.branchId || !approvedBranchIds.has(job.branchId)) {
            job.cancel(MESSAGE_SENDER_APPROVAL_REQUIRED_CANCEL_REASON);
            await this.persistTriggerJobStatus(job, "persist sender approval canceled trigger job");
            return;
        }

        if (await this.postponeCatchUpJobUntilPredecessorCompletes(job)) {
            return;
        }

        job.markProcessing();
        try {
            const sent = await this.deliveryService.sendJob(job);
            if (sent) {
                job.markSent();
            } else if (job.status === "processing") {
                job.markFailed("Provider disabled or delivery failed");
            }
        } catch (error) {
            if (error instanceof TriggerJobDeferredError) {
                job.defer(error.kind, error.message);
            } else {
                job.markFailed(error instanceof Error ? error.message : String(error));
            }
        }

        await this.persistTriggerJobStatus(job, "persist dispatched trigger job");
    }

    private shouldSkipPreStartCatchUp(
        rule: MessageTriggerRuleEntity,
        client: ClientTriggerSource,
    ): boolean {
        if (
            rule.eventType !== MessageTriggerEventType.SERVICE_START ||
            rule.offsetType !== MessageTriggerOffsetType.BEFORE_DAYS ||
            !client.startDate
        ) {
            return false;
        }

        return this.getKstCalendarDate(new Date(), 0) >=
            this.getKstCalendarDate(client.startDate, 0);
    }

    private async postponeCatchUpJobUntilPredecessorCompletes(
        job: MessageTriggerJobEntity,
    ): Promise<boolean> {
        const catchUp = job.payload.catchUp;
        if (!catchUp?.predecessorDedupeKey) {
            return false;
        }

        const predecessor = await this.prisma.message_trigger_job.findUnique({
            where: { dedupeKey: catchUp.predecessorDedupeKey },
            select: {
                status: true,
                scheduledFor: true,
                sentAt: true,
                canceledAt: true,
                nextAttemptAt: true,
                updatedAt: true,
            },
        });
        if (!predecessor) {
            job.cancel(MISSING_CATCH_UP_PREDECESSOR_CANCEL_REASON);
            await this.persistTriggerJobStatus(job, "persist catch-up job with missing predecessor");
            return true;
        }

        const intervalMs = catchUp.intervalMinutes * MS_PER_MINUTE;
        const now = Date.now();
        const predecessorReference = predecessor.status === "pending" || predecessor.status === "processing"
            ? predecessor.nextAttemptAt ?? predecessor.scheduledFor
            : predecessor.sentAt ?? predecessor.canceledAt ?? predecessor.updatedAt;
        const earliestNextSend = new Date(predecessorReference.getTime() + intervalMs);

        if (
            predecessor.status === "pending" ||
            predecessor.status === "processing" ||
            earliestNextSend.getTime() > now
        ) {
            const retryAt = new Date(Math.max(earliestNextSend.getTime(), now + intervalMs));
            job.status = "pending";
            job.scheduledFor = retryAt;
            job.nextAttemptAt = null;
            await this.persistTriggerJobStatus(job, "postpone catch-up job for predecessor");
            return true;
        }

        return false;
    }

    private async processStaleRuleRebuilds(): Promise<void> {
        const staleRules = await this.ruleRepository.findStaleRules(10);

        for (const rule of staleRules) {
            const readUpdatedAt = rule.updatedAt;
            try {
                if (!rule.isActive) {
                    await this.jobRepository.cancelPendingByRuleId(rule.id, "Rule deactivated");
                } else {
                    await this.jobRepository.cancelPendingByRuleId(rule.id, "규칙 재생성");
                    await this.rebuildJobsForRule(rule.branchId, rule, false);
                }

                await this.ruleRepository.clearJobsStaleIfUnchanged(rule.id, readUpdatedAt);
            } catch (error) {
                this.logger.error(
                    `[Message Automation] Failed to process stale trigger rule ${rule.id}`,
                    error instanceof Error ? error.stack : String(error),
                );
            }
        }
    }

    private async recoverApprovedBranches(): Promise<void> {
        const candidates = await this.ruleRepository.findInactiveDefaultRules(50);
        if (candidates.length === 0) return;

        const branchIds = [
            ...new Set(candidates.map((rule) => rule.branchId).filter((id): id is string => !!id)),
        ];
        const approvedBranches =
            await this.messageSenderApprovalService.getApprovedBranches(branchIds);

        for (const rule of candidates) {
            if (!rule.branchId) {
                continue;
            }

            const approvedAt = approvedBranches.get(rule.branchId);
            if (approvedAt === undefined) {
                continue;
            }

            // 규칙 관리는 승인 후에만 가능하므로, 승인 전 비활성화 기록만 cleanup patch가 만든 상태로 본다.
            if (approvedAt !== null && rule.updatedAt >= approvedAt) {
                continue;
            }

            try {
                rule.update({ isActive: true });
                await this.ruleRepository.update(rule.branchId, rule);
                await this.ruleRepository.markJobsStale(rule.id);
            } catch (error) {
                this.logger.error(
                    `[Message Automation] Failed to recover approved default trigger rule ${rule.id}`,
                    error instanceof Error ? error.stack : String(error),
                );
            }
        }
    }

    private async reclaimStaleProcessingJobs(): Promise<void> {
        const cutoff = new Date(Date.now() - TRIGGER_JOB_PROCESSING_RECLAIM_MS);
        const stale = await this.jobRepository.findStaleProcessing(cutoff);
        if (stale.length === 0) {
            return;
        }

        const sentIds = await this.messageLogRepository.findSentTriggerJobIds(
            stale.map((job) => job.id),
        );
        for (const job of stale) {
            if (sentIds.has(job.id)) {
                job.markSent();
            } else {
                job.defer("transient", "Reclaimed stale processing job");
            }
            await this.persistTriggerJobStatus(job, "persist reclaimed trigger job");
        }
    }

    private async persistTriggerJobStatus(
        job: MessageTriggerJobEntity,
        action: string,
    ): Promise<void> {
        try {
            await this.jobRepository.update(job);
        } catch (error) {
            this.logger.error(
                `[Message Automation] Failed to ${action} ${job.id}`,
                error instanceof Error ? error.stack : String(error),
            );
        }
    }

    private async hasTriggerSchema(): Promise<boolean> {
        const [hasRuleTable, hasJobTable] = await Promise.all([
            hasTable(this.prisma, "message_trigger_rule"),
            hasTable(this.prisma, "message_trigger_job"),
        ]);
        return hasRuleTable && hasJobTable;
    }

    private async ensureTriggerSchemaReady(): Promise<void> {
        if (!(await this.hasTriggerSchema())) {
            throw new ServiceUnavailableException(
                "Message trigger tables are not available. Apply the database migration first.",
            );
        }
    }
}
