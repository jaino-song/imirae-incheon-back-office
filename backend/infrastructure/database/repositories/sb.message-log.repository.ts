import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";

import { IMessageLogRepository } from "domain/repositories/message-log.repository.interface";
import { MessageLogEntity } from "domain/entities/message-log.entity";
import { MessageLogMapper } from "infrastructure/database/mapper/message-log.mapper";
import { PrismaService } from "infrastructure/database/prisma.service";
import {
    SERVICE_RECORD_LINK_RULE_ID,
    SERVICE_RECORD_LINK_SMS_LOG_TEMPLATE_KEY,
} from "domain/constants/service-record-link-message";

@Injectable()
export class SbMessageLogRepository implements IMessageLogRepository {
    constructor(private readonly prisma: PrismaService) {}

    async save(log: MessageLogEntity): Promise<MessageLogEntity> {
        const row = await this.prisma.message_log.create({
            data: MessageLogMapper.toPrismaCreate(log),
        });
        return MessageLogMapper.toDomain(row);
    }

    async update(log: MessageLogEntity): Promise<MessageLogEntity> {
        const row = await this.prisma.message_log.update({
            where: { id: log.id },
            data: MessageLogMapper.toPrismaUpdate(log),
        });
        return MessageLogMapper.toDomain(row);
    }

    async prepareProviderAttempt(log: MessageLogEntity): Promise<MessageLogEntity> {
        if (!log.providerAcceptanceKey || !log.providerAcceptanceFingerprint) {
            throw new Error("SMS provider acceptance key and fingerprint are required before dispatch");
        }

        try {
            return await this.prisma.$transaction(async (transaction) => {
                const existing = await transaction.message_log.findUnique({
                    where: { providerAcceptanceKey: log.providerAcceptanceKey! },
                });
                if (existing) {
                    if (existing.providerAcceptanceFingerprint !== log.providerAcceptanceFingerprint) {
                        throw new Error("SMS provider acceptance fingerprint mismatch");
                    }
                    return MessageLogMapper.toDomain(existing);
                }

                const row = await transaction.message_log.create({
                    data: MessageLogMapper.toPrismaCreate(log),
                });
                return MessageLogMapper.toDomain(row);
            });
        } catch (error) {
            // A concurrent request may win the unique-key race after the
            // transaction's read. Re-read that one key and converge on it.
            if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
                const existing = await this.prisma.message_log.findUnique({
                    where: { providerAcceptanceKey: log.providerAcceptanceKey },
                });
                if (existing?.providerAcceptanceFingerprint !== log.providerAcceptanceFingerprint) {
                    throw new Error("SMS provider acceptance fingerprint mismatch");
                }
                if (existing) return MessageLogMapper.toDomain(existing);
            }
            throw error;
        }
    }

    async claimProviderAttempt(log: MessageLogEntity): Promise<MessageLogEntity | null> {
        if (!log.providerAcceptanceKey || !log.providerAcceptanceFingerprint) {
            throw new Error("SMS provider acceptance key and fingerprint are required before dispatch");
        }

        const claimed = await this.prisma.message_log.updateMany({
            where: {
                id: log.id,
                providerAcceptanceKey: log.providerAcceptanceKey,
                providerAcceptanceFingerprint: log.providerAcceptanceFingerprint,
                providerAcceptanceState: "prepared",
            },
            data: {
                providerAcceptanceState: "started",
                providerCallStartedAt: new Date(Date.now()),
            },
        });
        if (claimed.count !== 1) return null;

        const row = await this.prisma.message_log.findUnique({
            where: { id: log.id },
        });
        return row ? MessageLogMapper.toDomain(row) : null;
    }

    async reconcileProviderAttempt(
        log: MessageLogEntity,
        outcome: "delivered" | "not-delivered",
        actor: string,
        reason: string,
        providerMessageId?: string | null,
    ): Promise<MessageLogEntity | null> {
        return this.prisma.$transaction(async (transaction) => {
            const current = await transaction.message_log.findUnique({
                where: { id: log.id },
            });
            if (!current) return null;

            const currentEntity = MessageLogMapper.toDomain(current);
            if (
                currentEntity.providerAcceptanceState !== "started"
                && currentEntity.providerAcceptanceState !== "uncertain"
            ) {
                return null;
            }

            const expectedState = currentEntity.providerAcceptanceState;
            const expectedUpdatedAt = currentEntity.updatedAt;
            currentEntity.reconcileProviderOutcome({
                outcome,
                actor,
                reason,
                providerMessageId,
            });
            const claimed = await transaction.message_log.updateMany({
                where: {
                    id: log.id,
                    providerAcceptanceState: expectedState,
                    updatedAt: expectedUpdatedAt,
                },
                data: MessageLogMapper.toPrismaUpdate(currentEntity),
            });
            if (claimed.count !== 1) return null;

            const updated = await transaction.message_log.findUnique({
                where: { id: log.id },
            });
            return updated ? MessageLogMapper.toDomain(updated) : null;
        });
    }

    async startRetryAttempt(
        sourceLog: MessageLogEntity,
        retryLog: MessageLogEntity,
    ): Promise<MessageLogEntity | null> {
        return this.prisma.$transaction(async (transaction) => {
            const claimedAt = new Date(Date.now());
            const claimed = await transaction.message_log.updateMany({
                where: {
                    id: sourceLog.id,
                    branchId: sourceLog.branchId,
                    status: sourceLog.status,
                    nextRetryAt: sourceLog.nextRetryAt,
                    updatedAt: sourceLog.updatedAt,
                },
                data: {
                    nextRetryAt: null,
                    updatedAt: claimedAt,
                },
            });

            if (claimed.count !== 1) {
                return null;
            }

            const row = await transaction.message_log.create({
                data: MessageLogMapper.toPrismaCreate(retryLog),
            });
            return MessageLogMapper.toDomain(row);
        });
    }

    async findByIdInBranch(branchId: string, id: number): Promise<MessageLogEntity | null> {
        const row = await this.prisma.message_log.findFirst({
            where: { id, branchId },
        });
        return row ? MessageLogMapper.toDomain(row) : null;
    }

    async findSentTriggerJobIds(jobIds: string[]): Promise<Set<string>> {
        if (jobIds.length === 0) {
            return new Set<string>();
        }

        const rows = await this.prisma.message_log.findMany({
            where: {
                triggerJobId: { in: jobIds },
                status: "sent",
            },
            select: { triggerJobId: true },
        });

        return new Set(
            rows
                .map((row) => row.triggerJobId)
                .filter((triggerJobId): triggerJobId is string => Boolean(triggerJobId)),
        );
    }

    async findUncertainTriggerJobIds(jobIds: string[]): Promise<Set<string>> {
        if (jobIds.length === 0) return new Set<string>();

        const rows = await this.prisma.message_log.findMany({
            where: {
                triggerJobId: { in: jobIds },
                providerAcceptanceState: { in: ["started", "uncertain"] },
            },
            select: { triggerJobId: true },
        });

        return new Set(
            rows
                .map((row) => row.triggerJobId)
                .filter((triggerJobId): triggerJobId is string => Boolean(triggerJobId)),
        );
    }

    async findPendingRetries(): Promise<MessageLogEntity[]> {
        const rows = await this.prisma.message_log.findMany({
            where: {
                status: { in: ["pending", "failed"] },
                nextRetryAt: { lte: new Date() },
            },
            orderBy: { nextRetryAt: "asc" },
            take: 50,
        });
        return rows.map(MessageLogMapper.toDomain);
    }

    async findRetryableServiceRecordSmsByScheduleId(scheduleId: number): Promise<MessageLogEntity[]> {
        const jobs = await this.prisma.message_trigger_job.findMany({
            where: {
                employeeScheduleId: scheduleId,
                ruleId: SERVICE_RECORD_LINK_RULE_ID,
            },
            select: { id: true },
        });
        const triggerJobIds = jobs.map((job) => job.id);

        const rows = await this.prisma.message_log.findMany({
            where: {
                provider: "aligo_sms",
                templateKey: SERVICE_RECORD_LINK_SMS_LOG_TEMPLATE_KEY,
                status: { in: ["pending", "failed"] },
                nextRetryAt: { not: null },
                OR: [
                    ...(triggerJobIds.length > 0 ? [{ triggerJobId: { in: triggerJobIds } }] : []),
                    { variables: { path: ["scheduleId"], equals: String(scheduleId) } },
                ],
            },
            orderBy: { createdAt: "desc" },
        });
        return rows.map(MessageLogMapper.toDomain);
    }

    async findRecentByBranch(
        branchId: string,
        limit = 200,
        skip = 0,
    ): Promise<MessageLogEntity[]> {
        const rows = await this.prisma.message_log.findMany({
            where: { branchId },
            orderBy: { createdAt: "desc" },
            take: limit,
            skip,
        });
        return rows.map(MessageLogMapper.toDomain);
    }
}
