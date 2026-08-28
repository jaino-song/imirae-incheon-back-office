import { ConflictException, Inject, Injectable, Logger, NotFoundException, Optional } from "@nestjs/common";
import { AligoService } from "application/services/aligo.service";
import { MessageSenderApprovalService } from "application/services/message-sender-approval.service";
import { parseKstSchedule } from "application/utils/kst-schedule";
import { maskPhone } from "application/utils/mask";
import { MessageLogEntity, SMS_DELIVERY_RETRY_DELAY_MS } from "domain/entities/message-log.entity";
import {
    MESSAGE_LOG_REPOSITORY,
    IMessageLogRepository,
} from "domain/repositories/message-log.repository.interface";
import {
    buildSmsProviderAcceptanceFingerprint,
    buildSmsProviderAcceptanceKey,
    SmsProviderAcceptanceService,
    SmsProviderReconciliationInput,
} from "./sms-provider-acceptance.service";

const INVALID_RETRY_SCHEDULE_REASON =
    "예약 발송 일시 형식이 올바르지 않아 재시도하지 않았습니다. 예약일과 예약시간을 확인해 주세요.";

interface RetrySchedule {
    scheduledDate?: string;
    scheduledTime?: string;
    scheduledAtMs: number | null;
}

@Injectable()
export class SmsRetryService {
    private readonly logger = new Logger(SmsRetryService.name);

    constructor(
        @Inject(MESSAGE_LOG_REPOSITORY)
        private readonly logRepository: IMessageLogRepository,
        private readonly aligoService: AligoService,
        private readonly messageSenderApprovalService: MessageSenderApprovalService,
        @Optional()
        private readonly acceptanceService?: SmsProviderAcceptanceService,
    ) {}

    async retryById(branchId: string, logId: number): Promise<MessageLogEntity> {
        const sourceLog = await this.logRepository.findByIdInBranch(branchId, logId);
        if (!sourceLog || sourceLog.provider !== "aligo_sms") {
            throw new NotFoundException("재발송할 메시지 기록을 찾을 수 없습니다.");
        }

        if (sourceLog.status !== "failed") {
            throw new ConflictException("실패한 메시지만 재발송할 수 있습니다.");
        }

        if (sourceLog.isProviderOutcomeUncertain()) {
            throw new ConflictException(
                "문자 발송 결과가 불확실합니다. 제공자 이력을 확인하고 먼저 명시적으로 재조정해 주세요.",
            );
        }
        if (sourceLog.providerAcceptanceState === "reconciled_delivered") {
            throw new ConflictException("이미 발송 완료로 재조정된 문자는 재발송할 수 없습니다.");
        }

        const retryLog = await this.retry(sourceLog);
        if (!retryLog) {
            throw new ConflictException("이미 재발송이 진행 중입니다.");
        }

        return retryLog;
    }

    async retry(sourceLog: MessageLogEntity): Promise<MessageLogEntity | null> {
        const schedule = this.parseRetrySchedule(sourceLog);
        if (!schedule) {
            sourceLog.markRetrySuperseded(INVALID_RETRY_SCHEDULE_REASON);
            await this.logRepository.update(sourceLog);
            this.logger.warn(`[Retry] SMS log ${sourceLog.id} has an invalid historical schedule; retry stopped`);
            return sourceLog;
        }

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

        const providerAttempt = this.acceptanceService
            ? await this.acceptanceService.beginProviderCall(retryLog)
            : this.beginProviderCallWithoutBoundary(retryLog);

        try {
            const isScheduledInFuture = schedule.scheduledAtMs !== null && schedule.scheduledAtMs > Date.now();

            const scheduledDate = isScheduledInFuture ? schedule.scheduledDate : undefined;
            const scheduledTime = isScheduledInFuture ? schedule.scheduledTime : undefined;

            const result = await this.aligoService.sendSms({
                senderPhone: this.stringVariable(retryLog, "senderPhone"),
                receiver: providerAttempt.receiver,
                message: providerAttempt.messageBody,
                recipientName: providerAttempt.recipientName ?? this.stringVariable(providerAttempt, "recipientName") ?? undefined,
                title: this.stringVariable(providerAttempt, "title") ?? undefined,
                msgType: this.smsMessageTypeVariable(providerAttempt, "msgType"),
                ...(scheduledDate ? { scheduledDate } : {}),
                ...(scheduledTime ? { scheduledTime } : {}),
                ...(this.booleanVariable(retryLog, "testMode") ? { testMode: true } : {}),
            });

            if (!this.isAcceptedSmsResult(result)) {
                this.markSmsRetryRejected(providerAttempt, result.response.message || "문자 발송 요청이 실패했습니다.");
                await this.logRepository.update(providerAttempt);
                this.logger.warn(`[Retry] SMS retry rejected for log ${providerAttempt.id}: ${result.response.message}`);
                return providerAttempt;
            }

            providerAttempt.variables = {
                ...providerAttempt.variables,
                retrySafety: "accepted",
            };
            if (isScheduledInFuture) {
                providerAttempt.status = "pending";
                providerAttempt.aligoMid = result.response.msg_id ? String(result.response.msg_id) : null;
                providerAttempt.lastAttemptAt = new Date(Date.now());
                providerAttempt.nextRetryAt = null;
                providerAttempt.attempts += 1;
            } else {
                providerAttempt.markSent(result.response.msg_id ? String(result.response.msg_id) : undefined);
            }
            providerAttempt.providerAcceptanceState = "accepted";
            providerAttempt.providerAcceptedAt = new Date(Date.now());
            await this.logRepository.update(providerAttempt);
            this.logger.log(`[Retry] Successfully resent SMS ${providerAttempt.templateKey} to ${maskPhone(providerAttempt.receiver)}`);
            return providerAttempt;
        } catch (error) {
            this.markSmsRetryUncertain(
                providerAttempt,
                error instanceof Error ? error.message : String(error),
            );
            await this.logRepository.update(providerAttempt);
            this.logger.warn(
                `[Retry] SMS result uncertain for log ${providerAttempt.id}; automatic retry stopped: ${error}`,
            );
            return providerAttempt;
        }
    }

    async reconcileById(
        branchId: string,
        logId: number,
        outcome: SmsProviderReconciliationInput["outcome"],
        actor: string,
        reason: string,
        providerMessageId?: string | null,
    ): Promise<MessageLogEntity> {
        if (!this.acceptanceService) {
            throw new ConflictException("SMS provider reconciliation is not configured");
        }
        return this.acceptanceService.reconcile({
            branchId,
            logId,
            outcome,
            actor,
            reason,
            providerMessageId,
        });
    }

    private createRetryAttempt(sourceLog: MessageLogEntity): MessageLogEntity {
        const now = new Date(Date.now());
        const recoveryAt = new Date(now.getTime() + SMS_DELIVERY_RETRY_DELAY_MS);
        const retryAttempt = sourceLog.attempts + 1;
        const providerAcceptanceKey = buildSmsProviderAcceptanceKey(
            "retry",
            `${sourceLog.providerAcceptanceKey ?? `legacy:${sourceLog.id}`}:revision:${sourceLog.updatedAt.toISOString()}:attempt:${retryAttempt}`,
        );
        const providerAcceptanceFingerprint = sourceLog.providerAcceptanceFingerprint
            ?? buildSmsProviderAcceptanceFingerprint({
                branchId: sourceLog.branchId,
                triggerJobId: sourceLog.triggerJobId,
                templateKey: sourceLog.templateKey,
                receiver: sourceLog.receiver,
                message: sourceLog.messageBody,
                variables: sourceLog.variables,
                retryAttempt,
            });
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
                retryAttempt: String(retryAttempt),
                // Persist the attempt conservatively before the provider call. If the
                // process exits after submission but before the result update, the
                // scheduler must not submit the same SMS again automatically.
                retrySafety: "uncertain",
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
            providerAcceptanceKey,
            providerAcceptanceFingerprint,
            "prepared",
        );
    }

    private parseRetrySchedule(log: MessageLogEntity): RetrySchedule | null {
        const rawDate: unknown = log.variables["scheduledDate"];
        const rawTime: unknown = log.variables["scheduledTime"];
        const isExplicitlyScheduled = log.variables["triggerType"] === "scheduled";
        const hasDate = rawDate !== undefined && rawDate !== null;
        const hasTime = rawTime !== undefined && rawTime !== null;

        if (!hasDate && !hasTime) {
            return isExplicitlyScheduled ? null : { scheduledAtMs: null };
        }
        if (!hasDate || !hasTime || typeof rawDate !== "string" || typeof rawTime !== "string") {
            return null;
        }
        if (!/^\d{8}$/.test(rawDate) || !/^\d{4}$/.test(rawTime)) {
            return null;
        }

        const isoDate = `${rawDate.slice(0, 4)}-${rawDate.slice(4, 6)}-${rawDate.slice(6, 8)}`;
        const isoTime = `${rawTime.slice(0, 2)}:${rawTime.slice(2, 4)}`;
        const scheduledAt = parseKstSchedule(isoDate, isoTime);
        if (!scheduledAt) {
            return null;
        }

        return {
            scheduledDate: rawDate,
            scheduledTime: rawTime,
            scheduledAtMs: scheduledAt.getTime(),
        };
    }

    private markSmsRetryRejected(log: MessageLogEntity, errorMessage: string): void {
        log.status = "failed";
        log.providerAcceptanceState = "rejected";
        log.providerAcceptedAt = null;
        log.errorMessage = errorMessage;
        log.attempts += 1;
        log.lastAttemptAt = new Date(Date.now());
        log.variables = {
            ...log.variables,
            retrySafety: "provider-rejected",
        };
        log.nextRetryAt = log.canRetry()
            ? new Date(Date.now() + SMS_DELIVERY_RETRY_DELAY_MS)
            : null;
    }

    private markSmsRetryUncertain(log: MessageLogEntity, errorMessage: string): void {
        log.status = "failed";
        log.errorMessage = `${errorMessage} 문자 발송 결과가 불확실하여 자동 재전송을 중단했습니다. 제공자 이력 확인 후 수동 확인이 필요합니다.`;
        log.attempts += 1;
        log.lastAttemptAt = new Date(Date.now());
        log.nextRetryAt = null;
        log.variables = {
            ...log.variables,
            retrySafety: "uncertain",
        };
        log.providerAcceptanceState = log.providerAcceptanceState === "started"
            ? "uncertain"
            : log.providerAcceptanceState;
    }

    private beginProviderCallWithoutBoundary(log: MessageLogEntity): MessageLogEntity {
        if (log.providerAcceptanceState !== "prepared" && log.providerAcceptanceState !== "legacy") {
            throw new ConflictException(`SMS provider attempt cannot start from ${log.providerAcceptanceState}`);
        }
        log.providerAcceptanceState = "started";
        log.providerCallStartedAt = new Date(Date.now());
        return log;
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
