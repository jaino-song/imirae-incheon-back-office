import { Inject, Injectable, Logger } from "@nestjs/common";
import { AligoService } from "application/services/aligo.service";
import { SystemTemplateService } from "application/services/system-template.service";
import { SendAligoSmsResult } from "application/dto/aligo/send-sms.dto";
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

interface SmsTemplateDeliveryConfig {
    smsLogTemplateKey: string;
    automationKey: string;
    triggerType: string;
    title: string;
    systemTemplateKey?: SystemTemplateKey;
    usePayloadMessage?: boolean;
}

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

    async sendJob(job: MessageTriggerJobEntity): Promise<boolean> {
        if (!job.branchId) {
            throw new Error(`SMS trigger job ${job.id} is missing branchId`);
        }

        const config = SMS_TEMPLATE_DELIVERY[job.templateKey];
        if (!config) {
            return false;
        }

        return this.sendSmsJob(job, config);
    }

    private async sendSmsJob(
        job: MessageTriggerJobEntity,
        config: SmsTemplateDeliveryConfig,
    ): Promise<boolean> {
        const payload = job.payload;
        const baseVariables: Record<string, string> = {
            name: payload.recipientName,
            employeeName: payload.recipientName,
            clientName: payload.recipientName,
            buttonUrl: payload.buttonUrl ?? "",
            serviceRecordUrl: payload.buttonUrl ?? "",
            ...payload.templateVariables,
        };
        if (config.systemTemplateKey === SystemTemplateKey.PRICE_INFO) {
            const requiredKeys = ["fullPrice", "grant", "actualPrice", "bankName", "accNum", "duration", "type"];
            const missing = requiredKeys.filter((key) => !baseVariables[key]?.trim());
            if (missing.length > 0) {
                job.cancel(`비용 안내 발송 건너뜀: 필수 정보 누락 (${missing.join(", ")})`);
                this.logger.warn(
                    `[SMS Automation] PRICE_INFO skipped for job ${job.id}: missing ${missing.join(", ")}`,
                );
                return false;
            }
        }

        const message = config.usePayloadMessage || payload.templateVariables["triggerType"] === "agent_scheduled"
            ? this.resolvePayloadSmsMessage(job)
            : await this.resolveSmsMessage(config.systemTemplateKey, baseVariables);
        const receiver = payload.recipientPhone;

        try {
            const result = await this.aligoService.sendSms({
                receiver,
                message,
                recipientName: payload.recipientName,
                title: config.title,
                msgType: "AUTO",
            });
            const isAccepted = this.isAcceptedSmsResult(result);
            job.payload.templateVariables["retrySafety"] = isAccepted ? "delivered" : "provider-rejected";
            await this.recordSmsLog({
                job,
                config,
                message,
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
                message,
                receiver,
                status: "failed",
                aligoMid: null,
                errorMessage,
                msgType: "AUTO",
                templateVariables: payload.templateVariables,
            }).catch((logError) => {
                this.logger.warn(
                    `Failed to record SMS log: ${this.formatErrorMessage(logError)}`,
                );
            });
            throw error;
        }
    }

    private async resolveSmsMessage(
        systemTemplateKey: SystemTemplateKey | undefined,
        variables: Record<string, string>,
    ): Promise<string> {
        if (!systemTemplateKey) {
            throw new Error("systemTemplateKey is required for templated SMS delivery");
        }
        try {
            const template = await this.systemTemplateService.getByKey(systemTemplateKey);
            return this.renderTemplate(template.content, variables);
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
            return this.renderTemplate(
                SYSTEM_TEMPLATE_REGISTRY[systemTemplateKey].defaultContent,
                variables,
            );
        }
    }

    private resolvePayloadSmsMessage(job: MessageTriggerJobEntity): string {
        const message = job.payload.messageBody?.trim();
        if (!message) {
            throw new Error(`SMS payload message is missing for job ${job.id}`);
        }
        return message;
    }

    private renderTemplate(template: string, variables: Record<string, string>): string {
        return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (match, key) => variables[key] ?? match);
    }

    private async recordSmsLog(params: {
        job: MessageTriggerJobEntity;
        config: SmsTemplateDeliveryConfig;
        message: string;
        receiver: string;
        status: MessageLogStatus;
        aligoMid: string | null;
        errorMessage: string | null;
        msgType: string;
        templateVariables: Record<string, string>;
    }): Promise<void> {
        const now = new Date();
        const variables: Record<string, string> = {
            ...params.templateVariables,
            automationKey: params.config.automationKey,
            recipientName: params.job.payload.recipientName,
            title: params.config.title,
            triggerType: params.config.triggerType,
            msgType: params.msgType,
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
                params.message,
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
