import {
    BadRequestException,
    ConflictException,
    Inject,
    Injectable,
    Logger,
    NotFoundException,
    Optional,
    ServiceUnavailableException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { createHash } from "node:crypto";
import { PrismaService } from "infrastructure/database/prisma.service";
import {
    MESSAGE_TRIGGER_TEMPLATE_CATALOG,
    EVENT_OFFSET_OPTIONS,
    EVENT_RECIPIENT_OPTIONS,
    getMessageTriggerTemplateCatalog,
    isConfigurableSmsTriggerTemplate,
    isCompatibleMessageTriggerTemplate,
    MessageTriggerEventType,
    MessageTriggerOffsetType,
    MessageTriggerRecipientType,
    MessageTriggerTemplateKey,
} from "domain/constants/message-trigger-catalog";
import { findUnsupportedRequiredMessageTriggerVariables } from "domain/constants/message-trigger-variable-sources";
import { SystemTemplateKey } from "domain/constants/system-template-registry";
import { EMPLOYEE_ASSIGNMENT_AUTOMATION_CHANGED_CANCEL_REASON } from "domain/constants/message-automation-intent";
import {
    MESSAGE_SENDER_APPROVAL_REQUIRED_CANCEL_REASON,
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
import { SystemTemplateService } from "./system-template.service";
import { MessageTemplateAutomationLockService } from "./message-template-automation-lock.service";
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

export interface MessageTriggerIntentSyncOptions {
    stableBatchAt: Date;
    preserveExisting: boolean;
}

type MessageTriggerRuleValidationParams = Pick<
    UpsertRuleParams,
    "eventType" | "offsetType" | "offsetDays" | "recipientType" | "templateKey"
>;

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

const ORPHANED_TRIGGER_JOB_CANCEL_REASON = "Related client or schedule deleted";
const EXPIRED_PENDING_JOB_CANCEL_REASON = "기존 발송 예정 24시간 경과";
const MISSING_CATCH_UP_PREDECESSOR_CANCEL_REASON = "보충 발송 이전 순위 job 없음";
const USER_REQUESTED_CANCEL_REASON = "사용자가 발송을 취소함";
const CANCEL_JOB_CONFLICT_MESSAGE = "이미 발송되었거나 취소할 수 없는 상태입니다";
const MS_PER_MINUTE = 60 * 1000;
// The authorization fence only validates the current claim/source and commits
// a short CAS before any provider path opens another Prisma connection.
const CLAIM_DISPATCH_AUTHORIZATION_TIMEOUT_MS = 5_000;

function normalizeMessageTriggerOffsetDays(
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

export function validateMessageTriggerRule(
    params: MessageTriggerRuleValidationParams,
    allowedExistingTemplateKey?: MessageTriggerTemplateKey,
): void {
    const template = MESSAGE_TRIGGER_TEMPLATE_CATALOG[params.templateKey];
    if (!template) {
        throw new BadRequestException("Unknown template key");
    }

    if (!template.providers.sms) {
        throw new BadRequestException("SMS 발송 채널이 없는 템플릿입니다.");
    }

    if (
        !isConfigurableSmsTriggerTemplate(params.templateKey)
        && params.templateKey !== allowedExistingTemplateKey
    ) {
        throw new BadRequestException("일반 자동 전송 규칙에서 사용할 수 없는 템플릿입니다.");
    }

    if (!EVENT_RECIPIENT_OPTIONS[params.eventType].includes(params.recipientType)) {
        throw new BadRequestException("Invalid recipient for selected event type");
    }

    if (!EVENT_OFFSET_OPTIONS[params.eventType].includes(params.offsetType)) {
        throw new BadRequestException("Invalid offset type for selected event type");
    }

    const normalizedOffsetDays = normalizeMessageTriggerOffsetDays(params.offsetType, params.offsetDays);
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

interface EmployeeAssignmentScheduleSource {
    id: number;
    branchId: string | null;
    clientId: number;
    workAddress: string;
    startDate: Date;
    endDate: Date;
    replaced: boolean;
    primaryEmployeeId: number;
    secondaryEmployeeId: number | null;
    client: { id: number; name: string };
    primaryEmployee: { id: number; name: string; phone: string } | null;
    secondaryEmployee: { id: number; name: string; phone: string } | null;
}

type EmployeeAssignmentScheduleFingerprintSource = Pick<
    EmployeeAssignmentScheduleSource,
    | "id"
    | "branchId"
    | "clientId"
    | "workAddress"
    | "startDate"
    | "endDate"
    | "replaced"
    | "primaryEmployeeId"
    | "secondaryEmployeeId"
> & Partial<Pick<EmployeeAssignmentScheduleSource, "client" | "primaryEmployee" | "secondaryEmployee">>;

function employeeAssignmentEmployeeFingerprint(
    employee: EmployeeAssignmentScheduleSource["primaryEmployee"] | undefined,
): { id: number; name: string; phone: string } | null {
    if (!employee) return null;
    return { id: employee.id, name: employee.name, phone: employee.phone };
}

/**
 * A schedule has no version column. Persisting this opaque source fingerprint
 * in the assignment job lets the dispatcher reject a claimed job built from
 * any older schedule/assignment generation without copying address data into
 * the provider payload.
 */
function employeeAssignmentScheduleFingerprint(
    schedule: EmployeeAssignmentScheduleFingerprintSource,
    recipientType: MessageTriggerRecipientType,
): string {
    return createHash("sha256").update(JSON.stringify({
        version: "employee-assignment-source-v1",
        recipientType,
        id: schedule.id,
        branchId: schedule.branchId,
        clientId: schedule.clientId,
        client: schedule.client
            ? { id: schedule.client.id, name: schedule.client.name }
            : null,
        workAddress: schedule.workAddress,
        startDate: schedule.startDate.toISOString(),
        endDate: schedule.endDate.toISOString(),
        replaced: schedule.replaced,
        primaryEmployeeId: schedule.primaryEmployeeId,
        secondaryEmployeeId: schedule.secondaryEmployeeId,
        primaryEmployee: employeeAssignmentEmployeeFingerprint(schedule.primaryEmployee),
        secondaryEmployee: employeeAssignmentEmployeeFingerprint(schedule.secondaryEmployee),
    })).digest("hex");
}

type ClientRuleJobCandidate = {
    rule: MessageTriggerRuleEntity;
    job: MessageTriggerJobEntity;
};

type PreProviderSendFenceResult =
    | { kind: "allow" }
    | { kind: "stale"; reason: string }
    | { kind: "lost" };

const SMS_PROVIDER_ACCEPTANCE_UNCERTAIN_REASON =
    "문자 발송 결과가 불확실하여 자동 재전송을 중단했습니다. 제공자 이력 확인 후 수동 확인이 필요합니다.";

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
        private readonly systemTemplateService: SystemTemplateService,
        private readonly templateAutomationLock: MessageTemplateAutomationLockService,
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
            if (!isConfigurableSmsTriggerTemplate(item.key)) return false;
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
        const persistRule = async (writeTransaction: Prisma.TransactionClient) => {
            const rule = await this.ruleRepository.create(
                branchId,
                MessageTriggerRuleEntity.create({
                    branchId,
                    ...params,
                    offsetDays: this.normalizeOffsetDays(params.offsetType, params.offsetDays),
                }),
                writeTransaction,
            );
            await this.ruleRepository.markJobsStale(rule.id, writeTransaction);
            return rule;
        };
        const rule = await this.runRuleTemplateMutation(params, persistRule, transaction);
        // Agent capability creates may still be inside their caller-owned
        // transaction, so the global repositories cannot safely observe that
        // row until commit. HTTP/admin creates have no transaction and can
        // converge the generation before the success response is returned.
        if (transaction) return rule;
        return await this.reconcileRuleGenerationAfterMutation(branchId, rule.id) ?? rule;
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

        this.validateRule(nextState, rule.templateKey);
        const updated = await this.runRuleTemplateMutation(nextState, async (transaction) => {
            rule.update({
                ...nextState,
                offsetDays: this.normalizeOffsetDays(nextState.offsetType, nextState.offsetDays),
            });
            const persisted = await this.ruleRepository.update(branchId, rule, transaction);
            await this.ruleRepository.markJobsStale(persisted.id, transaction);
            return persisted;
        });
        await this.cancelPendingJobsForRule(branchId, updated, "Rule updated", false);
        return await this.reconcileRuleGenerationAfterMutation(branchId, updated.id) ?? updated;
    }

    /**
     * Mutate an automation rule against the exact inspected snapshot. The
     * repository performs the branch/resource-scoped conditional update; this
     * method intentionally does not re-read the rule before writing.
     */
    async updateRuleApprovedTarget(
        branchId: string,
        id: string,
        params: Partial<UpsertRuleParams>,
        expectedTargetVersion: string,
        targetSnapshot: Record<string, unknown> | undefined,
    ): Promise<MessageTriggerRuleEntity> {
        const mutationStartedAt = new Date();
        await this.ensureTriggerSchemaReady();
        await this.messageSenderApprovalService.ensureApproved(branchId);
        const expected = this.ruleFromApprovedSnapshot(targetSnapshot);
        if (
            !expected
            || expected.id !== id
            || expected.branchId !== branchId
            || this.ruleTargetVersion(expected) !== expectedTargetVersion
        ) {
            throw new BadRequestException("Automation rule approval snapshot is missing or stale");
        }

        const nextState: UpsertRuleParams = {
            name: params.name ?? expected.name,
            isActive: params.isActive ?? expected.isActive,
            eventType: params.eventType ?? expected.eventType,
            offsetType: params.offsetType ?? expected.offsetType,
            offsetDays: params.offsetDays ?? expected.offsetDays,
            recipientType: params.recipientType ?? expected.recipientType,
            templateKey: params.templateKey ?? expected.templateKey,
        };
        this.validateRule(nextState, expected.templateKey);
        const next = MessageTriggerRuleEntity.reconstitute(
            expected.id,
            expected.branchId,
            expected.name,
            expected.isActive,
            expected.eventType,
            expected.offsetType,
            expected.offsetDays,
            expected.recipientType,
            expected.templateKey,
            expected.createdAt,
            expected.updatedAt,
            expected.isDefault,
            expected.jobsStale,
        );
        next.update({
            ...nextState,
            offsetDays: this.normalizeOffsetDays(nextState.offsetType, nextState.offsetDays),
        });

        const updated = await this.runRuleTemplateMutation(
            nextState,
            (transaction) => this.ruleRepository.updateIfTargetMatchesAndFenceJobs(
                branchId,
                expected,
                next,
                "Rule updated",
                mutationStartedAt,
                transaction,
            ),
        );
        if (!updated) {
            throw new BadRequestException("Automation rule changed after approval");
        }
        return updated;
    }

    async deleteRule(branchId: string, id: string): Promise<void> {
        await this.ensureTriggerSchemaReady();
        const rule = await this.getRule(branchId, id);
        await this.cancelPendingJobsForRule(branchId, rule, "Rule deleted", false);
        await this.ruleRepository.delete(branchId, id);
    }

    /** Delete an automation rule only when its inspected snapshot still matches. */
    async deleteRuleApprovedTarget(
        branchId: string,
        id: string,
        expectedTargetVersion: string,
        targetSnapshot: Record<string, unknown> | undefined,
    ): Promise<void> {
        const mutationStartedAt = new Date();
        await this.ensureTriggerSchemaReady();
        await this.messageSenderApprovalService.ensureApproved(branchId);
        const expected = this.ruleFromApprovedSnapshot(targetSnapshot);
        if (
            !expected
            || expected.id !== id
            || expected.branchId !== branchId
            || this.ruleTargetVersion(expected) !== expectedTargetVersion
        ) {
            throw new BadRequestException("Automation rule approval snapshot is missing or stale");
        }
        const deleted = await this.ruleRepository.deleteIfTargetMatchesAndFenceJobs(
            branchId,
            expected,
            "Rule deleted",
            mutationStartedAt,
        );
        if (!deleted) {
            throw new BadRequestException("Automation rule changed after approval");
        }
    }

    /**
     * Reconciliation must prove the whole automation mutation converged. A
     * matching rule alone is insufficient while its stale-job rebuild is
     * pending or an older active job remains dispatchable.
     */
    async isRuleMutationComplete(
        branchId: string,
        id: string,
        params: Partial<UpsertRuleParams>,
    ): Promise<boolean> {
        const rule = await this.getRule(branchId, id);
        const matches = Object.entries(params).every(([key, value]) => {
            if (value === undefined) return true;
            return JSON.stringify(rule[key as keyof MessageTriggerRuleEntity]) === JSON.stringify(value);
        });
        if (!matches || rule.jobsStale) return false;
        return !(await this.jobRepository.hasActiveJobsBefore(branchId, rule.id, rule.updatedAt));
    }

    async dispatchDueJobs(): Promise<void> {
        if (!(await this.hasTriggerSchema())) {
            return;
        }

        await this.jobRepository.cancelOrphanedPending(ORPHANED_TRIGGER_JOB_CANCEL_REASON);
        await this.reclaimStaleProcessingJobs();
        await this.recoverApprovedBranches();
        // Rebuild before querying due rows so a rule saved immediately before
        // this tick can dispatch on this tick instead of waiting another minute.
        await this.processStaleRuleRebuilds();
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

    /**
     * Cancel a scheduled trigger job on the user's behalf. Pending and
     * processing jobs scoped to the caller's branch are canceled atomically;
     * a processing claim is invalidated before the provider fence. The
     * repository call is a single conditional update, so there is no separate
     * existence/branch pre-check to race against it. Every other outcome
     * (already sent, already canceled, or no such job) collapses to the same
     * conflict-style failure — the caller does not need to know which.
     */
    async cancelJobByUser(branchId: string, id: string): Promise<{ id: string; status: "canceled" }> {
        await this.ensureTriggerSchemaReady();
        const canceled = await this.jobRepository.cancelPendingByUser(
            id,
            branchId,
            USER_REQUESTED_CANCEL_REASON,
        );
        if (!canceled) {
            throw new ConflictException(CANCEL_JOB_CONFLICT_MESSAGE);
        }
        return { id, status: "canceled" };
    }

    async syncClientRulesForClient(
        branchId: string,
        clientId: number,
        includePast: boolean,
        suppressGreeting = false,
        intentOptions?: MessageTriggerIntentSyncOptions,
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
            if (!intentOptions?.preserveExisting) {
                await this.cancelPendingJobsForClient(
                    branchId,
                    rules,
                    clientId,
                    "Client data changed",
                );
            }
        } else {
            const immediateRules = rules.filter(
                (rule) => rule.offsetType === MessageTriggerOffsetType.IMMEDIATE,
            );
            const nonImmediateRules = rules.filter(
                (rule) => rule.offsetType !== MessageTriggerOffsetType.IMMEDIATE,
            );

            if (nonImmediateRules.length > 0) {
                await this.cancelPendingJobsForClient(
                    branchId,
                    nonImmediateRules,
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
            ? await this.applyRetroactiveSendConfig(
                branchId,
                candidateJobs,
                intentOptions?.stableBatchAt,
            )
            : candidateJobs;

        for (const { rule, job } of jobsToPersist) {
            await this.persistPendingJob(
                job,
                rule,
                includePast,
                false,
                intentOptions?.preserveExisting === true,
            );
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
        intentOptions?: Pick<MessageTriggerIntentSyncOptions, "preserveExisting">,
    ): Promise<boolean> {
        if (!(await this.hasTriggerSchema())) {
            return false;
        }
        if (!(await this.messageSenderApprovalService.isApproved(branchId))) {
            return false;
        }

        const schedule = await this.prisma.employee_schedule.findFirst({
            where: { id: employeeScheduleId, branchId },
            include: {
                client: true,
                primaryEmployee: true,
                secondaryEmployee: true,
            },
        });
        if (!schedule) return true;

        const rules = await this.ruleRepository.findActiveByEventTypes(branchId, [
            MessageTriggerEventType.EMPLOYEE_ASSIGNED,
        ]);

        // A replaced schedule is terminal for employee-assignment automation.
        // Even an intent replay that normally preserves an existing generation
        // must cancel any pending assignment before returning, and must not
        // create a replacement for the retired schedule.
        let retryable = false;
        if (!intentOptions?.preserveExisting || schedule.replaced) {
            const canceled = await this.cancelPendingJobsForEmployeeSchedule(
                branchId,
                rules,
                employeeScheduleId,
                EMPLOYEE_ASSIGNMENT_AUTOMATION_CHANGED_CANCEL_REASON,
            );
            if (!canceled && !schedule.replaced) retryable = true;
        }

        if (schedule.replaced) return true;

        for (const rule of rules) {
            const job = this.buildEmployeeAssignmentJob(rule, schedule);
            if (!job) continue;
            if (await this.hasSentEmployeeAssignmentJobForSameEmployee(job)) {
                continue;
            }
            const persisted = await this.persistPendingJob(
                job,
                rule,
                includePast,
                false,
                intentOptions?.preserveExisting === true,
            );
            if (!persisted) retryable = true;
        }
        return !retryable;
    }

    /**
     * Refresh assignment jobs whose source payload contains the client's name.
     * The schedule itself remains the same generation, so its deterministic
     * dedupe key lets the mutable pending row be rebuilt in place.
     */
    async syncEmployeeAssignmentRulesForClient(
        branchId: string,
        clientId: number,
    ): Promise<boolean> {
        if (!(await this.hasTriggerSchema())) {
            return false;
        }
        if (!(await this.messageSenderApprovalService.isApproved(branchId))) {
            return false;
        }

        const schedules = await this.prisma.employee_schedule.findMany({
            where: { branchId, clientId, replaced: false },
            select: { id: true },
            orderBy: { id: "asc" },
        });

        let retryable = false;
        for (const schedule of schedules) {
            const refreshed = await this.syncEmployeeAssignmentRulesForSchedule(
                branchId,
                schedule.id,
                true,
            );
            if (refreshed === false) retryable = true;
        }
        return !retryable;
    }

    /**
     * Refresh assignment jobs for every active schedule that references the
     * employee. Branch and replacement predicates keep the reconciliation
     * inside the caller's tenant and out of retired schedule generations.
     */
    async syncEmployeeAssignmentRulesForEmployee(
        branchId: string,
        employeeId: number,
    ): Promise<boolean> {
        if (!(await this.hasTriggerSchema())) {
            return false;
        }
        if (!(await this.messageSenderApprovalService.isApproved(branchId))) {
            return false;
        }

        const schedules = await this.prisma.employee_schedule.findMany({
            where: {
                branchId,
                replaced: false,
                OR: [
                    { primaryEmployeeId: employeeId },
                    { secondaryEmployeeId: employeeId },
                ],
            },
            select: { id: true },
            orderBy: { id: "asc" },
        });

        let retryable = false;
        for (const schedule of schedules) {
            const refreshed = await this.syncEmployeeAssignmentRulesForSchedule(
                branchId,
                schedule.id,
                true,
            );
            if (refreshed === false) retryable = true;
        }
        return !retryable;
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
            created = await this.runRuleTemplateMutation(
                defaults,
                (transaction) => this.ruleRepository.create(
                    branchId,
                    MessageTriggerRuleEntity.create({
                        branchId,
                        ...defaults,
                        isDefault: true,
                    }),
                    transaction,
                ),
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
            await this.persistPendingJob(job, rule, includePast, rule.jobsStale);
        }
    }

    private async persistPendingJob(
        job: MessageTriggerJobEntity | null,
        rule: MessageTriggerRuleEntity,
        includePast: boolean,
        expectedJobsStale: boolean,
        preserveExisting = false,
    ): Promise<boolean> {
        if (!job) return true;
        if (!includePast) {
            const now = Date.now();
            const scheduledForTime = job.scheduledFor.getTime();
            if (scheduledForTime < now - PAST_OCCURRENCE_GRACE_MS) {
                return true;
            }

            // IMMEDIATE jobs must fire only on the live create/assign path (includePast=true).
            if (
                rule.offsetType === MessageTriggerOffsetType.IMMEDIATE &&
                scheduledForTime <= now
            ) {
                return true;
            }
        }
        const persisted = await this.jobRepository.upsertPendingForRuleGeneration(
            job,
            rule.updatedAt,
            expectedJobsStale,
            preserveExisting,
        );
        return persisted !== null;
    }

    private async applyRetroactiveSendConfig(
        branchId: string,
        candidates: ClientRuleJobCandidate[],
        stableBatchAt?: Date,
    ): Promise<ClientRuleJobCandidate[]> {
        if (candidates.length === 0) return candidates;

        const config = await this.getRetroactiveSendConfig(branchId);
        const now = Date.now();
        const baseScheduledFor = stableBatchAt
            ? new Date(stableBatchAt)
            : new Date(now);
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

            // A client mutation can race a job that was already claimed for
            // delivery. Invalidate that active claim before refreshing the
            // pending payload; the CAS update is intentionally skipped when
            // another worker has already replaced the token.
            if (job.status === "processing") {
                job.cancel("Client data changed");
                await this.jobRepository.update(job);
                continue;
            }

            const refreshedJob = this.buildClientJob(rule, client);
            if (!refreshedJob) continue;

            job.recipientPhone = refreshedJob.recipientPhone;
            job.payload = {
                ...refreshedJob.payload,
                ...(job.payload.catchUp ? { catchUp: job.payload.catchUp } : {}),
            };
            await this.jobRepository.upsertPendingForRuleGeneration(
                job,
                rule.updatedAt,
                false,
            );
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
        schedule: EmployeeAssignmentScheduleSource,
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
                employeeScheduleFingerprint: employeeAssignmentScheduleFingerprint(schedule, rule.recipientType),
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
        return normalizeMessageTriggerOffsetDays(offsetType, offsetDays);
    }

    private ruleTargetVersion(rule: MessageTriggerRuleEntity): string {
        return createHash("sha256").update(JSON.stringify({
            id: rule.id,
            name: rule.name,
            isActive: rule.isActive,
            eventType: rule.eventType,
            offsetType: rule.offsetType,
            offsetDays: rule.offsetDays,
            recipientType: rule.recipientType,
            templateKey: rule.templateKey,
            isDefault: rule.isDefault,
            jobsStale: rule.jobsStale,
            updatedAt: rule.updatedAt.toISOString(),
        })).digest("hex");
    }

    private ruleFromApprovedSnapshot(snapshot: Record<string, unknown> | undefined): MessageTriggerRuleEntity | null {
        if (!snapshot) return null;
        const id = snapshot["id"];
        const branchId = snapshot["branchId"];
        const name = snapshot["name"];
        const isActive = snapshot["isActive"];
        const eventType = snapshot["eventType"];
        const offsetType = snapshot["offsetType"];
        const offsetDays = snapshot["offsetDays"];
        const recipientType = snapshot["recipientType"];
        const templateKey = snapshot["templateKey"];
        const isDefault = snapshot["isDefault"];
        const jobsStale = snapshot["jobsStale"];
        const createdAt = snapshot["createdAt"];
        const updatedAt = snapshot["updatedAt"];
        if (
            typeof id !== "string"
            || typeof branchId !== "string"
            || typeof name !== "string"
            || typeof isActive !== "boolean"
            || typeof eventType !== "string"
            || typeof offsetType !== "string"
            || typeof offsetDays !== "number"
            || typeof recipientType !== "string"
            || typeof templateKey !== "string"
            || typeof isDefault !== "boolean"
            || typeof jobsStale !== "boolean"
            || typeof createdAt !== "string"
            || typeof updatedAt !== "string"
        ) {
            return null;
        }
        const created = new Date(createdAt);
        const updated = new Date(updatedAt);
        if (Number.isNaN(created.getTime()) || Number.isNaN(updated.getTime())) return null;
        return MessageTriggerRuleEntity.reconstitute(
            id,
            branchId,
            name,
            isActive,
            eventType as MessageTriggerEventType,
            offsetType as MessageTriggerOffsetType,
            offsetDays,
            recipientType as MessageTriggerRecipientType,
            templateKey as MessageTriggerTemplateKey,
            created,
            updated,
            isDefault,
            jobsStale,
        );
    }

    private validateRule(
        params: UpsertRuleParams,
        allowedExistingTemplateKey?: MessageTriggerTemplateKey,
    ): void {
        validateMessageTriggerRule(params, allowedExistingTemplateKey);
    }

    private async ensureActiveRuleTemplateVariablesSupported(
        params: UpsertRuleParams,
    ): Promise<void> {
        if (params.isActive === false) return;

        const systemTemplateKey = MESSAGE_TRIGGER_TEMPLATE_CATALOG[params.templateKey]
            .providers.sms?.templateKey;
        if (!systemTemplateKey) return;

        const template = await this.systemTemplateService.getByKey(systemTemplateKey);
        const unsupportedVariables = findUnsupportedRequiredMessageTriggerVariables(
            params.templateKey,
            template.customVariables ?? [],
        );
        if (unsupportedVariables.length === 0) return;

        throw new BadRequestException({
            message: "자동 발송에서 입력할 수 없는 필수 템플릿 변수가 있습니다.",
            unsupportedVariables,
        });
    }

    private getRuleSystemTemplateKey(
        templateKey: MessageTriggerTemplateKey,
    ): SystemTemplateKey | null {
        const systemTemplateKey =
            MESSAGE_TRIGGER_TEMPLATE_CATALOG[templateKey].providers.sms?.templateKey;
        return systemTemplateKey ? systemTemplateKey as SystemTemplateKey : null;
    }

    private async runRuleTemplateMutation<T>(
        params: UpsertRuleParams,
        work: (transaction: Prisma.TransactionClient) => Promise<T>,
        transaction?: Prisma.TransactionClient,
    ): Promise<T> {
        if (params.isActive === false) {
            return transaction
                ? work(transaction)
                : this.prisma.$transaction(work);
        }

        const systemTemplateKey = this.getRuleSystemTemplateKey(params.templateKey);
        if (!systemTemplateKey) {
            throw new BadRequestException("SMS 발송 채널이 없는 템플릿입니다.");
        }
        return this.templateAutomationLock.runExclusive(
            systemTemplateKey,
            async (writeTransaction) => {
                await this.ensureActiveRuleTemplateVariablesSupported(params);
                return work(writeTransaction);
            },
            transaction,
        );
    }

    private async cancelPendingJobsForRule(
        branchId: string,
        rule: MessageTriggerRuleEntity,
        reason: string,
        expectedJobsStale: boolean,
    ): Promise<boolean> {
        const canceled = await this.jobRepository.cancelPendingForRuleGeneration(
            branchId,
            rule.id,
            rule.updatedAt,
            expectedJobsStale,
            reason,
        );
        return canceled !== null;
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
        branchId: string,
        rules: MessageTriggerRuleEntity[],
        clientId: number,
        reason: string,
    ): Promise<void> {
        for (const rule of rules) {
            await this.jobRepository.cancelPendingForRuleGeneration(
                branchId,
                rule.id,
                rule.updatedAt,
                false,
                reason,
                { clientId },
            );
        }
    }

    private async cancelPendingJobsForEmployeeSchedule(
        branchId: string,
        rules: MessageTriggerRuleEntity[],
        employeeScheduleId: number,
        reason: string,
    ): Promise<boolean> {
        let succeeded = true;
        for (const rule of rules) {
            const canceled = await this.jobRepository.cancelPendingForRuleGeneration(
                branchId,
                rule.id,
                rule.updatedAt,
                false,
                reason,
                { employeeScheduleId },
            );
            if (canceled === null) succeeded = false;
        }
        return succeeded;
    }

    private async dispatchClaimedJob(
        job: MessageTriggerJobEntity,
        sentIds: ReadonlySet<string>,
        approvedBranchIds: ReadonlySet<string>,
    ): Promise<void> {
        const claimed = await this.jobRepository.claimPendingWithRuleFence(job.id, job.branchId);
        if (!claimed) {
            return;
        }

        // The SQL claim returns the immutable attempt token. A claim without
        // one is not safe to deliver: the pre-provider fence fails closed.
        const claimToken = claimed;
        job.claimToken = claimToken;

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

        job.markProcessing(claimToken);
        const authorization = await this.authorizeClaimedJobForDispatch(job);
        if (authorization.kind === "lost") {
            return;
        }
        if (authorization.kind === "stale") {
            // The authorization transaction already invalidated this claim
            // when the source snapshot was stale. Keep the in-memory entity
            // aligned so the token-CAS write below is a harmless no-op if a
            // concurrent cancellation won the race first.
            job.cancel(authorization.reason);
            await this.persistTriggerJobStatus(job, "persist stale trigger job");
            return;
        }

        // The transaction has committed the irreversible dispatching state.
        // Provider delivery and its message_log writes must happen outside the
        // claim transaction so the FK insert cannot wait on a held row lock.
        job.markDispatchAuthorized();
        await this.deliverClaimedJob(job);
        await this.persistTriggerJobStatus(job, "persist dispatched trigger job");
    }

    /**
     * Revalidate cancellation/source state and atomically authorize one
     * claimed attempt for provider delivery. This transaction deliberately
     * ends before `deliverClaimedJob`: the delivery service persists its own
     * message_log attempt through another Prisma connection.
     */
    private async authorizeClaimedJobForDispatch(
        job: MessageTriggerJobEntity,
    ): Promise<PreProviderSendFenceResult> {
        return this.prisma.$transaction(async (transaction) => {
            // Employee schedule writers lock the source row before committing
            // their replacement. Preserve that order here, then lock the job
            // row for the token/CAS check; no provider work occurs while either
            // lock is held.
            const sourceFence = job.templateKey === MessageTriggerTemplateKey.EMPLOYEE_ASSIGNED
                && job.employeeScheduleId !== null
                ? await this.fenceEmployeeAssignmentBeforeProviderSend(job, transaction)
                : { kind: "allow" as const };
            if (sourceFence.kind === "lost") {
                return sourceFence;
            }

            const tokenFence = await this.fenceClaimTokenBeforeProviderSend(job, transaction);
            if (tokenFence.kind === "lost") {
                return tokenFence;
            }
            if (sourceFence.kind === "stale") {
                const canceled = await transaction.$queryRaw<Array<{ id: string }>>(Prisma.sql`
                    UPDATE "message_trigger_job"
                    SET status = 'canceled',
                        canceled_at = date_trunc('milliseconds', clock_timestamp()),
                        cancel_reason = ${sourceFence.reason},
                        claim_token = NULL,
                        updated_at = date_trunc('milliseconds', clock_timestamp())
                    WHERE id = ${job.id}
                      AND status = 'processing'
                      AND claim_token = ${job.claimToken}
                    RETURNING id
                `);
                return canceled.length === 1 ? sourceFence : { kind: "lost" as const };
            }

            const authorized = await transaction.$queryRaw<Array<{ id: string }>>(Prisma.sql`
                UPDATE "message_trigger_job"
                SET status = 'dispatching',
                    updated_at = date_trunc('milliseconds', clock_timestamp())
                WHERE id = ${job.id}
                  AND status = 'processing'
                  AND claim_token = ${job.claimToken}
                RETURNING id
            `);
            return authorized.length === 1 ? { kind: "allow" as const } : { kind: "lost" as const };
        }, {
            maxWait: CLAIM_DISPATCH_AUTHORIZATION_TIMEOUT_MS,
            timeout: CLAIM_DISPATCH_AUTHORIZATION_TIMEOUT_MS,
        });
    }

    private async deliverClaimedJob(job: MessageTriggerJobEntity): Promise<void> {
        try {
            const sent = await this.deliveryService.sendJob(job);
            if (sent) {
                job.markSent();
            } else if (job.status === "processing" || job.status === "dispatching") {
                job.markFailed("Provider disabled or delivery failed");
            }
        } catch (error) {
            if (error instanceof TriggerJobDeferredError) {
                job.defer(error.kind, error.message);
            } else {
                job.markFailed(error instanceof Error ? error.message : String(error));
            }
        }
    }

    /**
     * Re-read the claimed job and its schedule immediately before provider
     * invocation. BJJ-35 fences pending rows in the schedule update
     * transaction, but a row already claimed as `processing` needs this final
     * source check as well. When called from the authorization transaction,
     * the schedule row is locked only until that transaction commits; provider
     * delivery never runs while this lock is held. A lost claim is left
     * untouched so a concurrent user cancel or retry transition is never
     * overwritten.
     */
    private async fenceEmployeeAssignmentBeforeProviderSend(
        job: MessageTriggerJobEntity,
        transaction: Prisma.TransactionClient,
    ): Promise<PreProviderSendFenceResult> {
        const employeeScheduleId = job.employeeScheduleId;
        if (employeeScheduleId === null) return { kind: "lost" };
        const currentJob = await transaction.message_trigger_job.findUnique({
            where: { id: job.id },
            select: {
                status: true,
                branchId: true,
                ruleId: true,
                clientId: true,
                employeeScheduleId: true,
                recipientType: true,
                templateKey: true,
                claimToken: true,
            },
        });
        if (
            !currentJob
            || currentJob.status !== "processing"
            || currentJob.branchId !== job.branchId
            || currentJob.ruleId !== job.ruleId
            || currentJob.clientId !== job.clientId
            || currentJob.employeeScheduleId !== employeeScheduleId
            || currentJob.recipientType !== job.recipientType
            || currentJob.templateKey !== job.templateKey
            || currentJob.claimToken !== job.claimToken
        ) {
            return { kind: "lost" };
        }

        const lockedSchedule = await transaction.$queryRaw<Array<{ id: number }>>(Prisma.sql`
            SELECT id
            FROM "employee_schedule"
            WHERE id = ${employeeScheduleId}
              AND "branch_id" = ${job.branchId}::uuid
            FOR UPDATE
        `);
        if (lockedSchedule.length === 0) {
            return {
                kind: "stale",
                reason: EMPLOYEE_ASSIGNMENT_AUTOMATION_CHANGED_CANCEL_REASON,
            };
        }

        const schedule = await transaction.employee_schedule.findFirst({
            where: {
                id: employeeScheduleId,
                branchId: job.branchId,
            },
            select: {
                id: true,
                branchId: true,
                clientId: true,
                workAddress: true,
                startDate: true,
                endDate: true,
                replaced: true,
                primaryEmployeeId: true,
                secondaryEmployeeId: true,
                client: { select: { id: true, name: true } },
                primaryEmployee: { select: { id: true, name: true, phone: true } },
                secondaryEmployee: { select: { id: true, name: true, phone: true } },
            },
        });

        if (!schedule || schedule.branchId !== job.branchId || schedule.clientId !== job.clientId) {
            return {
                kind: "stale",
                reason: EMPLOYEE_ASSIGNMENT_AUTOMATION_CHANGED_CANCEL_REASON,
            };
        }

        // Replacement is a terminal source state. This explicit check is
        // required for legacy jobs because they predate the source
        // fingerprint and cannot otherwise prove replacement equality.
        if (schedule.replaced) {
            return {
                kind: "stale",
                reason: EMPLOYEE_ASSIGNMENT_AUTOMATION_CHANGED_CANCEL_REASON,
            };
        }

        const fingerprint = job.payload.employeeScheduleFingerprint;
        if (fingerprint) {
            return employeeAssignmentScheduleFingerprint(schedule, job.recipientType) === fingerprint
                ? { kind: "allow" }
                : {
                    kind: "stale",
                    reason: EMPLOYEE_ASSIGNMENT_AUTOMATION_CHANGED_CANCEL_REASON,
                };
        }

        const expectedEmployeeId = job.payload.employeeId;
        const currentEmployeeId = job.recipientType === MessageTriggerRecipientType.PRIMARY_EMPLOYEE
            ? schedule.primaryEmployeeId
            : schedule.secondaryEmployeeId;
        if (typeof expectedEmployeeId !== "number" || expectedEmployeeId !== currentEmployeeId) {
            return {
                kind: "stale",
                reason: EMPLOYEE_ASSIGNMENT_AUTOMATION_CHANGED_CANCEL_REASON,
            };
        }

        const currentEmployee = job.recipientType === MessageTriggerRecipientType.PRIMARY_EMPLOYEE
            ? schedule.primaryEmployee
            : schedule.secondaryEmployee;
        const expectedEmployeeName = job.payload.employeeName ?? job.payload.recipientName;
        if (expectedEmployeeName && expectedEmployeeName !== currentEmployee?.name) {
            return {
                kind: "stale",
                reason: EMPLOYEE_ASSIGNMENT_AUTOMATION_CHANGED_CANCEL_REASON,
            };
        }

        const currentEmployeePhone = normalizePhone(currentEmployee?.phone);
        const expectedRecipientPhones = [job.recipientPhone, job.payload.recipientPhone]
            .filter((phone): phone is string => Boolean(phone));
        if (expectedRecipientPhones.some((phone) => normalizePhone(phone) !== currentEmployeePhone)) {
            return {
                kind: "stale",
                reason: EMPLOYEE_ASSIGNMENT_AUTOMATION_CHANGED_CANCEL_REASON,
            };
        }

        const expectedClientNames = [
            job.payload.clientName,
            job.payload.templateVariables["clientName"],
        ].filter((name): name is string => Boolean(name));
        if (expectedClientNames.some((name) => name !== schedule.client.name)) {
            return {
                kind: "stale",
                reason: EMPLOYEE_ASSIGNMENT_AUTOMATION_CHANGED_CANCEL_REASON,
            };
        }

        const expectedTemplateEmployeeName = job.payload.templateVariables["employeeName"];
        if (expectedTemplateEmployeeName && expectedTemplateEmployeeName !== currentEmployee?.name) {
            return {
                kind: "stale",
                reason: EMPLOYEE_ASSIGNMENT_AUTOMATION_CHANGED_CANCEL_REASON,
            };
        }

        const expectedStartDate = job.payload.templateVariables["serviceStartDate"];
        if (expectedStartDate && this.formatDate(schedule.startDate) !== expectedStartDate) {
            return {
                kind: "stale",
                reason: EMPLOYEE_ASSIGNMENT_AUTOMATION_CHANGED_CANCEL_REASON,
            };
        }

        // Some pre-fingerprint jobs may already carry additional source
        // snapshots. Compare them when present; old payloads without these
        // keys remain compatible but are protected by the checks above.
        const expectedEndDate = job.payload.templateVariables["serviceEndDate"];
        if (expectedEndDate && this.formatDate(schedule.endDate) !== expectedEndDate) {
            return {
                kind: "stale",
                reason: EMPLOYEE_ASSIGNMENT_AUTOMATION_CHANGED_CANCEL_REASON,
            };
        }

        const expectedWorkAddress = job.payload.templateVariables["workAddress"];
        if (expectedWorkAddress && schedule.workAddress !== expectedWorkAddress) {
            return {
                kind: "stale",
                reason: EMPLOYEE_ASSIGNMENT_AUTOMATION_CHANGED_CANCEL_REASON,
            };
        }

        return { kind: "allow" };
    }

    /**
     * Lock and re-read the active claim as the final half of the dispatch
     * authorization transaction. A mutation that wins before this check
     * clears/replaces the token and fails closed; once the caller commits the
     * `dispatching` CAS, later mutations cannot revoke an already-authorized
     * provider crossing and terminal completion remains token fenced.
     */
    private async fenceClaimTokenBeforeProviderSend(
        job: MessageTriggerJobEntity,
        transaction: Prisma.TransactionClient,
    ): Promise<PreProviderSendFenceResult> {
        if (!job.claimToken) return { kind: "lost" };

        const rows = await transaction.$queryRaw<Array<{
            status: string;
            claim_token: string | null;
            branch_id?: string | null;
            rule_id?: string;
            client_id?: number | null;
            employee_schedule_id?: number | null;
            recipient_type?: string;
            template_key?: string;
        }>>(Prisma.sql`
            SELECT status,
                   claim_token,
                   branch_id,
                   rule_id,
                   client_id,
                   employee_schedule_id,
                   recipient_type,
                   template_key
            FROM "message_trigger_job"
            WHERE id = ${job.id}
            FOR UPDATE
        `);
        const current = rows[0];
        if (
            !current
            || current.status !== "processing"
            || current.claim_token !== job.claimToken
            || (current.branch_id !== undefined && current.branch_id !== job.branchId)
            || (current.rule_id !== undefined && current.rule_id !== job.ruleId)
            || (current.client_id !== undefined && current.client_id !== job.clientId)
            || (current.employee_schedule_id !== undefined && current.employee_schedule_id !== job.employeeScheduleId)
            || (current.recipient_type !== undefined && current.recipient_type !== job.recipientType)
            || (current.template_key !== undefined && current.template_key !== job.templateKey)
        ) {
            return { kind: "lost" };
        }

        return { kind: "allow" };
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
        const predecessorReference = predecessor.status === "pending"
            || predecessor.status === "processing"
            || predecessor.status === "dispatching"
            ? predecessor.nextAttemptAt ?? predecessor.scheduledFor
            : predecessor.sentAt ?? predecessor.canceledAt ?? predecessor.updatedAt;
        const earliestNextSend = new Date(predecessorReference.getTime() + intervalMs);

        if (
            predecessor.status === "pending" ||
            predecessor.status === "processing" ||
            predecessor.status === "dispatching" ||
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

    private async processStaleRule(rule: MessageTriggerRuleEntity): Promise<void> {
        if (!rule.branchId) return;

        const readUpdatedAt = rule.updatedAt;
        const canceled = await this.jobRepository.cancelPendingForRuleGeneration(
            rule.branchId,
            rule.id,
            readUpdatedAt,
            true,
            rule.isActive ? "규칙 재생성" : "Rule deactivated",
        );
        // Another worker may have already rebuilt and cleared this generation.
        // Never rebuild or clear a newer generation.
        if (canceled === null) return;

        if (rule.isActive) {
            await this.rebuildJobsForRule(rule.branchId, rule, false);
        }

        await this.ruleRepository.clearJobsStaleIfUnchanged(rule.id, readUpdatedAt);
    }

    private async reconcileRuleGenerationAfterMutation(
        branchId: string,
        ruleId: string,
    ): Promise<MessageTriggerRuleEntity | null> {
        try {
            const staleRule = await this.ruleRepository.findById(branchId, ruleId);
            if (!staleRule || !staleRule.jobsStale) return staleRule;

            await this.processStaleRule(staleRule);
            return await this.ruleRepository.findById(branchId, ruleId);
        } catch (error) {
            // Rule persistence and its durable stale marker already succeeded.
            // Treat every post-write reconciliation read/write as best effort so
            // a transient repository failure cannot invite a duplicate retry.
            // The scheduler will recover the still-stale generation.
            this.logger.error(
                `[Message Automation] Failed to reconcile trigger rule ${ruleId} after mutation`,
                error instanceof Error ? error.stack : String(error),
            );
            return null;
        }
    }

    private async processStaleRuleRebuilds(): Promise<void> {
        const staleRules = await this.ruleRepository.findStaleRules(10);

        for (const rule of staleRules) {
            try {
                await this.processStaleRule(rule);
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
                const nextState: UpsertRuleParams = {
                    name: rule.name,
                    isActive: true,
                    eventType: rule.eventType,
                    offsetType: rule.offsetType,
                    offsetDays: rule.offsetDays,
                    recipientType: rule.recipientType,
                    templateKey: rule.templateKey,
                };
                await this.runRuleTemplateMutation(nextState, async (transaction) => {
                    rule.update({ isActive: true });
                    await this.ruleRepository.update(rule.branchId!, rule, transaction);
                    await this.ruleRepository.markJobsStale(rule.id, transaction);
                });
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
        const logRepository = this.messageLogRepository as IMessageLogRepository & {
            findUncertainTriggerJobIds?: (jobIds: string[]) => Promise<Set<string>>;
        };
        const uncertainIds = typeof logRepository.findUncertainTriggerJobIds === "function"
            ? await logRepository.findUncertainTriggerJobIds(stale.map((job) => job.id))
            : new Set<string>();
        for (const job of stale) {
            if (sentIds.has(job.id)) {
                job.markSent();
            } else if (uncertainIds.has(job.id)) {
                job.markFailed(SMS_PROVIDER_ACCEPTANCE_UNCERTAIN_REASON);
            } else if (job.status === "dispatching") {
                // Dispatch authorization is the irreversible crossing into
                // the provider path. A worker crash after that CAS cannot
                // prove that no provider request was accepted, so never
                // re-queue the row for another send.
                job.markFailed(SMS_PROVIDER_ACCEPTANCE_UNCERTAIN_REASON);
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
