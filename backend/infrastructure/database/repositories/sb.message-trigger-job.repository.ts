import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "infrastructure/database/prisma.service";
import { IMessageTriggerJobRepository } from "domain/repositories/message-trigger-job.repository.interface";
import {
    MessageTriggerJobEntity,
    MessageTriggerJobPayload,
    MessageTriggerJobStatus,
} from "domain/entities/message-trigger-job.entity";
import {
    MessageTriggerRecipientType,
    MessageTriggerTemplateKey,
} from "domain/constants/message-trigger-catalog";

type MessageTriggerJobPrismaRow = {
    id: string;
    branchId: string | null;
    ruleId: string;
    status: string;
    scheduledFor: Date;
    attempts: number;
    nextAttemptAt: Date | null;
    sentAt: Date | null;
    canceledAt: Date | null;
    cancelReason: string | null;
    clientId: number | null;
    employeeScheduleId: number | null;
    recipientType: string;
    recipientPhone: string | null;
    templateKey: string;
    dedupeKey: string;
    payload: Prisma.JsonValue;
    createdAt: Date;
    updatedAt: Date;
};

type MessageTriggerJobRawRow = {
    id: string;
    branch_id: string | null;
    rule_id: string;
    status: string;
    scheduled_for: Date | string;
    attempts: number;
    next_attempt_at: Date | string | null;
    sent_at: Date | string | null;
    canceled_at: Date | string | null;
    cancel_reason: string | null;
    client_id: number | null;
    employee_schedule_id: number | null;
    recipient_type: string;
    recipient_phone: string | null;
    template_key: string;
    dedupe_key: string;
    payload: Prisma.JsonValue | string;
    created_at: Date | string;
    updated_at: Date | string;
};

@Injectable()
export class SbMessageTriggerJobRepository implements IMessageTriggerJobRepository {
    constructor(private readonly prisma: PrismaService) {}

    async create(job: MessageTriggerJobEntity): Promise<MessageTriggerJobEntity> {
        const row = await this.prisma.message_trigger_job.create({
            data: this.toCreate(job),
        });
        return this.toDomain(row);
    }

    async update(job: MessageTriggerJobEntity): Promise<MessageTriggerJobEntity> {
        const row = await this.prisma.message_trigger_job.update({
            where: { id: job.id },
            data: this.toUpdate(job),
        });
        return this.toDomain(row);
    }

    async findById(id: string): Promise<MessageTriggerJobEntity | null> {
        const row = await this.prisma.message_trigger_job.findUnique({ where: { id } });
        return row ? this.toDomain(row) : null;
    }

    async claimPending(id: string): Promise<boolean> {
        const result = await this.prisma.message_trigger_job.updateMany({
            where: { id, status: "pending" },
            data: { status: "processing" },
        });
        return result.count === 1;
    }

    async findDuePending(limit = 100): Promise<MessageTriggerJobEntity[]> {
        const now = new Date();
        const rows = await this.prisma.message_trigger_job.findMany({
            where: {
                status: "pending",
                scheduledFor: { lte: now },
                OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }],
            },
            orderBy: [
                { scheduledFor: "asc" },
                { createdAt: "asc" },
            ],
            take: limit,
        });
        return rows.map((row) => this.toDomain(row));
    }

    async findStaleProcessing(cutoff: Date, limit = 50): Promise<MessageTriggerJobEntity[]> {
        const rows = await this.prisma.message_trigger_job.findMany({
            where: {
                status: "processing",
                updatedAt: { lt: cutoff },
            },
            orderBy: { updatedAt: "asc" },
            take: limit,
        });
        return rows.map((row) => this.toDomain(row));
    }

    async findUpcomingPendingByBranch(
        branchId: string,
        limit = 200,
    ): Promise<MessageTriggerJobEntity[]> {
        const rows = await this.prisma.message_trigger_job.findMany({
            where: {
                branchId,
                status: { in: ["pending", "processing"] },
            },
            orderBy: { scheduledFor: "asc" },
            take: limit,
        });
        return rows.map((row) => this.toDomain(row));
    }

    async findTerminalByBranch(
        branchId: string,
        limit = 200,
    ): Promise<MessageTriggerJobEntity[]> {
        const rows = await this.prisma.message_trigger_job.findMany({
            where: {
                branchId,
                status: { in: ["failed", "canceled"] },
            },
            orderBy: { updatedAt: "desc" },
            take: limit,
        });
        return rows.map((row) => this.toDomain(row));
    }

    async findHistoryByBranch(
        branchId: string,
        limit = 50,
        beforeId?: string,
    ): Promise<MessageTriggerJobEntity[]> {
        const rows = await this.prisma.message_trigger_job.findMany({
            where: { branchId },
            orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
            take: limit,
            ...(beforeId ? { cursor: { id: beforeId }, skip: 1 } : {}),
        });
        return rows.map((row) => this.toDomain(row));
    }

    async findPendingByRuleId(ruleId: string): Promise<MessageTriggerJobEntity[]> {
        const rows = await this.prisma.message_trigger_job.findMany({
            where: { ruleId, status: "pending" },
        });
        return rows.map((row) => this.toDomain(row));
    }

    async findPendingByRuleIdsAndClientId(
        ruleIds: string[],
        clientId: number,
    ): Promise<MessageTriggerJobEntity[]> {
        if (ruleIds.length === 0) return [];
        const rows = await this.prisma.message_trigger_job.findMany({
            where: {
                ruleId: { in: ruleIds },
                clientId,
                status: "pending",
            },
        });
        return rows.map((row) => this.toDomain(row));
    }

    async findPendingByRuleIdsAndEmployeeScheduleId(
        ruleIds: string[],
        employeeScheduleId: number,
    ): Promise<MessageTriggerJobEntity[]> {
        if (ruleIds.length === 0) return [];
        const rows = await this.prisma.message_trigger_job.findMany({
            where: {
                ruleId: { in: ruleIds },
                employeeScheduleId,
                status: "pending",
            },
        });
        return rows.map((row) => this.toDomain(row));
    }

    async findSentByRuleIdAndEmployeeScheduleId(
        ruleId: string,
        employeeScheduleId: number,
    ): Promise<MessageTriggerJobEntity[]> {
        const rows = await this.prisma.message_trigger_job.findMany({
            where: {
                ruleId,
                employeeScheduleId,
                status: "sent",
            },
        });
        return rows.map((row) => this.toDomain(row));
    }

    async cancelPendingByClientContext(
        branchId: string,
        clientId: number,
        reason: string,
    ): Promise<number> {
        const result = await this.prisma.message_trigger_job.updateMany({
            where: {
                branchId,
                status: "pending",
                OR: [
                    { clientId },
                    { employeeSchedule: { is: { clientId } } },
                ],
            },
            data: {
                status: "canceled",
                canceledAt: new Date(),
                cancelReason: reason,
            },
        });
        return result.count;
    }

    async cancelOrphanedPending(reason: string, branchId?: string): Promise<number> {
        const result = await this.prisma.message_trigger_job.updateMany({
            where: {
                ...(branchId ? { branchId } : {}),
                status: "pending",
                clientId: null,
                employeeScheduleId: null,
            },
            data: {
                status: "canceled",
                canceledAt: new Date(),
                cancelReason: reason,
            },
        });
        return result.count;
    }

    async findRecoverableOrphanedClientJobs(
        branchId: string,
        limit = 200,
    ): Promise<MessageTriggerJobEntity[]> {
        const rows = await this.prisma.message_trigger_job.findMany({
            where: {
                branchId,
                clientId: null,
                employeeScheduleId: null,
                recipientType: MessageTriggerRecipientType.CLIENT,
                OR: [
                    { status: "pending" },
                    {
                        status: "canceled",
                        cancelReason: {
                            in: ["Client deleted", "Related client or schedule deleted"],
                        },
                    },
                ],
            },
            orderBy: { createdAt: "asc" },
            take: limit,
        });
        return rows.map((row) => this.toDomain(row));
    }

    async markOrphanedJobsReconciled(
        jobIds: string[],
        replacementClientId: number,
    ): Promise<number> {
        if (jobIds.length === 0) return 0;

        const result = await this.prisma.message_trigger_job.updateMany({
            where: {
                id: { in: jobIds },
                status: "canceled",
                clientId: null,
                employeeScheduleId: null,
            },
            data: {
                cancelReason: `Reconciled to replacement client:${replacementClientId}`,
            },
        });
        return result.count;
    }

    async cancelPendingByRuleId(ruleId: string, reason: string): Promise<number> {
        const result = await this.prisma.message_trigger_job.updateMany({
            where: { ruleId, status: "pending" },
            data: {
                status: "canceled",
                canceledAt: new Date(),
                cancelReason: reason,
            },
        });
        return result.count;
    }

    async cancelPendingOlderThan(ruleId: string, cutoff: Date, reason: string): Promise<number> {
        const result = await this.prisma.message_trigger_job.updateMany({
            where: {
                ruleId,
                status: "pending",
                scheduledFor: { lt: cutoff },
            },
            data: {
                status: "canceled",
                canceledAt: new Date(),
                cancelReason: reason,
            },
        });
        return result.count;
    }

    async upsertPending(job: MessageTriggerJobEntity): Promise<MessageTriggerJobEntity> {
        const rows = await this.prisma.$queryRaw<MessageTriggerJobRawRow[]>(Prisma.sql`
            INSERT INTO "message_trigger_job" (
                branch_id,
                rule_id,
                status,
                scheduled_for,
                sent_at,
                canceled_at,
                cancel_reason,
                client_id,
                employee_schedule_id,
                recipient_type,
                recipient_phone,
                template_key,
                dedupe_key,
                payload,
                attempts,
                next_attempt_at,
                updated_at
            )
            VALUES (
                ${job.branchId}::uuid,
                ${job.ruleId},
                'pending',
                ${job.scheduledFor},
                NULL,
                NULL,
                NULL,
                ${job.clientId},
                ${job.employeeScheduleId},
                ${job.recipientType},
                ${job.recipientPhone},
                ${job.templateKey},
                ${job.dedupeKey},
                ${JSON.stringify(job.payload)}::jsonb,
                0,
                NULL,
                now()
            )
            ON CONFLICT ("dedupe_key") DO UPDATE SET
                status = 'pending',
                scheduled_for = EXCLUDED.scheduled_for,
                sent_at = NULL,
                canceled_at = NULL,
                cancel_reason = NULL,
                recipient_type = EXCLUDED.recipient_type,
                recipient_phone = EXCLUDED.recipient_phone,
                template_key = EXCLUDED.template_key,
                payload = EXCLUDED.payload,
                attempts = 0,
                next_attempt_at = NULL,
                updated_at = now()
            WHERE "message_trigger_job"."status" NOT IN ('sent', 'processing')
            RETURNING *;
        `);

        const [row] = rows;
        if (row) {
            return this.rawRowToDomain(row);
        }

        const existing = await this.prisma.message_trigger_job.findUnique({
            where: { dedupeKey: job.dedupeKey },
        });
        if (!existing) {
            throw new Error(`Message trigger job upsert returned no row: ${job.dedupeKey}`);
        }

        return this.toDomain(existing);
    }

    private toCreate(job: MessageTriggerJobEntity) {
        return {
            branchId: job.branchId,
            ruleId: job.ruleId,
            status: job.status,
            scheduledFor: job.scheduledFor,
            sentAt: job.sentAt,
            canceledAt: job.canceledAt,
            cancelReason: job.cancelReason,
            clientId: job.clientId,
            employeeScheduleId: job.employeeScheduleId,
            recipientType: job.recipientType,
            recipientPhone: job.recipientPhone,
            templateKey: job.templateKey,
            dedupeKey: job.dedupeKey,
            payload: job.payload as unknown as Prisma.InputJsonValue,
            attempts: job.attempts,
            nextAttemptAt: job.nextAttemptAt,
        };
    }

    private toUpdate(job: MessageTriggerJobEntity) {
        return {
            status: job.status,
            scheduledFor: job.scheduledFor,
            sentAt: job.sentAt,
            canceledAt: job.canceledAt,
            cancelReason: job.cancelReason,
            recipientType: job.recipientType,
            recipientPhone: job.recipientPhone,
            templateKey: job.templateKey,
            payload: job.payload as unknown as Prisma.InputJsonValue,
            attempts: job.attempts,
            nextAttemptAt: job.nextAttemptAt,
        };
    }

    private toDomain(row: MessageTriggerJobPrismaRow): MessageTriggerJobEntity {
        return MessageTriggerJobEntity.reconstitute(
            row.id,
            row.branchId,
            row.ruleId,
            row.status as MessageTriggerJobStatus,
            row.scheduledFor,
            row.sentAt,
            row.canceledAt,
            row.cancelReason,
            row.clientId,
            row.employeeScheduleId,
            row.recipientType as MessageTriggerRecipientType,
            row.recipientPhone,
            row.templateKey as MessageTriggerTemplateKey,
            row.dedupeKey,
            ((row.payload as unknown as MessageTriggerJobPayload) ?? {
                memberId: "",
                recipientName: "",
                recipientPhone: "",
                templateVariables: {},
            }),
            row.createdAt,
            row.updatedAt,
            row.attempts,
            row.nextAttemptAt,
        );
    }

    private rawRowToDomain(row: MessageTriggerJobRawRow): MessageTriggerJobEntity {
        return MessageTriggerJobEntity.reconstitute(
            row.id,
            row.branch_id,
            row.rule_id,
            row.status as MessageTriggerJobStatus,
            this.toDate(row.scheduled_for),
            this.toNullableDate(row.sent_at),
            this.toNullableDate(row.canceled_at),
            row.cancel_reason,
            row.client_id,
            row.employee_schedule_id,
            row.recipient_type as MessageTriggerRecipientType,
            row.recipient_phone,
            row.template_key as MessageTriggerTemplateKey,
            row.dedupe_key,
            this.toPayload(row.payload),
            this.toDate(row.created_at),
            this.toDate(row.updated_at),
            row.attempts,
            this.toNullableDate(row.next_attempt_at),
        );
    }

    private toDate(value: Date | string): Date {
        return value instanceof Date ? value : new Date(value);
    }

    private toNullableDate(value: Date | string | null): Date | null {
        return value ? this.toDate(value) : null;
    }

    private toPayload(value: Prisma.JsonValue | string): MessageTriggerJobPayload {
        if (typeof value === "string") {
            return JSON.parse(value) as MessageTriggerJobPayload;
        }

        return (value as unknown as MessageTriggerJobPayload) ?? {
            memberId: "",
            recipientName: "",
            recipientPhone: "",
            templateVariables: {},
        };
    }
}
