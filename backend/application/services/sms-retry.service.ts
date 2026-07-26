import { ConflictException, Inject, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { AligoService } from "application/services/aligo.service";
import { MessageSenderApprovalService } from "application/services/message-sender-approval.service";
import { maskPhone } from "application/utils/mask";
import { MessageLogEntity, SMS_DELIVERY_RETRY_DELAY_MS } from "domain/entities/message-log.entity";
import {
    MESSAGE_LOG_REPOSITORY,
    IMessageLogRepository,
} from "domain/repositories/message-log.repository.interface";

@Injectable()
export class SmsRetryService {
    private readonly logger = new Logger(SmsRetryService.name);

    constructor(
        @Inject(MESSAGE_LOG_REPOSITORY)
        private readonly logRepository: IMessageLogRepository,
        private readonly aligoService: AligoService,
        private readonly messageSenderApprovalService: MessageSenderApprovalService,
    ) {}

    async retryById(branchId: string, logId: number): Promise<MessageLogEntity> {
        const sourceLog = await this.logRepository.findByIdInBranch(branchId, logId);
        if (!sourceLog || sourceLog.provider !== "aligo_sms") {
            throw new NotFoundException("재발송할 메시지 기록을 찾을 수 없습니다.");
        }

        if (sourceLog.status !== "failed") {
            throw new ConflictException("실패한 메시지만 재발송할 수 있습니다.");
        }

        const retryLog = await this.retry(sourceLog);
        if (!retryLog) {
            throw new ConflictException("이미 재발송이 진행 중입니다.");
        }

        return retryLog;
    }

    async retry(sourceLog: MessageLogEntity): Promise<MessageLogEntity | null> {
        const retryLog = await this.logRepository.startRetryAttempt(
            sourceLog,
            this.createRetryAttempt(sourceLog),
        );
        if (!retryLog) {
            this.logger.warn(`[Retry] SMS log ${sourceLog.id} was already claimed`);
            return null;
        }

        if (retryLog.branchId) {
            try {
                await this.messageSenderApprovalService.ensureApproved(retryLog.branchId);
            } catch (approvalError) {
                const reason = approvalError instanceof Error ? approvalError.message : String(approvalError);
                this.logger.warn(`[Retry] SMS blocked by approval gate for log ${retryLog.id} (branchId=${retryLog.branchId}): ${reason}`);
                retryLog.status = "failed";
                retryLog.errorMessage = reason;
                retryLog.attempts += 1;
                retryLog.lastAttemptAt = new Date(Date.now());
                retryLog.nextRetryAt = null;
                await this.logRepository.update(retryLog);
                return retryLog;
            }
        }

        try {
            const rawScheduledDate = this.stringVariable(retryLog, "scheduledDate");
            const rawScheduledTime = this.stringVariable(retryLog, "scheduledTime");
            const scheduleInstantMs = rawScheduledDate && rawScheduledTime
                ? this.parseKstScheduleMs(rawScheduledDate, rawScheduledTime)
                : null;
            const isScheduledInFuture = scheduleInstantMs !== null && scheduleInstantMs > Date.now();

            const scheduledDate = isScheduledInFuture ? rawScheduledDate : undefined;
            const scheduledTime = isScheduledInFuture ? rawScheduledTime : undefined;

            const result = await this.aligoService.sendSms({
                senderPhone: this.stringVariable(retryLog, "senderPhone"),
                receiver: retryLog.receiver,
                message: retryLog.messageBody,
                recipientName: retryLog.recipientName ?? this.stringVariable(retryLog, "recipientName") ?? undefined,
                title: this.stringVariable(retryLog, "title") ?? undefined,
                msgType: this.smsMessageTypeVariable(retryLog, "msgType"),
                ...(scheduledDate ? { scheduledDate } : {}),
                ...(scheduledTime ? { scheduledTime } : {}),
                ...(this.booleanVariable(retryLog, "testMode") ? { testMode: true } : {}),
            });

            if (!this.isAcceptedSmsResult(result)) {
                this.markSmsRetryFailed(retryLog, result.response.message || "문자 발송 요청이 실패했습니다.");
                await this.logRepository.update(retryLog);
                this.logger.warn(`[Retry] SMS retry rejected for log ${retryLog.id}: ${result.response.message}`);
                return retryLog;
            }

            if (isScheduledInFuture) {
                retryLog.status = "pending";
                retryLog.aligoMid = result.response.msg_id ? String(result.response.msg_id) : null;
                retryLog.lastAttemptAt = new Date(Date.now());
                retryLog.nextRetryAt = null;
                retryLog.attempts += 1;
            } else {
                retryLog.markSent(result.response.msg_id ? String(result.response.msg_id) : undefined);
            }
            await this.logRepository.update(retryLog);
            this.logger.log(`[Retry] Successfully resent SMS ${retryLog.templateKey} to ${maskPhone(retryLog.receiver)}`);
            return retryLog;
        } catch (error) {
            this.markSmsRetryFailed(retryLog, error instanceof Error ? error.message : String(error));
            await this.logRepository.update(retryLog);
            this.logger.warn(`[Retry] Failed SMS attempt ${retryLog.attempts} for log ${retryLog.id}: ${error}`);
            return retryLog;
        }
    }

    private createRetryAttempt(sourceLog: MessageLogEntity): MessageLogEntity {
        const now = new Date(Date.now());
        const recoveryAt = new Date(now.getTime() + SMS_DELIVERY_RETRY_DELAY_MS);
        return MessageLogEntity.reconstitute(
            0,
            sourceLog.branchId,
            sourceLog.provider,
            sourceLog.templateKey,
            sourceLog.triggerJobId,
            sourceLog.receiver,
            sourceLog.clientId,
            sourceLog.messageBody,
            {
                ...sourceLog.variables,
                retryOfLogId: String(sourceLog.id),
                retryAttempt: String(sourceLog.attempts + 1),
            },
            "pending",
            null,
            null,
            sourceLog.attempts,
            null,
            recoveryAt,
            now,
            now,
            sourceLog.recipientName,
            sourceLog.recipientPhone,
        );
    }

    private parseKstScheduleMs(date: string, time: string): number | null {
        const isoDate = `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}`;
        const isoTime = `${time.slice(0, 2)}:${time.slice(2, 4)}`;
        const ms = new Date(`${isoDate}T${isoTime}:00+09:00`).getTime();
        return Number.isNaN(ms) ? null : ms;
    }

    private markSmsRetryFailed(log: MessageLogEntity, errorMessage: string): void {
        log.status = "failed";
        log.errorMessage = errorMessage;
        log.attempts += 1;
        log.lastAttemptAt = new Date(Date.now());
        log.nextRetryAt = log.canRetry()
            ? new Date(Date.now() + SMS_DELIVERY_RETRY_DELAY_MS)
            : null;
    }

    private isAcceptedSmsResult(result: Awaited<ReturnType<AligoService["sendSms"]>>): boolean {
        const resultCode = Number(result.response.result_code);
        const errorCount = Number(result.response.error_cnt ?? 0);
        return resultCode === 1 && errorCount === 0;
    }

    private stringVariable(log: MessageLogEntity, key: string): string | undefined {
        const value = log.variables[key];
        return typeof value === "string" && value.trim() ? value : undefined;
    }

    private smsMessageTypeVariable(
        log: MessageLogEntity,
        key: string,
    ): "SMS" | "LMS" | "AUTO" | undefined {
        const value = this.stringVariable(log, key);
        return value === "SMS" || value === "LMS" || value === "AUTO" ? value : undefined;
    }

    private booleanVariable(log: MessageLogEntity, key: string): boolean {
        return this.stringVariable(log, key) === "true";
    }
}
