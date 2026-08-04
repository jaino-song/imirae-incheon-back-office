import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { createHash } from "node:crypto";
import { PrismaService } from "infrastructure/database/prisma.service";
import {
    IMessageTriggerJobRepository,
    MessageTriggerJobCancellationScope,
} from "domain/repositories/message-trigger-job.repository.interface";
import {
    MessageTriggerJobEntity,
    MessageTriggerJobPayload,
    MessageTriggerJobStatus,
} from "domain/entities/message-trigger-job.entity";
import {
    AGENT_SMS_RULE_ID_PREFIX,
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

function stableJson(value: unknown): string {
    if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
    if (value && typeof value === "object") {
        return `{${Object.entries(value as Record<string, unknown>)
            .sort(([left], [right]) => left.localeCompare(right))
            .map(([key, nested]) => `${JSON.stringify(key)}:${stableJson(nested)}`)
            .join(",")}}`;
    }
    return JSON.stringify(value) ?? "null";
}

function sameRetrySource(current: MessageTriggerJobEntity, expected: MessageTriggerJobEntity): boolean {
    return current.id === expected.id
        && current.branchId === expected.branchId
        && current.ruleId === expected.ruleId
        && current.status === expected.status
        && current.scheduledFor.getTime() === expected.scheduledFor.getTime()
        && (current.sentAt?.getTime() ?? null) === (expected.sentAt?.getTime() ?? null)
        && (current.canceledAt?.getTime() ?? null) === (expected.canceledAt?.getTime() ?? null)
        && current.cancelReason === expected.cancelReason
        && current.clientId === expected.clientId
        && current.employeeScheduleId === expected.employeeScheduleId
        && current.recipientType === expected.recipientType
        && current.recipientPhone === expected.recipientPhone
        && current.templateKey === expected.templateKey
        && current.dedupeKey === expected.dedupeKey
        && stableJson(current.payload) === stableJson(expected.payload)
        && current.attempts === expected.attempts
        && (current.nextAttemptAt?.getTime() ?? null) === (expected.nextAttemptAt?.getTime() ?? null)
        && current.createdAt.getTime() === expected.createdAt.getTime()
        && current.updatedAt.getTime() === expected.updatedAt.getTime();
}

function jobTargetVersion(job: MessageTriggerJobEntity, snapshotHash: string): string {
    return createHash("sha256").update(JSON.stringify({
        id: job.id,
        branchId: job.branchId,
        ruleId: job.ruleId,
        status: job.status,
        scheduledFor: job.scheduledFor.toISOString(),
        sentAt: job.sentAt?.toISOString() ?? null,
        canceledAt: job.canceledAt?.toISOString() ?? null,
        cancelReason: job.cancelReason,
        clientId: job.clientId,
        employeeScheduleId: job.employeeScheduleId,
        recipientType: job.recipientType,
        recipientPhone: job.recipientPhone,
        templateKey: job.templateKey,
        payload: job.payload,
        attempts: job.attempts,
        nextAttemptAt: job.nextAttemptAt?.toISOString() ?? null,
        createdAt: job.createdAt.toISOString(),
        updatedAt: job.updatedAt.toISOString(),
        deliverySnapshotHash: snapshotHash,
    })).digest("hex");
}

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

    async claimPendingWithRuleFence(id: string, branchId: string | null): Promise<boolean> {
        const branchPredicate = branchId === null
            ? Prisma.sql`branch_id IS NULL`
            : Prisma.sql`branch_id = ${branchId}::uuid`;

        return this.prisma.$transaction(async (transaction) => {
            // This read intentionally does not lock the job. Every lock that
            // can win this race is acquired in rule-then-job order below.
            const jobs = await transaction.$queryRaw<Array<{ rule_id: string; branch_id: string | null }>>(Prisma.sql`
                SELECT rule_id, branch_id
                FROM "message_trigger_job"
                WHERE id = ${id}
                  AND status = 'pending'
            `);
            const job = jobs[0];
            if (!job || job.branch_id !== branchId) return false;

            const rules = await transaction.$queryRaw<Array<{ id: string; jobs_stale: boolean }>>(Prisma.sql`
                SELECT id, jobs_stale
                FROM "message_trigger_rule"
                WHERE id = ${job.rule_id}
                  AND ${branchPredicate}
                FOR UPDATE
            `);
            const rule = rules[0];
            if (!rule || rule.jobs_stale) return false;

            const claimed = await transaction.$queryRaw<Array<{ id: string }>>(Prisma.sql`
                UPDATE "message_trigger_job"
                SET status = 'processing', updated_at = now()
                WHERE id = ${id}
                  AND rule_id = ${job.rule_id}
                  AND ${branchPredicate}
                  AND status = 'pending'
                RETURNING id
            `);
            return claimed.length === 1;
        });
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

    async hasActiveJobsBefore(branchId: string, ruleId: string, before: Date): Promise<boolean> {
        const row = await this.prisma.message_trigger_job.findFirst({
            where: {
                branchId,
                ruleId,
                status: { in: ["pending", "processing"] },
                // A stale rebuild may reactivate the same dedupe row. Its
                // immutable createdAt belongs to the obsolete generation, so
                // the mutable DB-updated timestamp is the generation fence.
                updatedAt: { lt: before },
            },
            select: { id: true },
        });
        return row !== null;
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
                NOT: { ruleId: { startsWith: AGENT_SMS_RULE_ID_PREFIX } },
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

    async cancelPendingForRuleGeneration(
        branchId: string,
        ruleId: string,
        expectedUpdatedAt: Date,
        expectedJobsStale: boolean,
        reason: string,
        scope: MessageTriggerJobCancellationScope = {},
    ): Promise<number | null> {
        return this.prisma.$transaction(async (transaction) => {
            // Generation-aware cancellation uses the same rule-then-job lock
            // order as the producer and dispatcher fences.
            const rules = await transaction.$queryRaw<Array<{
                id: string;
                branch_id: string | null;
                jobs_stale: boolean;
                updated_at: Date | string;
            }>>(Prisma.sql`
                SELECT id, branch_id, jobs_stale, updated_at
                FROM "message_trigger_rule"
                WHERE id = ${ruleId}
                  AND branch_id = ${branchId}::uuid
                FOR UPDATE
            `);
            const rule = rules[0];
            if (!rule || rule.branch_id !== branchId || rule.jobs_stale !== expectedJobsStale) {
                return null;
            }

            const updatedAt = rule.updated_at instanceof Date
                ? rule.updated_at
                : new Date(rule.updated_at);
            if (updatedAt.getTime() !== expectedUpdatedAt.getTime()) {
                return null;
            }

            const predicates = [
                Prisma.sql`branch_id = ${branchId}::uuid`,
                Prisma.sql`rule_id = ${ruleId}`,
                Prisma.sql`status = 'pending'`,
            ];
            if (scope.clientId !== undefined) {
                predicates.push(Prisma.sql`client_id = ${scope.clientId}`);
            }
            if (scope.employeeScheduleId !== undefined) {
                predicates.push(Prisma.sql`employee_schedule_id = ${scope.employeeScheduleId}`);
            }
            if (scope.scheduledBefore !== undefined) {
                predicates.push(Prisma.sql`scheduled_for < ${scope.scheduledBefore}`);
            }

            const canceled = await transaction.$queryRaw<Array<{ id: string }>>(Prisma.sql`
                UPDATE "message_trigger_job"
                SET status = 'canceled',
                    canceled_at = date_trunc('milliseconds', clock_timestamp()),
                    cancel_reason = ${reason},
                    updated_at = date_trunc('milliseconds', clock_timestamp())
                WHERE ${Prisma.join(predicates, " AND ")}
                RETURNING id
            `);
            return canceled.length;
        });
    }

    async upsertPending(job: MessageTriggerJobEntity): Promise<MessageTriggerJobEntity> {
        return this.upsertPendingWithClient(this.prisma, job);
    }

    async upsertPendingForRuleGeneration(
        job: MessageTriggerJobEntity,
        expectedUpdatedAt: Date,
        expectedJobsStale: boolean,
    ): Promise<MessageTriggerJobEntity | null> {
        const branchPredicate = job.branchId === null
            ? Prisma.sql`branch_id IS NULL`
            : Prisma.sql`branch_id = ${job.branchId}::uuid`;

        return this.prisma.$transaction(async (transaction) => {
            // All generation-aware producers lock the rule before touching a job row.
            // A producer that read an obsolete generation returns without any job write.
            const rules = await transaction.$queryRaw<Array<{
                id: string;
                branch_id: string | null;
                jobs_stale: boolean;
                updated_at: Date | string;
            }>>(Prisma.sql`
                SELECT id, branch_id, jobs_stale, updated_at
                FROM "message_trigger_rule"
                WHERE id = ${job.ruleId}
                  AND ${branchPredicate}
                FOR UPDATE
            `);
            const rule = rules[0];
            if (!rule || rule.branch_id !== job.branchId || rule.jobs_stale !== expectedJobsStale) {
                return null;
            }

            const updatedAt = rule.updated_at instanceof Date
                ? rule.updated_at
                : new Date(rule.updated_at);
            if (updatedAt.getTime() !== expectedUpdatedAt.getTime()) {
                return null;
            }

            return this.upsertPendingWithClient(transaction, job);
        });
    }

    private async upsertPendingWithClient(
        client: PrismaService | Prisma.TransactionClient,
        job: MessageTriggerJobEntity,
    ): Promise<MessageTriggerJobEntity> {
        const rows = await client.$queryRaw<MessageTriggerJobRawRow[]>(Prisma.sql`
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
                date_trunc('milliseconds', clock_timestamp())
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
                updated_at = date_trunc('milliseconds', clock_timestamp())
            WHERE "message_trigger_job"."status" NOT IN ('sent', 'processing')
            RETURNING *;
        `);

        const [row] = rows;
        if (row) {
            return this.rawRowToDomain(row);
        }

        const existing = await client.message_trigger_job.findUnique({
            where: { dedupeKey: job.dedupeKey },
        });
        if (!existing) {
            throw new Error(`Message trigger job upsert returned no row: ${job.dedupeKey}`);
        }

        return this.toDomain(existing);
    }

    async claimProviderRejectedForRetry(
        branchId: string,
        sourceJobId: string,
        expectedTargetVersion: string,
        expectedSnapshotHash: string,
        expectedSource: MessageTriggerJobEntity,
        retryJob: MessageTriggerJobEntity,
    ): Promise<MessageTriggerJobEntity | null> {
        // The target version is computed by the capability from the canonical
        // provider snapshot. The row lock below is the linearization point at
        // which that approved source is compared and the retry is claimed.
        if (!expectedTargetVersion || jobTargetVersion(expectedSource, expectedSnapshotHash) !== expectedTargetVersion) return null;
        return this.prisma.$transaction(async (transaction) => {
            const rows = await transaction.$queryRaw<MessageTriggerJobRawRow[]>(Prisma.sql`
                SELECT *
                FROM "message_trigger_job"
                WHERE "id" = ${sourceJobId}
                  AND "branch_id" = ${branchId}::uuid
                FOR UPDATE
            `);
            const row = rows[0];
            if (!row) return null;

            const current = this.rawRowToDomain(row);
            const retrySafety = current.payload.templateVariables?.["retrySafety"];
            if (
                current.status !== "failed"
                || retrySafety !== "provider-rejected"
                || !sameRetrySource(current, expectedSource)
                || jobTargetVersion(current, expectedSnapshotHash) !== expectedTargetVersion
            ) {
                return null;
            }

            const existing = await transaction.message_trigger_job.findUnique({
                where: { dedupeKey: retryJob.dedupeKey },
            });
            if (existing) return this.toDomain(existing);

            const created = await transaction.message_trigger_job.create({
                data: this.toCreate(retryJob),
            });
            return this.toDomain(created);
        });
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
