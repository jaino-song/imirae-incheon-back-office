import { Inject, Injectable, Logger } from "@nestjs/common";
import { createHash } from "node:crypto";
import { AligoService } from "application/services/aligo.service";
import { SystemTemplateService } from "application/services/system-template.service";
import {
    resolveAligoSmsMessageType,
    SendAligoSmsResult,
    type AligoSmsMessageType,
} from "application/dto/aligo/send-sms.dto";
import { SYSTEM_TEMPLATE_REGISTRY, SystemTemplateKey } from "domain/constants/system-template-registry";
import { MessageTriggerTemplateKey } from "domain/constants/message-trigger-catalog";
import {
    SERVICE_RECORD_LINK_SMS_AUTOMATION_KEY,
    SERVICE_RECORD_LINK_SMS_LOG_TEMPLATE_KEY,
    SERVICE_RECORD_LINK_SMS_TITLE,
    SERVICE_RECORD_LINK_SMS_TRIGGER_TYPE,
} from "domain/constants/service-record-link-message";
import { MessageTriggerJobEntity } from "domain/entities/message-trigger-job.entity";
import { TriggerJobDeferredError } from "domain/errors/trigger-job-deferred.error";
import {
    MessageLogEntity,
    MessageLogStatus,
    SMS_DELIVERY_RETRY_DELAY_MS,
} from "domain/entities/message-log.entity";
import {
    MESSAGE_LOG_REPOSITORY,
    IMessageLogRepository,
} from "domain/repositories/message-log.repository.interface";
import { isTransientPrismaConnectivityError } from "infrastructure/database/prisma-error.utils";

export interface SmsTemplateDeliveryConfig {
    smsLogTemplateKey: string;
    automationKey: string;
    triggerType: string;
    title: string;
    systemTemplateKey?: SystemTemplateKey;
    usePayloadMessage?: boolean;
}

/**
 * Bump this whenever the catalog-to-provider mapping changes. The value is
 * included in the approval fingerprint so an approved retry cannot silently
 * adopt a different title, template key, or provider routing rule.
 */
export const SMS_DELIVERY_CONFIG_VERSION = "sms-template-delivery-v1";
export const SMS_DELIVERY_SNAPSHOT_VARIABLE = "__smsDeliverySnapshot";

export interface SmsTriggerDeliverySnapshot {
    readonly templateKey: MessageTriggerTemplateKey;
    /** The exact receiver value passed to AligoService (before provider normalization). */
    readonly receiver: string;
    readonly maskedReceiver: string;
    readonly recipientName: string;
    readonly message: string;
    readonly title: string;
    readonly requestedDeliveryType: "AUTO";
    readonly deliveryType: AligoSmsMessageType;
    readonly estimatedCost: string;
    readonly templateVersion: string;
    readonly templateHash: string;
    readonly configVersion: string;
    readonly configHash: string;
    readonly snapshotHash: string;
    readonly systemTemplateKey?: SystemTemplateKey;
}

/**
 * `title` here is NOT the in-app template label. It is sent to Aligo and shown
 * to the recipient as the LMS subject line, so it is outgoing message content.
 *
 * Ten of these match the in-app label; THANKS ("예약 완료" vs "예약 완료(입금 확인)")
 * and INFO ("정보 안내" vs "정보 요청") deliberately do not. They were reviewed and
 * left alone on 2026-08-12: "정보 요청" in a recipient's inbox reads as a request
 * *for* their information, which is not what the message does. Do not "fix" these
 * to match the label map — the divergence is the decision.
 *
 * Editing any title also invalidates every persisted approval snapshot (the value
 * feeds configHash and snapshotHash), so a change needs SMS_DELIVERY_CONFIG_VERSION
 * bumped and every pending approval re-approved.
 */
export const SMS_TEMPLATE_DELIVERY: Partial<Record<MessageTriggerTemplateKey, SmsTemplateDeliveryConfig>> = {
    [MessageTriggerTemplateKey.CLIENT_WELCOME]: {
        smsLogTemplateKey: "client_welcome_sms",
        automationKey: "CLIENT_WELCOME_SMS",
        triggerType: "client_created",
        title: "고객 등록 안내",
        systemTemplateKey: SystemTemplateKey.CLIENT_WELCOME,
    },
    [MessageTriggerTemplateKey.SERVICE_START_REMINDER]: {
        smsLogTemplateKey: "service_start_reminder_sms",
        automationKey: "SERVICE_START_REMINDER_SMS",
        triggerType: "service_start_reminder",
        title: "서비스 시작 알림",
        systemTemplateKey: SystemTemplateKey.SERVICE_START_REMINDER,
    },
    [MessageTriggerTemplateKey.SERVICE_INFO]: {
        smsLogTemplateKey: "service_info_sms",
        automationKey: "SERVICE_INFO_SMS",
        triggerType: "service_start_before_7_days",
        title: "서비스 안내",
        systemTemplateKey: SystemTemplateKey.SERVICE_INFO,
    },
    [MessageTriggerTemplateKey.SERVICE_END_REMINDER]: {
        smsLogTemplateKey: "service_end_reminder_sms",
        automationKey: "SERVICE_END_REMINDER_SMS",
        triggerType: "service_end_reminder",
        title: "서비스 종료 알림",
        systemTemplateKey: SystemTemplateKey.SERVICE_END_REMINDER,
    },
    [MessageTriggerTemplateKey.EMPLOYEE_ASSIGNED]: {
        smsLogTemplateKey: "employee_assigned_sms",
        automationKey: "EMPLOYEE_ASSIGNED_SMS",
        triggerType: "employee_assigned",
        title: "직원 배정 알림",
        systemTemplateKey: SystemTemplateKey.EMPLOYEE_ASSIGNED,
    },
    [MessageTriggerTemplateKey.CLIENT_GREETING]: {
        smsLogTemplateKey: "client_greeting_sms",
        automationKey: "CLIENT_GREETING_SMS",
        triggerType: "client_created",
        title: "인사 메시지",
        systemTemplateKey: SystemTemplateKey.GREETING,
    },
    [MessageTriggerTemplateKey.PRICE_INFO]: {
        smsLogTemplateKey: "price_info_sms",
        automationKey: "PRICE_INFO_SMS",
        triggerType: "price_info",
        title: "비용 안내",
        systemTemplateKey: SystemTemplateKey.PRICE_INFO,
    },
    [MessageTriggerTemplateKey.REMINDER]: {
        smsLogTemplateKey: "reminder_sms",
        automationKey: "REMINDER_SMS",
        triggerType: "reminder",
        title: "리마인드",
        systemTemplateKey: SystemTemplateKey.REMINDER,
    },
    [MessageTriggerTemplateKey.THANKS]: {
        smsLogTemplateKey: "thanks_sms",
        automationKey: "THANKS_SMS",
        triggerType: "thanks",
        title: "예약 완료",
        systemTemplateKey: SystemTemplateKey.THANKS,
    },
    [MessageTriggerTemplateKey.SURVEY]: {
        smsLogTemplateKey: "survey_sms",
        automationKey: "SURVEY_SMS",
        triggerType: "survey",
        title: "모니터링 설문",
        systemTemplateKey: SystemTemplateKey.SURVEY,
    },
    [MessageTriggerTemplateKey.INFO]: {
        smsLogTemplateKey: "info_sms",
        automationKey: "INFO_SMS",
        triggerType: "info",
        title: "정보 안내",
        systemTemplateKey: SystemTemplateKey.INFO,
    },
    [MessageTriggerTemplateKey.SERVICE_RECORD_LINK]: {
        smsLogTemplateKey: SERVICE_RECORD_LINK_SMS_LOG_TEMPLATE_KEY,
        automationKey: SERVICE_RECORD_LINK_SMS_AUTOMATION_KEY,
        triggerType: SERVICE_RECORD_LINK_SMS_TRIGGER_TYPE,
        title: SERVICE_RECORD_LINK_SMS_TITLE,
        systemTemplateKey: SystemTemplateKey.SERVICE_RECORD_LINK,
    },
};

@Injectable()
export class SmsTriggerDeliveryService {
    private readonly logger = new Logger(SmsTriggerDeliveryService.name);

    constructor(
        private readonly aligoService: AligoService,
        private readonly systemTemplateService: SystemTemplateService,
        @Inject(MESSAGE_LOG_REPOSITORY)
        private readonly logRepository: IMessageLogRepository,
    ) {}

    canHandle(templateKey: MessageTriggerTemplateKey): boolean {
        return Boolean(SMS_TEMPLATE_DELIVERY[templateKey]);
    }

    /**
     * Resolve the exact provider-bound values without mutating the job or
     * calling Aligo. Agent approval, revalidation, and retry execution all use
     * this resolver so they share one immutable snapshot contract.
     */
    async resolveDeliverySnapshot(job: MessageTriggerJobEntity): Promise<Readonly<SmsTriggerDeliverySnapshot>> {
        if (!job.branchId) {
            throw new Error(`SMS trigger job ${job.id} is missing branchId`);
        }

        const config = SMS_TEMPLATE_DELIVERY[job.templateKey];
        if (!config) {
            throw new Error(`SMS trigger template ${job.templateKey} is not supported`);
        }
        const missingPriceInfoKeys = this.missingPriceInfoKeys(job, config);
        if (missingPriceInfoKeys.length > 0) {
            throw new Error(`PRICE_INFO delivery snapshot is missing required values: ${missingPriceInfoKeys.join(", ")}`);
        }

        const canonical = await this.resolveCanonicalSnapshot(job, config);
        const staged = this.readStagedSnapshot(job, canonical);
        if (staged) {
            if (staged.snapshotHash !== canonical.snapshotHash) {
                throw new Error("SMS delivery template or provider configuration changed after staging");
            }
            return staged;
        }

        return canonical;
    }

    /** Resolve the current provider-bound target without trusting staged data. */
    async resolveCanonicalDeliverySnapshot(job: MessageTriggerJobEntity): Promise<Readonly<SmsTriggerDeliverySnapshot>> {
        if (!job.branchId) {
            throw new Error(`SMS trigger job ${job.id} is missing branchId`);
        }
        const config = SMS_TEMPLATE_DELIVERY[job.templateKey];
        if (!config) {
            throw new Error(`SMS trigger template ${job.templateKey} is not supported`);
        }
        const missingPriceInfoKeys = this.missingPriceInfoKeys(job, config);
        if (missingPriceInfoKeys.length > 0) {
            throw new Error(`PRICE_INFO delivery snapshot is missing required values: ${missingPriceInfoKeys.join(", ")}`);
        }
        return this.resolveCanonicalSnapshot(job, config);
    }

    /**
     * Validate the exact target that was shown to the approver and rebuild it
     * with the current receiver identity. The durable target never contains a
     * raw phone number.
     */
    approvedSnapshotForExecution(
        job: MessageTriggerJobEntity,
        targetSnapshot: Record<string, unknown>,
        canonical: SmsTriggerDeliverySnapshot,
    ): Readonly<SmsTriggerDeliverySnapshot> {
        const readString = (key: string): string => {
            const value = targetSnapshot[key];
            if (typeof value !== "string") throw new Error(`approved SMS snapshot field ${key} is invalid`);
            return value;
        };
        if (readString("templateKey") !== job.templateKey) throw new Error("approved SMS template key changed");
        if (readString("receiver") !== canonical.maskedReceiver) throw new Error("approved SMS recipient changed");
        if (targetSnapshot["requestedDeliveryType"] !== "AUTO") throw new Error("approved SMS requested delivery type changed");
        const deliveryType = readString("deliveryType") as AligoSmsMessageType;
        if (deliveryType !== "SMS" && deliveryType !== "LMS") throw new Error("approved SMS delivery type is invalid");

        const candidateWithoutHash: Omit<SmsTriggerDeliverySnapshot, "snapshotHash"> = {
            templateKey: job.templateKey,
            receiver: canonical.receiver,
            maskedReceiver: canonical.maskedReceiver,
            recipientName: canonical.recipientName,
            message: readString("messageBody"),
            title: readString("title"),
            requestedDeliveryType: "AUTO" as const,
            deliveryType,
            estimatedCost: readString("estimatedCost"),
            templateVersion: readString("templateVersion"),
            templateHash: readString("templateHash"),
            configVersion: readString("configVersion"),
            configHash: readString("configHash"),
            ...(typeof targetSnapshot["systemTemplateKey"] === "string"
                ? { systemTemplateKey: targetSnapshot["systemTemplateKey"] as SystemTemplateKey }
                : {}),
        };
        const snapshotHash = readString("snapshotHash");
        if (this.hashSnapshot(candidateWithoutHash) !== snapshotHash || snapshotHash !== canonical.snapshotHash) {
            throw new Error("approved SMS snapshot does not match the current provider-bound target");
        }

        return Object.freeze({ ...candidateWithoutHash, snapshotHash });
    }

    /** Return only fields safe to persist in an approval target snapshot. */
    snapshotForApproval(snapshot: SmsTriggerDeliverySnapshot): Record<string, unknown> {
        return {
            templateKey: snapshot.templateKey,
            receiver: snapshot.maskedReceiver,
            messageBody: snapshot.message,
            title: snapshot.title,
            requestedDeliveryType: snapshot.requestedDeliveryType,
            deliveryType: snapshot.deliveryType,
            estimatedCost: snapshot.estimatedCost,
            templateVersion: snapshot.templateVersion,
            templateHash: snapshot.templateHash,
            configVersion: snapshot.configVersion,
            configHash: snapshot.configHash,
            snapshotHash: snapshot.snapshotHash,
            ...(snapshot.systemTemplateKey ? { systemTemplateKey: snapshot.systemTemplateKey } : {}),
        };
    }

    /**
     * Stage exact rendered values on an agent retry job. The serialized form
     * intentionally omits the raw receiver so persisted approval/log payloads
     * cannot disclose it.
     */
    serializeSnapshot(snapshot: SmsTriggerDeliverySnapshot): string {
        return JSON.stringify({
            templateKey: snapshot.templateKey,
            maskedReceiver: snapshot.maskedReceiver,
            recipientName: snapshot.recipientName,
            message: snapshot.message,
            title: snapshot.title,
            requestedDeliveryType: snapshot.requestedDeliveryType,
            deliveryType: snapshot.deliveryType,
            estimatedCost: snapshot.estimatedCost,
            templateVersion: snapshot.templateVersion,
            templateHash: snapshot.templateHash,
            configVersion: snapshot.configVersion,
            configHash: snapshot.configHash,
            snapshotHash: snapshot.snapshotHash,
            ...(snapshot.systemTemplateKey ? { systemTemplateKey: snapshot.systemTemplateKey } : {}),
        });
    }

    async sendJob(job: MessageTriggerJobEntity): Promise<boolean> {
        if (!job.branchId) {
            throw new Error(`SMS trigger job ${job.id} is missing branchId`);
        }

        const config = SMS_TEMPLATE_DELIVERY[job.templateKey];
        if (!config) {
            return false;
        }

        const missingPriceInfoKeys = this.missingPriceInfoKeys(job, config);
        if (missingPriceInfoKeys.length > 0) {
            job.cancel(`비용 안내 발송 건너뜀: 필수 정보 누락 (${missingPriceInfoKeys.join(", ")})`);
            this.logger.warn(
                `[SMS Automation] PRICE_INFO skipped for job ${job.id}: missing ${missingPriceInfoKeys.join(", ")}`,
            );
            return false;
        }

        return this.sendSmsJob(job, config);
    }

    private async sendSmsJob(
        job: MessageTriggerJobEntity,
        config: SmsTemplateDeliveryConfig,
    ): Promise<boolean> {
        const payload = job.payload;
        const snapshot = await this.resolveDeliverySnapshot(job);

        try {
            const result = await this.aligoService.sendSms({
                receiver: snapshot.receiver,
                message: snapshot.message,
                recipientName: snapshot.recipientName,
                title: snapshot.title,
                msgType: snapshot.requestedDeliveryType,
            });
            const isAccepted = this.isAcceptedSmsResult(result);
            job.payload.templateVariables["retrySafety"] = isAccepted ? "delivered" : "provider-rejected";
            await this.recordSmsLog({
                job,
                config,
                snapshot,
                receiver: result.request.receiver,
                status: isAccepted ? "sent" : "failed",
                aligoMid: result.response.msg_id ? String(result.response.msg_id) : null,
                errorMessage: isAccepted ? null : result.response.message,
                msgType: result.request.msgType,
                templateVariables: payload.templateVariables,
            });
            return isAccepted;
        } catch (error) {
            job.payload.templateVariables["retrySafety"] = "uncertain";
            const errorMessage = this.formatErrorMessage(error);
            await this.recordSmsLog({
                job,
                config,
                snapshot,
                receiver: snapshot.receiver,
                status: "failed",
                aligoMid: null,
                errorMessage,
                msgType: snapshot.requestedDeliveryType,
                templateVariables: payload.templateVariables,
            }).catch((logError) => {
                this.logger.warn(
                    `Failed to record SMS log: ${this.formatErrorMessage(logError)}`,
                );
            });
            throw error;
        }
    }

    private async resolveCanonicalSnapshot(
        job: MessageTriggerJobEntity,
        config: SmsTemplateDeliveryConfig,
    ): Promise<Readonly<SmsTriggerDeliverySnapshot>> {
        const payload = job.payload;
        const baseVariables: Record<string, string> = {
            name: payload.recipientName,
            employeeName: payload.recipientName,
            clientName: payload.recipientName,
            buttonUrl: payload.buttonUrl ?? "",
            serviceRecordUrl: payload.buttonUrl ?? "",
            ...payload.templateVariables,
        };
        const usesPayloadMessage = config.usePayloadMessage || payload.templateVariables["triggerType"] === "agent_scheduled";
        const template = usesPayloadMessage
            ? this.resolvePayloadTemplate(job)
            : await this.resolveSystemTemplate(config.systemTemplateKey);
        // Payload messages retain the legacy trim/no-render behavior in
        // resolvePayloadTemplate; editable system templates are rendered
        // byte-for-byte so approval and provider requests remain equivalent.
        const message = usesPayloadMessage
            ? template.content
            : this.renderTemplate(template.content, baseVariables);
        const title = usesPayloadMessage
            ? payload.templateVariables["title"]?.trim() || config.title
            : config.title;
        const receiver = payload.recipientPhone?.trim() || job.recipientPhone?.trim() || "";
        if (!receiver) {
            throw new Error(`SMS recipient is missing for job ${job.id}`);
        }

        const deliveryType = resolveAligoSmsMessageType({
            message,
            title,
            requestedType: "AUTO",
        });
        const configHash = this.hash({
            version: SMS_DELIVERY_CONFIG_VERSION,
            templateKey: job.templateKey,
            config,
            title,
            requestedDeliveryType: "AUTO",
        });
        const snapshotWithoutHash = {
            templateKey: job.templateKey,
            receiver,
            maskedReceiver: this.maskedReceiver(receiver),
            recipientName: payload.recipientName,
            message,
            title,
            requestedDeliveryType: "AUTO" as const,
            deliveryType,
            estimatedCost: `${deliveryType} 요금제 기준`,
            templateVersion: template.version,
            templateHash: template.hash,
            configVersion: SMS_DELIVERY_CONFIG_VERSION,
            configHash,
            ...(config.systemTemplateKey ? { systemTemplateKey: config.systemTemplateKey } : {}),
        };
        return Object.freeze({
            ...snapshotWithoutHash,
            snapshotHash: this.hashSnapshot(snapshotWithoutHash),
        });
    }

    private async resolveSystemTemplate(
        systemTemplateKey: SystemTemplateKey | undefined,
    ): Promise<{ content: string; version: string; hash: string }> {
        if (!systemTemplateKey) {
            throw new Error("systemTemplateKey is required for templated SMS delivery");
        }
        try {
            const template = await this.systemTemplateService.getByKey(systemTemplateKey);
            const content = template.content;
            const hash = this.hash(content);
            const updatedAt = template.updatedAt instanceof Date && !Number.isNaN(template.updatedAt.getTime())
                ? template.updatedAt.toISOString()
                : `content:${hash}`;
            return {
                content,
                version: `${template.id || systemTemplateKey}:${updatedAt}`,
                hash,
            };
        } catch (error) {
            if (isTransientPrismaConnectivityError(error)) {
                throw new TriggerJobDeferredError(
                    "transient",
                    error instanceof Error ? error.message : String(error),
                );
            }

            this.logger.warn(
                `[SMS Automation] Failed to load system template ${systemTemplateKey}, using registry default: ${
                    error instanceof Error ? error.message : String(error)
                }`,
            );
            const content = SYSTEM_TEMPLATE_REGISTRY[systemTemplateKey].defaultContent;
            const hash = this.hash(content);
            return { content, version: `registry-default:${systemTemplateKey}`, hash };
        }
    }

    private resolvePayloadTemplate(job: MessageTriggerJobEntity): { content: string; version: string; hash: string } {
        const content = job.payload.messageBody?.trim();
        if (!content) {
            throw new Error(`SMS payload message is missing for job ${job.id}`);
        }
        const hash = this.hash(content);
        return { content, version: `payload:${hash}`, hash };
    }

    private renderTemplate(template: string, variables: Record<string, string>): string {
        return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (match, key) => variables[key] ?? match);
    }

    private async recordSmsLog(params: {
        job: MessageTriggerJobEntity;
        config: SmsTemplateDeliveryConfig;
        snapshot: SmsTriggerDeliverySnapshot;
        receiver: string;
        status: MessageLogStatus;
        aligoMid: string | null;
        errorMessage: string | null;
        msgType: string;
        templateVariables: Record<string, string>;
    }): Promise<void> {
        const now = new Date();
        const variables: Record<string, string> = {
            ...this.sanitizeLogVariables(params.templateVariables),
            automationKey: params.config.automationKey,
            recipientName: params.job.payload.recipientName,
            title: params.snapshot.title,
            triggerType: params.config.triggerType,
            msgType: params.msgType,
            deliveryType: params.snapshot.deliveryType,
            estimatedCost: params.snapshot.estimatedCost,
            templateVersion: params.snapshot.templateVersion,
            templateHash: params.snapshot.templateHash,
            configVersion: params.snapshot.configVersion,
            configHash: params.snapshot.configHash,
            recipientDisplay: params.snapshot.maskedReceiver,
        };
        if (params.config.systemTemplateKey) {
            variables["systemTemplateKey"] = params.config.systemTemplateKey;
        }

        await this.logRepository.save(
            MessageLogEntity.reconstitute(
                0,
                params.job.branchId,
                "aligo_sms",
                params.config.smsLogTemplateKey,
                params.job.id,
                params.receiver,
                params.job.clientId,
                params.snapshot.message,
                variables,
                params.status,
                params.aligoMid,
                params.errorMessage,
                1,
                now,
                params.status === "failed"
                    ? new Date(now.getTime() + SMS_DELIVERY_RETRY_DELAY_MS)
                    : null,
                now,
                now,
                params.job.payload.recipientName,
                params.job.payload.recipientPhone,
            ),
        );
    }

    private missingPriceInfoKeys(
        job: MessageTriggerJobEntity,
        config: SmsTemplateDeliveryConfig,
    ): string[] {
        if (config.systemTemplateKey !== SystemTemplateKey.PRICE_INFO) {
            return [];
        }

        const variables: Record<string, string> = {
            ...job.payload.templateVariables,
            name: job.payload.recipientName,
        };
        const requiredKeys = ["fullPrice", "grant", "actualPrice", "bankName", "accNum", "duration", "type"];
        return requiredKeys.filter((key) => !variables[key]?.trim());
    }

    private readStagedSnapshot(
        job: MessageTriggerJobEntity,
        canonical: SmsTriggerDeliverySnapshot,
    ): SmsTriggerDeliverySnapshot | null {
        const serialized = job.payload.templateVariables[SMS_DELIVERY_SNAPSHOT_VARIABLE];
        if (!serialized) {
            return null;
        }

        try {
            const parsed = JSON.parse(serialized) as Partial<SmsTriggerDeliverySnapshot>;
            if (
                parsed.templateKey !== job.templateKey
                || typeof parsed.message !== "string"
                || typeof parsed.title !== "string"
                || parsed.requestedDeliveryType !== "AUTO"
                || (parsed.deliveryType !== "SMS" && parsed.deliveryType !== "LMS")
                || typeof parsed.maskedReceiver !== "string"
                || parsed.maskedReceiver !== canonical.maskedReceiver
                || typeof parsed.recipientName !== "string"
                || typeof parsed.estimatedCost !== "string"
                || typeof parsed.templateVersion !== "string"
                || typeof parsed.templateHash !== "string"
                || typeof parsed.configVersion !== "string"
                || typeof parsed.configHash !== "string"
                || typeof parsed.snapshotHash !== "string"
            ) {
                throw new Error("invalid staged SMS delivery snapshot");
            }

            const snapshotWithoutHash: Omit<SmsTriggerDeliverySnapshot, "snapshotHash"> = {
                templateKey: parsed.templateKey,
                receiver: canonical.receiver,
                maskedReceiver: canonical.maskedReceiver,
                recipientName: parsed.recipientName,
                message: parsed.message,
                title: parsed.title,
                requestedDeliveryType: "AUTO",
                deliveryType: parsed.deliveryType as AligoSmsMessageType,
                estimatedCost: parsed.estimatedCost,
                templateVersion: parsed.templateVersion,
                templateHash: parsed.templateHash,
                configVersion: parsed.configVersion,
                configHash: parsed.configHash,
                ...(parsed.systemTemplateKey ? { systemTemplateKey: parsed.systemTemplateKey } : {}),
            };
            if (this.hashSnapshot(snapshotWithoutHash) !== parsed.snapshotHash) {
                throw new Error("staged SMS delivery snapshot hash mismatch");
            }
            return { ...snapshotWithoutHash, snapshotHash: parsed.snapshotHash };
        } catch (error) {
            throw new Error(
                `SMS delivery snapshot is invalid: ${error instanceof Error ? error.message : String(error)}`,
            );
        }
    }

    private sanitizeLogVariables(templateVariables: Record<string, string>): Record<string, string> {
        return Object.fromEntries(
            Object.entries(templateVariables).filter(([key]) =>
                key !== SMS_DELIVERY_SNAPSHOT_VARIABLE
                && !/(phone|receiver|telephone|mobile)/i.test(key)),
        );
    }

    private maskedReceiver(value: string): string {
        const digits = value.replace(/\D/g, "");
        return digits.length >= 4 ? `••••${digits.slice(-4)}` : "마스킹된 번호";
    }

    private hash(value: unknown): string {
        return createHash("sha256").update(JSON.stringify(value)).digest("hex");
    }

    private hashSnapshot(snapshot: Omit<SmsTriggerDeliverySnapshot, "snapshotHash">): string {
        return this.hash({
            templateKey: snapshot.templateKey,
            receiver: snapshot.receiver,
            maskedReceiver: snapshot.maskedReceiver,
            recipientName: snapshot.recipientName,
            message: snapshot.message,
            title: snapshot.title,
            requestedDeliveryType: snapshot.requestedDeliveryType,
            deliveryType: snapshot.deliveryType,
            estimatedCost: snapshot.estimatedCost,
            templateVersion: snapshot.templateVersion,
            templateHash: snapshot.templateHash,
            configVersion: snapshot.configVersion,
            configHash: snapshot.configHash,
            ...(snapshot.systemTemplateKey ? { systemTemplateKey: snapshot.systemTemplateKey } : {}),
        });
    }

    private isAcceptedSmsResult(result: SendAligoSmsResult): boolean {
        const resultCode = Number(result.response.result_code);
        const errorCount = Number(result.response.error_cnt ?? 0);
        return resultCode === 1 && errorCount === 0;
    }

    private formatErrorMessage(error: unknown): string {
        if (error instanceof Error && error.message.trim()) {
            return error.message;
        }
        const message = String(error ?? "").trim();
        return message || "문자 발송 요청이 실패했습니다.";
    }
}
