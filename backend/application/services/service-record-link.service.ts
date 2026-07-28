import { randomUUID } from "node:crypto";

import { BadRequestException, Inject, Injectable, Logger, NotFoundException, Optional } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PrismaService } from "infrastructure/database/prisma.service";
import {
    SERVICE_RECORD_LINK_RULE_ID,
    SERVICE_RECORD_LINK_SMS_AUTOMATION_KEY,
    SERVICE_RECORD_LINK_SMS_LOG_TEMPLATE_KEY,
    SERVICE_RECORD_LINK_SMS_TITLE,
    SERVICE_RECORD_LINK_SMS_TRIGGER_TYPE,
    getServiceRecordLinkScheduledFor,
    getServiceRecordTokenExpiresAt,
} from "domain/constants/service-record-link-message";
import {
    MessageTriggerEventType,
    MessageTriggerOffsetType,
    MessageTriggerRecipientType,
    MessageTriggerTemplateKey,
} from "domain/constants/message-trigger-catalog";
import { MessageTriggerJobEntity } from "domain/entities/message-trigger-job.entity";
import { MessageLogEntity } from "domain/entities/message-log.entity";
import {
    MESSAGE_TRIGGER_JOB_REPOSITORY,
    IMessageTriggerJobRepository,
} from "domain/repositories/message-trigger-job.repository.interface";
import {
    MESSAGE_LOG_REPOSITORY,
    IMessageLogRepository,
} from "domain/repositories/message-log.repository.interface";
import { ServiceRecordTokenService } from "./service-record-token.service";
import { ServiceRecordLifecycleService } from "./service-record-lifecycle.service";
import { captureServiceRecordError } from "infrastructure/observability/service-record-sentry";

/**
 * Issues / revokes the no-login 제공기록지 link for an assignment (BJJ-247).
 * Assignment flows schedule the SMS for service-start day 15:00 KST; the existing
 * Message trigger scheduler later dispatches it and writes retryable SMS logs.
 */
@Injectable()
export class ServiceRecordLinkService {
    private readonly logger = new Logger(ServiceRecordLinkService.name);

    constructor(
        private readonly prisma: PrismaService,
        private readonly tokenService: ServiceRecordTokenService,
        private readonly configService: ConfigService,
        @Inject(MESSAGE_TRIGGER_JOB_REPOSITORY)
        private readonly jobRepository: IMessageTriggerJobRepository,
        @Inject(MESSAGE_LOG_REPOSITORY)
        private readonly logRepository: IMessageLogRepository,
        @Optional() private readonly lifecycleService?: ServiceRecordLifecycleService,
    ) {}

    /** Backward-compatible wrapper: now schedules the SMS instead of sending immediately. */
    async issueAndSend(scheduleId: number): Promise<void> {
        return this.scheduleForServiceStart(scheduleId);
    }

    /** Ensure the assignment link exists and schedule the SMS for service-start day 15:00 KST. */
    async scheduleForServiceStart(scheduleId: number): Promise<void> {
        try {
            const { scheduledFor, employeeId, jobEnqueued } = await this.issueServiceRecordLinkJob(scheduleId, {
                scheduledFor: null,
                recordMissingPhoneFailure: true,
                isManualSend: false,
            });
            if (jobEnqueued) {
                this.logger.log(
                    `Service record link SMS scheduled for provider ${employeeId} schedule ${scheduleId} at ${scheduledFor.toISOString()}`
                );
            }
        } catch (error) {
            // Missing/legacy no-branch schedules were a silent no-op before the refactor; keep them log-free.
            if (error instanceof NotFoundException) return;
            captureServiceRecordError(error, {
                operation: "link-schedule",
                handled: true,
                scheduleId,
            });
            this.logger.error(`Failed to schedule service-record link for schedule ${scheduleId}: ${error}`);
        }
    }

    /**
     * Reuse the assignment's active link when possible and enqueue immediate dispatch.
     * Unlike the assignment hook, errors are intentionally surfaced to the caller.
     */
    async sendNow(
        scheduleId: number,
        preparedLinkToken?: string,
        recipientPhone?: string,
    ): Promise<{ scheduledFor: Date; jobId: string }> {
        const scheduledFor = new Date();
        const result = await this.issueServiceRecordLinkJob(scheduleId, {
            scheduledFor,
            recordMissingPhoneFailure: false,
            allowLateReissue: true,
            preparedLinkToken,
            isManualSend: true,
            recipientPhone,
        });
        if (!result.jobId) {
            throw new BadRequestException("제공기록지 링크 발송 작업을 생성하지 못했습니다");
        }
        this.logger.log(
            `Service record link SMS manually scheduled for provider ${result.employeeId} schedule ${scheduleId} at ${result.scheduledFor.toISOString()}`
        );
        return { scheduledFor: result.scheduledFor, jobId: result.jobId };
    }

    /**
     * Return the active assignment URL when one exists. Otherwise prepare the exact
     * inactive URL shown in the admin composer until sendNow activates the same row.
     */
    async prepareLink(scheduleId: number, recipientPhone?: string): Promise<{
        serviceRecordUrl: string;
        preparedLinkToken: string;
        expiresAt: Date;
    }> {
        const schedule = await this.prisma.employee_schedule.findUnique({
            where: { id: scheduleId },
            include: { primaryEmployee: true },
        });
        if (!schedule || !schedule.branchId || schedule.replaced) {
            throw new NotFoundException("Assignment not found");
        }

        const employee = schedule.primaryEmployee;
        const resolvedRecipientPhone = this.resolveRecipientPhone(employee.phone, recipientPhone);
        if (!resolvedRecipientPhone) {
            throw new BadRequestException("제공인력 전화번호가 없습니다");
        }

        const expiresAt = this.resolveExpiry(schedule.endDate, true);
        const tokenParams = {
            branchId: schedule.branchId,
            scheduleId,
            employeeId: employee.id,
            expectedPhone: resolvedRecipientPhone,
            expiresAt,
        };
        const { linkToken } = await this.tokenService.reuseActiveLink(tokenParams)
            ?? await this.tokenService.prepareLink(tokenParams);

        return {
            serviceRecordUrl: this.buildServiceRecordUrl(linkToken),
            preparedLinkToken: linkToken,
            expiresAt,
        };
    }

    /** Replace the active assignment link without scheduling or dispatching an SMS. */
    async resetLink(scheduleId: number): Promise<{
        serviceRecordUrl: string;
        expiresAt: Date;
    }> {
        const schedule = await this.prisma.employee_schedule.findUnique({
            where: { id: scheduleId },
            include: { primaryEmployee: true },
        });
        if (!schedule || !schedule.branchId || schedule.replaced) {
            throw new NotFoundException("Assignment not found");
        }

        const employee = schedule.primaryEmployee;
        const resolvedRecipientPhone = this.resolveRecipientPhone(employee.phone);
        if (!resolvedRecipientPhone) {
            throw new BadRequestException("제공인력 전화번호가 없습니다");
        }

        await this.cancelPendingServiceRecordJobs(scheduleId, "Service record link reset without resend");
        await this.supersedeRetryableServiceRecordSmsLogs(scheduleId, "Service record link reset without resend");

        const serviceRecordCase = await this.lifecycleService?.ensureForClient(schedule.clientId);
        const expiresAt = this.resolveExpiry(serviceRecordCase?.endDate ?? schedule.endDate, true);
        const { linkToken } = await this.tokenService.issueLink({
            branchId: schedule.branchId,
            scheduleId,
            employeeId: employee.id,
            ...(serviceRecordCase ? { serviceRecordCaseId: serviceRecordCase.id } : {}),
            expectedPhone: resolvedRecipientPhone,
            expiresAt,
        });

        return {
            serviceRecordUrl: this.buildServiceRecordUrl(linkToken),
            expiresAt,
        };
    }

    /** Revoke an assignment's service-record access (replacement / termination). */
    async revoke(scheduleId: number): Promise<void> {
        try {
            await this.tokenService.revokeForSchedule(scheduleId);
            await this.cancelPendingServiceRecordJobs(scheduleId, "Service record access revoked");
            this.logger.log(`Service record access revoked for schedule ${scheduleId}`);
        } catch (error) {
            this.logger.error(`Failed to revoke service-record link for schedule ${scheduleId}: ${error}`);
            throw error;
        }
    }

    async extendExpiryForEndDate(scheduleId: number, endDate: Date): Promise<void> {
        try {
            const record = await this.lifecycleService?.ensureForSchedule(scheduleId);
            const expiresAt = getServiceRecordTokenExpiresAt(record?.endDate ?? endDate);
            if (record) {
                await this.tokenService.extendExpiryForCase(record.id, expiresAt);
            } else {
                await this.tokenService.extendExpiryForSchedule(scheduleId, expiresAt);
            }
        } catch (error) {
            this.logger.error(`Failed to extend service-record token expiry for schedule ${scheduleId}: ${error}`);
            throw error;
        }
    }

    private async cancelPendingServiceRecordJobs(scheduleId: number, reason: string): Promise<void> {
        const jobs = await this.jobRepository.findPendingByRuleIdsAndEmployeeScheduleId(
            [SERVICE_RECORD_LINK_RULE_ID],
            scheduleId,
        );
        for (const job of jobs) {
            job.cancel(reason);
            await this.jobRepository.update(job);
        }
    }

    private async supersedeRetryableServiceRecordSmsLogs(scheduleId: number, reason: string): Promise<void> {
        const logs = await this.logRepository.findRetryableServiceRecordSmsByScheduleId(scheduleId);
        for (const log of logs) {
            log.markRetrySuperseded(reason);
            await this.logRepository.update(log);
        }
    }

    private async issueServiceRecordLinkJob(
        scheduleId: number,
        options: {
            scheduledFor: Date | null;
            recordMissingPhoneFailure: boolean;
            allowLateReissue?: boolean;
            preparedLinkToken?: string;
            isManualSend: boolean;
            recipientPhone?: string;
        },
    ): Promise<{
        scheduledFor: Date;
        employeeId: number;
        jobEnqueued: boolean;
        jobId: string | null;
    }> {
        const schedule = await this.prisma.employee_schedule.findUnique({
            where: { id: scheduleId },
            include: { primaryEmployee: true, client: true },
        });
        if (!schedule || !schedule.branchId || schedule.replaced) {
            throw new NotFoundException("Assignment not found");
        }

        await this.ensureSystemRule();
        const serviceRecordCase = await this.lifecycleService?.ensureForClient(schedule.clientId);

        const employee = schedule.primaryEmployee;
        const resolvedRecipientPhone = this.resolveRecipientPhone(
            employee.phone,
            options.recipientPhone,
        );
        if (options.preparedLinkToken) {
            if (!resolvedRecipientPhone) {
                throw new BadRequestException("제공인력 전화번호가 없습니다");
            }

            const activated = await this.tokenService.activatePreparedLink({
                linkToken: options.preparedLinkToken,
                branchId: schedule.branchId,
                scheduleId,
                employeeId: employee.id,
                expectedPhone: resolvedRecipientPhone,
                expiresAt: this.resolveExpiry(
                    serviceRecordCase?.endDate ?? schedule.endDate,
                    options.allowLateReissue === true,
                ),
            });
            if (!activated) {
                throw new BadRequestException("준비된 제공기록지 링크가 만료되었거나 유효하지 않습니다");
            }
        }

        await this.cancelPendingServiceRecordJobs(scheduleId, "Service record link rescheduled");
        await this.supersedeRetryableServiceRecordSmsLogs(scheduleId, "Service record link rescheduled");

        if (!resolvedRecipientPhone) {
            if (!options.recordMissingPhoneFailure) {
                throw new BadRequestException("제공인력 전화번호가 없습니다");
            }

            this.logger.warn(
                `Schedule ${scheduleId}: provider ${employee.id} has no phone on file; service-record link NOT sent. Set the employee's phone first.`
            );
            await this.recordPermanentFailure({
                branchId: schedule.branchId,
                scheduleId,
                clientId: schedule.clientId,
                clientName: schedule.client?.name ?? "고객",
                employeeId: employee.id,
                employeeName: employee.name,
                receiver: options.recipientPhone ?? employee.phone,
                reason: "제공인력 전화번호 누락",
            });
            return {
                scheduledFor: options.scheduledFor ?? getServiceRecordLinkScheduledFor(schedule.startDate),
                employeeId: employee.id,
                jobEnqueued: false,
                jobId: null,
            };
        }

        let linkToken: string;
        if (options.preparedLinkToken) {
            linkToken = options.preparedLinkToken;
        } else {
            const expiresAt = this.resolveExpiry(
                serviceRecordCase?.endDate ?? schedule.endDate,
                options.allowLateReissue === true,
            );
            const tokenParams = {
                branchId: schedule.branchId,
                scheduleId,
                employeeId: employee.id,
                ...(serviceRecordCase ? { serviceRecordCaseId: serviceRecordCase.id } : {}),
                expectedPhone: resolvedRecipientPhone,
                expiresAt,
            };
            ({ linkToken } = await this.tokenService.reuseActiveLink(tokenParams)
                ?? await this.tokenService.issueLink(tokenParams));
        }

        const url = this.buildServiceRecordUrl(linkToken);
        const clientName = schedule.client?.name ?? "고객";
        const message = `[사회서비스 제공자 품질평가 A등급]
안녕하세요, 인천 아이미래로 입니다 :)

${employee.name} 관리사님, ${clientName} 산모님의 서비스 제공기록지 작성 링크입니다.
매일 서비스 제공 완료 직전에 서비스 세부사항 기록 후에, 산모님께 승인을 받으시면 됩니다.

최초 접속 시에 관리사님의 전화번호 인증이 필요합니다. 링크 접속 후 휴대폰 번호로 본인확인하고, 방문일마다 기록을 남겨주세요.

감사합니다.

제공기록지 링크
${url}`;

        const scheduledFor = options.scheduledFor ?? getServiceRecordLinkScheduledFor(schedule.startDate);
        const persistedJob = await this.jobRepository.upsertPending(
            MessageTriggerJobEntity.create({
                branchId: schedule.branchId,
                ruleId: SERVICE_RECORD_LINK_RULE_ID,
                scheduledFor,
                clientId: schedule.clientId,
                employeeScheduleId: scheduleId,
                recipientType: MessageTriggerRecipientType.PRIMARY_EMPLOYEE,
                recipientPhone: resolvedRecipientPhone,
                templateKey: MessageTriggerTemplateKey.SERVICE_RECORD_LINK,
                dedupeKey: this.buildDedupeKey(scheduleId, options.isManualSend),
                payload: {
                    clientId: schedule.clientId,
                    clientName,
                    employeeId: employee.id,
                    employeeName: employee.name,
                    memberId: `employee:${employee.id}`,
                    recipientName: employee.name,
                    recipientPhone: resolvedRecipientPhone,
                    buttonUrl: url,
                    messageBody: message,
                    templateVariables: {
                        clientName,
                        employeeName: employee.name,
                        serviceRecordUrl: url,
                        serviceStartDate: this.formatDate(schedule.startDate),
                        serviceEndDate: this.formatDate(schedule.endDate),
                    },
                },
            }),
        );

        return {
            scheduledFor,
            employeeId: employee.id,
            jobEnqueued: true,
            jobId: persistedJob.id,
        };
    }

    private async ensureSystemRule(): Promise<void> {
        await this.prisma.message_trigger_rule.upsert({
            where: { id: SERVICE_RECORD_LINK_RULE_ID },
            create: {
                id: SERVICE_RECORD_LINK_RULE_ID,
                branchId: null,
                name: SERVICE_RECORD_LINK_SMS_TITLE,
                isActive: true,
                eventType: MessageTriggerEventType.SERVICE_START,
                offsetType: MessageTriggerOffsetType.SAME_DAY,
                offsetDays: 0,
                recipientType: MessageTriggerRecipientType.PRIMARY_EMPLOYEE,
                templateKey: MessageTriggerTemplateKey.SERVICE_RECORD_LINK,
                isDefault: false,
                jobsStale: false,
            },
            update: {},
        });
    }

    private async recordPermanentFailure(params: {
        branchId: string;
        scheduleId: number;
        clientId: number;
        clientName: string;
        employeeId: number;
        employeeName: string;
        receiver: string;
        reason: string;
    }): Promise<void> {
        const now = new Date();
        await this.logRepository.save(
            MessageLogEntity.reconstitute(
                0,
                params.branchId,
                "aligo_sms",
                SERVICE_RECORD_LINK_SMS_LOG_TEMPLATE_KEY,
                null,
                params.receiver,
                params.clientId,
                `[아가잼잼] ${params.clientName}님 제공기록지 작성 링크 발송 실패`,
                {
                    automationKey: SERVICE_RECORD_LINK_SMS_AUTOMATION_KEY,
                    triggerType: SERVICE_RECORD_LINK_SMS_TRIGGER_TYPE,
                    title: SERVICE_RECORD_LINK_SMS_TITLE,
                    clientName: params.clientName,
                    employeeName: params.employeeName,
                    employeeId: String(params.employeeId),
                    scheduleId: String(params.scheduleId),
                    reason: params.reason,
                    msgType: "AUTO",
                },
                "failed",
                null,
                params.reason,
                1,
                now,
                null,
                now,
                now,
                params.employeeName,
                params.receiver,
            ),
        );
    }

    private formatDate(date: Date): string {
        return date.toISOString().slice(0, 10);
    }

    private buildDedupeKey(scheduleId: number, isManualSend: boolean): string {
        const assignmentKey = `${SERVICE_RECORD_LINK_RULE_ID}:schedule:${scheduleId}:primary`;
        if (!isManualSend) return assignmentKey;

        return `${assignmentKey}:manual:${randomUUID()}`;
    }

    private normalizePhone(phone: string): string {
        return phone.replace(/\D/g, "");
    }

    private resolveRecipientPhone(employeePhone: string, recipientPhone?: string): string | null {
        const candidate = recipientPhone?.trim() || employeePhone;
        const normalized = this.normalizePhone(candidate);
        if (!/^01[016789]\d{7,8}$/.test(normalized)) {
            return null;
        }

        return recipientPhone ? normalized : employeePhone;
    }

    private buildServiceRecordUrl(linkToken: string): string {
        const base = this.configService
            .get<string>("MOBILE_SERVICE_RECORD_BASE_URL", "https://m.admin.babyjamjam.com")
            .replace(/\/+$/, "");
        return `${base}/service-record/${linkToken}`;
    }

    private resolveExpiry(endDate: Date, allowLateReissue: boolean): Date {
        const normalExpiry = getServiceRecordTokenExpiresAt(endDate);
        if (!allowLateReissue || normalExpiry.getTime() >= Date.now()) return normalExpiry;
        return new Date(Date.now() + 24 * 60 * 60 * 1000);
    }
}
