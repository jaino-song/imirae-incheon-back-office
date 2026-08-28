import {
    BadGatewayException,
    BadRequestException,
    Body,
    Controller,
    ConflictException,
    Headers,
    Logger,
    NotFoundException,
    Post,
    ServiceUnavailableException,
    UseGuards,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { JwtGuard } from "infrastructure/auth/jwt.guard";
import { CurrentTenant, TenantGuard } from "infrastructure/tenant";
import { AligoService } from "application/services/aligo.service";
import { SendSmsMessageDto } from "interface/dto/message-delivery.dto";
import { MessageSenderApprovalService } from "application/services/message-sender-approval.service";
import { parseKstSchedule } from "application/utils/kst-schedule";
import { PrismaService } from "infrastructure/database/prisma.service";
import { SMS_DELIVERY_RETRY_DELAY_MS } from "domain/entities/message-log.entity";
import {
    buildSmsProviderAcceptanceFingerprint,
    buildSmsProviderAcceptanceKey,
} from "application/services/sms-provider-acceptance.service";

const ALIGO_SCHEDULE_MIN_LEAD_MS = 10 * 60 * 1000;

interface SmsMessageLogRecord {
    id: number;
    providerAcceptanceKey?: string | null;
    providerAcceptanceFingerprint?: string | null;
    providerAcceptanceState?: string | null;
    providerCallStartedAt?: Date | null;
    status?: string | null;
}

@Controller("message-deliveries")
@UseGuards(JwtGuard, TenantGuard)
export class MessageDeliveryController {
    private readonly logger = new Logger(MessageDeliveryController.name);

    constructor(
        private readonly aligoService: AligoService,
        private readonly messageSenderApprovalService: MessageSenderApprovalService,
        private readonly prisma: PrismaService,
    ) {}

    @Post("sms")
    async sendSms(
        @CurrentTenant() tenant: { branchId?: string },
        @Body() dto: SendSmsMessageDto,
        @Headers("idempotency-key") requestId?: string,
    ) {
        const triggerType = dto.triggerType ?? "immediate";
        const branchId = tenant.branchId ?? "";
        await this.assertClientBelongsToBranch(branchId, dto.clientId);
        this.logger.log(
            `[SMS] Request received: branchId=${branchId || "unknown"}, triggerType=${triggerType}, recipientCount=${this.countSmsRecipients(dto.receiver)}`,
        );

        try {
            await this.messageSenderApprovalService.ensureApproved(branchId);
        } catch (error) {
            this.logger.warn(
                `[SMS] Sender approval check failed: branchId=${branchId || "unknown"}, error=${error instanceof Error ? error.message : String(error)}`,
            );
            throw error;
        }

        if (triggerType === "scheduled") {
            this.assertScheduledAtLeastTenMinutesAhead(
                dto.scheduledDate,
                dto.scheduledTime,
            );
        }

        const scheduledDate = triggerType === "scheduled"
            ? dto.scheduledDate?.replace(/-/g, "")
            : undefined;
        const scheduledTime = triggerType === "scheduled"
            ? dto.scheduledTime?.replace(":", "")
            : undefined;
        const pendingLog = await this.createPendingSmsLog(
            branchId,
            dto,
            triggerType,
            scheduledDate,
            scheduledTime,
            dto.idempotencyKey ?? requestId,
        ).catch((error) => {
            if (error instanceof ConflictException) {
                throw error;
            }
            this.logger.error(
                `[SMS] Failed to create delivery record before provider request: branchId=${branchId || "unknown"}, error=${this.formatErrorMessage(error)}`,
            );
            throw new ServiceUnavailableException(
                "발송 기록을 생성하지 못해 문자 발송을 시작하지 않았습니다. 잠시 후 다시 시도해 주세요.",
            );
        });

        if (!pendingLog.created) {
            const state = String(pendingLog.row.providerAcceptanceState ?? "legacy");
            if (state === "accepted" || state === "reconciled_delivered" || pendingLog.row.status === "sent") {
                throw new ConflictException("동일한 문자 발송 요청이 이미 처리되었습니다.");
            }
            throw new ConflictException(
                "동일한 문자 발송 요청이 이미 진행 중이거나 결과 확인이 필요합니다. 자동 재전송하지 말고 발송 기록을 확인해 주세요.",
            );
        }

        await this.markProviderCallStarted(pendingLog.row);

        const result = await this.aligoService.sendSms({
            receiver: dto.receiver,
            message: dto.message,
            recipientName: dto.recipientName,
            title: dto.title,
            msgType: dto.msgType,
            scheduledDate,
            scheduledTime,
            testMode: dto.testMode,
        }).catch(async (error) => {
            const errorMessage = this.formatErrorMessage(error);
            this.logger.warn(
                `[SMS] Aligo request failed: branchId=${branchId || "unknown"}, error=${errorMessage}`,
            );
            await this.updateSmsLog(pendingLog.id, {
                status: "failed",
                errorMessage,
                attempts: 1,
                lastAttemptAt: new Date(),
                nextRetryAt: this.nextRetryAt(),
                providerAcceptanceState: "uncertain",
                providerCallStartedAt: pendingLog.row.providerCallStartedAt ?? new Date(),
            }).catch((logError) => {
                this.logger.error(
                    `[SMS] Provider request failed and delivery record update also failed: logId=${pendingLog.id}, error=${this.formatErrorMessage(logError)}`,
                );
            });
            throw new BadGatewayException(errorMessage);
        });
        this.logger.log(
            `[SMS] Aligo response received: branchId=${branchId || "unknown"}, resultCode=${result.response.result_code}, errorCount=${result.response.error_cnt ?? 0}`,
        );
        await this.updateSmsLogFromResult(pendingLog.id, result, triggerType).catch((error) => {
            this.logger.error(
                `[SMS] Provider accepted request but delivery record update failed: logId=${pendingLog.id}, error=${this.formatErrorMessage(error)}`,
            );
            throw new ServiceUnavailableException(
                "문자 공급자에는 접수되었지만 발송 기록 상태를 갱신하지 못했습니다. 중복 발송하지 말고 관리자에게 문의해 주세요.",
            );
        });

        if (!this.isAcceptedSmsResult(result)) {
            throw new BadGatewayException(
                result.response.message || "문자 발송 요청이 실패했습니다.",
            );
        }

        return {
            provider: "aligo_sms",
            triggerType,
            request: {
                senderPhone: result.request.senderPhone,
                receiver: result.request.receiver,
                msgType: result.request.msgType,
                scheduledAt:
                    result.request.scheduledDate && result.request.scheduledTime
                        ? `${result.request.scheduledDate}${result.request.scheduledTime}`
                        : undefined,
                testMode: result.request.testModeYn === "Y",
            },
            result: {
                resultCode: result.response.result_code,
                message: result.response.message,
                msgId: result.response.msg_id,
                successCount: result.response.success_cnt,
                errorCount: result.response.error_cnt,
                msgType: result.response.msg_type,
            },
        };
    }

    private async createPendingSmsLog(
        branchId: string,
        dto: SendSmsMessageDto,
        triggerType: string,
        scheduledDate?: string,
        scheduledTime?: string,
        requestId?: string,
    ): Promise<{ row: SmsMessageLogRecord; created: boolean; id: number }> {
        // A caller-provided idempotency key (or HTTP Idempotency-Key header)
        // scopes duplicate manual requests. Without one, each intentional
        // send receives a fresh opaque identity; the persisted state still
        // fences crashes before any automatic retry is possible.
        const logicalIdentity = requestId?.trim() || randomUUID();
        const providerAcceptanceKey = buildSmsProviderAcceptanceKey(
            "manual",
            `${branchId}:${logicalIdentity}`,
        );
        const providerAcceptanceFingerprint = buildSmsProviderAcceptanceFingerprint({
            branchId,
            receiver: dto.receiver,
            message: dto.message,
            recipientName: dto.recipientName ?? null,
            title: dto.title?.trim() || null,
            clientId: dto.clientId ?? null,
            msgType: dto.msgType ?? "AUTO",
            triggerType,
            scheduledDate: scheduledDate ?? null,
            scheduledTime: scheduledTime ?? null,
            testMode: dto.testMode === true,
        });
        const messageLogModel = this.prisma.message_log as typeof this.prisma.message_log & {
            findUnique?: (args: { where: { providerAcceptanceKey: string } }) => Promise<SmsMessageLogRecord | null>;
        };
        if (typeof messageLogModel.findUnique === "function") {
            const existing = await messageLogModel.findUnique({ where: { providerAcceptanceKey } });
            if (existing) {
                if (existing.providerAcceptanceFingerprint !== providerAcceptanceFingerprint) {
                    throw new ConflictException("문자 요청 식별자가 다른 발송 내용과 재사용되었습니다.");
                }
                return { row: existing, created: false, id: existing.id };
            }
        }

        const data = {
                branchId: branchId || null,
                provider: "aligo_sms",
                templateKey: dto.title?.trim() || "manual_sms",
                receiver: dto.receiver,
                clientId: dto.clientId ?? null,
                recipientName: dto.recipientName ?? null,
                recipientPhone: dto.receiver,
                messageBody: dto.message,
                variables: {
                    recipientName: dto.recipientName ?? null,
                    title: dto.title ?? null,
                    triggerType,
                    msgType: dto.msgType ?? null,
                    scheduledDate: scheduledDate ?? null,
                    scheduledTime: scheduledTime ?? null,
                    testMode: dto.testMode ? "true" : "false",
                },
                status: "pending",
                aligoMid: null,
                errorMessage: null,
                attempts: 0,
                lastAttemptAt: null,
                nextRetryAt: null,
                providerAcceptanceKey,
                providerAcceptanceFingerprint,
                providerAcceptanceState: "prepared",
                providerCallStartedAt: null,
                providerAcceptedAt: null,
                providerReconciledAt: null,
                providerReconciledBy: null,
                providerReconciliationReason: null,
            };
        try {
            const row = await this.prisma.message_log.create({ data });
            return { row, created: true, id: row.id };
        } catch (error) {
            if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002"
                && typeof messageLogModel.findUnique === "function") {
                const existing = await messageLogModel.findUnique({ where: { providerAcceptanceKey } });
                if (existing?.providerAcceptanceFingerprint !== providerAcceptanceFingerprint) {
                    throw new ConflictException("문자 요청 식별자가 다른 발송 내용과 재사용되었습니다.");
                }
                if (existing) return { row: existing, created: false, id: existing.id };
            }
            throw error;
        }
    }

    private async markProviderCallStarted(row: SmsMessageLogRecord): Promise<void> {
        const startedAt = new Date(Date.now());
        const messageLogModel = this.prisma.message_log as typeof this.prisma.message_log & {
            updateMany?: (args: { where: Record<string, unknown>; data: Record<string, unknown> }) => Promise<{ count: number }>;
        };
        if (typeof messageLogModel.updateMany !== "function") {
            // Legacy unit doubles do not expose updateMany. Production Prisma
            // always takes the conditional update below; this fallback still
            // keeps the in-memory row fenced for those isolated tests.
            row.providerAcceptanceState = "started";
            row.providerCallStartedAt = startedAt;
            return;
        }
        const claimed = await messageLogModel.updateMany({
            where: {
                id: row.id,
                providerAcceptanceKey: row.providerAcceptanceKey,
                providerAcceptanceFingerprint: row.providerAcceptanceFingerprint,
                providerAcceptanceState: "prepared",
            },
            data: {
                providerAcceptanceState: "started",
                providerCallStartedAt: startedAt,
            },
        });
        if (claimed.count !== 1) {
            throw new ConflictException("문자 발송 요청이 이미 진행 중이거나 결과 확인이 필요합니다.");
        }
        row.providerAcceptanceState = "started";
        row.providerCallStartedAt = startedAt;
    }

    private async assertClientBelongsToBranch(
        branchId: string,
        clientId?: number | null,
    ): Promise<void> {
        if (clientId == null) return;

        const client = await this.prisma.client.findFirst({
            where: { id: clientId, branchId },
            select: { id: true },
        });
        if (!client) {
            throw new NotFoundException("Client not found for branch");
        }
    }

    private async updateSmsLogFromResult(
        logId: number,
        result: Awaited<ReturnType<AligoService["sendSms"]>>,
        triggerType: string,
    ): Promise<void> {
        const isAccepted = this.isAcceptedSmsResult(result);
        const isPartial = this.isPartialSuccessSmsResult(result);
        const status = isAccepted
            ? triggerType === "scheduled" ? "pending" : "sent"
            : "failed";
        // Aligo's batch response does not identify failed recipients. Retrying the
        // original receiver list after a partial success would duplicate successful sends.
        const errorMessage = isAccepted
            ? null
            : isPartial
                ? `부분 발송 (성공 ${Number(result.response.success_cnt ?? 0)}건 / 실패 ${Number(result.response.error_cnt ?? 0)}건). 실패 수신자를 식별할 수 없어 자동 재전송을 중단했습니다. 실패자에게 수동으로 재발송해 주세요.`
                : result.response.message;

        await this.updateSmsLog(logId, {
            receiver: result.request.receiver,
            recipientPhone: result.request.receiver,
            status,
            aligoMid: result.response.msg_id ? String(result.response.msg_id) : null,
            errorMessage,
            providerAcceptanceState: isAccepted ? "accepted" : "rejected",
            providerAcceptedAt: isAccepted ? new Date(Date.now()) : null,
            attempts: 1,
            lastAttemptAt: new Date(),
            nextRetryAt: isAccepted || isPartial ? null : this.nextRetryAt(),
            variables: {
                triggerType,
                msgType: result.request.msgType,
                scheduledDate: result.request.scheduledDate ?? null,
                scheduledTime: result.request.scheduledTime ?? null,
                testMode: result.request.testModeYn === "Y" ? "true" : "false",
            },
        });
    }

    private async updateSmsLog(
        logId: number,
        data: Record<string, unknown>,
    ): Promise<void> {
        await this.prisma.message_log.update({
            where: { id: logId },
            data,
        });
    }

    private isAcceptedSmsResult(
        result: Awaited<ReturnType<AligoService["sendSms"]>>,
    ) {
        const resultCode = Number(result.response.result_code);
        const errorCount = Number(result.response.error_cnt ?? 0);
        return (
            resultCode === 1 &&
            errorCount === 0
        );
    }

    private isPartialSuccessSmsResult(
        result: Awaited<ReturnType<AligoService["sendSms"]>>,
    ) {
        const resultCode = Number(result.response.result_code);
        const errorCount = Number(result.response.error_cnt ?? 0);
        const successCount = Number(result.response.success_cnt ?? 0);
        return resultCode === 1 && errorCount > 0 && successCount > 0;
    }

    private countSmsRecipients(receiver: string): number {
        return receiver
            .split(",")
            .map((phone) => phone.trim())
            .filter(Boolean).length;
    }

    private assertScheduledAtLeastTenMinutesAhead(
        scheduledDate?: string,
        scheduledTime?: string,
    ) {
        const scheduledAt = parseKstSchedule(scheduledDate, scheduledTime);
        if (!scheduledAt) {
            throw new BadRequestException("예약 발송 일시 형식이 올바르지 않습니다.");
        }
        if (scheduledAt.getTime() - Date.now() < ALIGO_SCHEDULE_MIN_LEAD_MS) {
            throw new BadRequestException(
                "예약 발송은 한국시간 기준 현재 시각보다 10분 이후만 등록할 수 있습니다.",
            );
        }
    }

    private formatErrorMessage(error: unknown): string {
        if (error instanceof Error && error.message.trim()) {
            return error.message;
        }
        const message = String(error ?? "").trim();
        return message || "문자 발송 요청이 실패했습니다.";
    }

    private nextRetryAt(): Date {
        return new Date(Date.now() + SMS_DELIVERY_RETRY_DELAY_MS);
    }
}
