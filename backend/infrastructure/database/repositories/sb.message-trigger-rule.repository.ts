import { Injectable } from "@nestjs/common";
import { PrismaService } from "infrastructure/database/prisma.service";
import { Prisma } from "@prisma/client";
import { IMessageTriggerRuleRepository } from "domain/repositories/message-trigger-rule.repository.interface";
import { MessageTriggerRuleEntity } from "domain/entities/message-trigger-rule.entity";
import {
    MessageTriggerEventType,
    MessageTriggerOffsetType,
    MessageTriggerRecipientType,
    MessageTriggerTemplateKey,
} from "domain/constants/message-trigger-catalog";

type MessageTriggerRuleRawRow = {
    id: string;
    branch_id: string | null;
    name: string;
    is_active: boolean;
    event_type: string;
    offset_type: string;
    offset_days: number;
    recipient_type: string;
    template_key: string;
    is_default: boolean;
    jobs_stale: boolean;
    created_at: Date | string;
    updated_at: Date | string;
};

@Injectable()
export class SbMessageTriggerRuleRepository implements IMessageTriggerRuleRepository {
    constructor(private readonly prisma: PrismaService) {}

    async findAll(branchId: string): Promise<MessageTriggerRuleEntity[]> {
        const rows = await this.prisma.message_trigger_rule.findMany({
            // Fixed system automations are global so every branch can see the
            // routine that is able to create its scheduled jobs.
            where: { OR: [{ branchId }, { branchId: null }] },
            orderBy: { createdAt: "desc" },
        });
        return rows.map((row) => this.toDomain(row));
    }

    async findById(branchId: string, id: string): Promise<MessageTriggerRuleEntity | null> {
        const row = await this.prisma.message_trigger_rule.findFirst({
            where: { id, branchId },
        });
        return row ? this.toDomain(row) : null;
    }

    async findActiveByEventTypes(
        branchId: string,
        eventTypes: MessageTriggerEventType[],
    ): Promise<MessageTriggerRuleEntity[]> {
        const rows = await this.prisma.message_trigger_rule.findMany({
            where: {
                branchId,
                isActive: true,
                eventType: { in: eventTypes },
            },
            orderBy: { createdAt: "desc" },
        });
        return rows.map((row) => this.toDomain(row));
    }

    async findActiveTemplateKeys(
        templateKeys: MessageTriggerTemplateKey[],
        transaction?: Prisma.TransactionClient,
    ): Promise<MessageTriggerTemplateKey[]> {
        if (templateKeys.length === 0) return [];
        const rows = await (transaction ?? this.prisma).message_trigger_rule.findMany({
            where: {
                isActive: true,
                templateKey: { in: templateKeys },
            },
            select: { templateKey: true },
            distinct: ["templateKey"],
        });
        return rows.map((row) => row.templateKey as MessageTriggerTemplateKey);
    }

    async findInactiveDefaultRules(limit = 50): Promise<MessageTriggerRuleEntity[]> {
        const rows = await this.prisma.message_trigger_rule.findMany({
            where: {
                isDefault: true,
                isActive: false,
            },
            orderBy: { updatedAt: "asc" },
            take: limit,
        });
        return rows.map((row) => this.toDomain(row));
    }

    async findStaleRules(limit = 10): Promise<MessageTriggerRuleEntity[]> {
        const rows = await this.prisma.message_trigger_rule.findMany({
            where: { jobsStale: true },
            orderBy: { updatedAt: "asc" },
            take: limit,
        });
        return rows.map((row) => this.toDomain(row));
    }

    async create(
        branchId: string,
        rule: MessageTriggerRuleEntity,
        transaction?: Prisma.TransactionClient,
    ): Promise<MessageTriggerRuleEntity> {
        const row = await (transaction ?? this.prisma).message_trigger_rule.create({
            data: {
                branchId,
                name: rule.name,
                isActive: rule.isActive,
                eventType: rule.eventType,
                offsetType: rule.offsetType,
                offsetDays: rule.offsetDays,
                recipientType: rule.recipientType,
                templateKey: rule.templateKey,
                isDefault: rule.isDefault,
                jobsStale: rule.jobsStale,
            },
        });
        return this.toDomain(row);
    }

    async update(
        branchId: string,
        rule: MessageTriggerRuleEntity,
        transaction?: Prisma.TransactionClient,
    ): Promise<MessageTriggerRuleEntity> {
        const row = await (transaction ?? this.prisma).message_trigger_rule.update({
            where: { id: rule.id, branchId },
            data: {
                branchId,
                name: rule.name,
                isActive: rule.isActive,
                eventType: rule.eventType,
                offsetType: rule.offsetType,
                offsetDays: rule.offsetDays,
                recipientType: rule.recipientType,
                templateKey: rule.templateKey,
                isDefault: rule.isDefault,
                jobsStale: rule.jobsStale,
            },
        });
        return this.toDomain(row);
    }

    async updateIfTargetMatches(
        branchId: string,
        expected: MessageTriggerRuleEntity,
        next: MessageTriggerRuleEntity,
    ): Promise<MessageTriggerRuleEntity | null> {
        const result = await this.prisma.message_trigger_rule.updateMany({
            where: {
                id: expected.id,
                branchId,
                name: expected.name,
                isActive: expected.isActive,
                eventType: expected.eventType,
                offsetType: expected.offsetType,
                offsetDays: expected.offsetDays,
                recipientType: expected.recipientType,
                templateKey: expected.templateKey,
                isDefault: expected.isDefault,
                jobsStale: expected.jobsStale,
                updatedAt: expected.updatedAt,
            },
            data: {
                name: next.name,
                isActive: next.isActive,
                eventType: next.eventType,
                offsetType: next.offsetType,
                offsetDays: next.offsetDays,
                recipientType: next.recipientType,
                templateKey: next.templateKey,
                isDefault: next.isDefault,
                jobsStale: next.jobsStale,
            },
        });
        return result.count === 1 ? next : null;
    }

    async updateIfTargetMatchesAndFenceJobs(
        branchId: string,
        expected: MessageTriggerRuleEntity,
        next: MessageTriggerRuleEntity,
        reason: string,
        fenceStartedAt?: Date,
        transaction?: Prisma.TransactionClient,
    ): Promise<MessageTriggerRuleEntity | null> {
        const update = async (writeTransaction: Prisma.TransactionClient) => {
            const rows = await writeTransaction.$queryRaw<MessageTriggerRuleRawRow[]>(Prisma.sql`
                SELECT
                    id,
                    branch_id,
                    name,
                    is_active,
                    event_type,
                    offset_type,
                    offset_days,
                    recipient_type,
                    template_key,
                    is_default,
                    jobs_stale,
                    created_at,
                    updated_at
                FROM "message_trigger_rule"
                WHERE id = ${expected.id}
                  AND branch_id = ${branchId}::uuid
                FOR UPDATE
            `);
            const current = rows[0] ? this.rawToDomain(rows[0]) : null;
            if (!current || !this.sameTarget(current, expected, branchId)) {
                return null;
            }

            // The dispatcher takes the same rule row lock before claiming a
            // job. If a replica already won and moved a job to processing,
            // the approved update must fail rather than commit underneath an
            // in-flight provider call.
            const activeJobStatusPredicate = fenceStartedAt
                ? Prisma.sql`status IN ('pending', 'processing', 'dispatching') OR (status = 'sent' AND sent_at >= ${fenceStartedAt})`
                : Prisma.sql`status IN ('pending', 'processing', 'dispatching')`;
            const activeJobs = await writeTransaction.$queryRaw<Array<{ status: string }>>(Prisma.sql`
                SELECT status
                FROM "message_trigger_job"
                WHERE rule_id = ${expected.id}
                  AND branch_id = ${branchId}::uuid
                  AND (${activeJobStatusPredicate})
                FOR UPDATE
            `);
            if (activeJobs.some((job) => job.status === "processing" || job.status === "dispatching" || job.status === "sent")) {
                return null;
            }

            const updatedRows = await writeTransaction.$queryRaw<MessageTriggerRuleRawRow[]>(Prisma.sql`
                UPDATE "message_trigger_rule"
                SET
                    name = ${next.name},
                    is_active = ${next.isActive},
                    event_type = ${next.eventType},
                    offset_type = ${next.offsetType},
                    offset_days = ${next.offsetDays},
                    recipient_type = ${next.recipientType},
                    template_key = ${next.templateKey},
                    is_default = ${next.isDefault},
                    jobs_stale = TRUE,
                    updated_at = date_trunc('milliseconds', clock_timestamp())
                WHERE id = ${expected.id}
                  AND branch_id = ${branchId}::uuid
                RETURNING
                    id,
                    branch_id,
                    name,
                    is_active,
                    event_type,
                    offset_type,
                    offset_days,
                    recipient_type,
                    template_key,
                    is_default,
                    jobs_stale,
                    created_at,
                    updated_at
            `);
            if (!updatedRows[0]) return null;

            await writeTransaction.$executeRaw(Prisma.sql`
                UPDATE "message_trigger_job"
                SET
                    status = 'canceled',
                    canceled_at = now(),
                    cancel_reason = ${reason},
                    updated_at = date_trunc('milliseconds', clock_timestamp())
                WHERE rule_id = ${expected.id}
                  AND branch_id = ${branchId}::uuid
                  AND status = 'pending'
            `);

            return this.rawToDomain(updatedRows[0]);
        };
        return transaction
            ? update(transaction)
            : this.prisma.$transaction(update);
    }

    async markJobsStale(branchId: string, ruleId: string, transaction?: Prisma.TransactionClient): Promise<void> {
        await (transaction ?? this.prisma).message_trigger_rule.updateMany({
            where: { id: ruleId, branchId },
            data: { jobsStale: true },
        });
    }

    async ensureSystemRule(rule: MessageTriggerRuleEntity, transaction?: Prisma.TransactionClient): Promise<void> {
        await (transaction ?? this.prisma).message_trigger_rule.upsert({
            where: { id: rule.id },
            create: {
                id: rule.id,
                branchId: null,
                name: rule.name,
                isActive: rule.isActive,
                eventType: rule.eventType,
                offsetType: rule.offsetType,
                offsetDays: rule.offsetDays,
                recipientType: rule.recipientType,
                templateKey: rule.templateKey,
                isDefault: rule.isDefault,
                jobsStale: rule.jobsStale,
            },
            update: {},
        });
    }

    async clearJobsStaleIfUnchanged(
        ruleId: string,
        updatedAtAtReadTime: Date,
    ): Promise<boolean> {
        const result = await this.prisma.message_trigger_rule.updateMany({
            where: {
                id: ruleId,
                jobsStale: true,
                updatedAt: updatedAtAtReadTime,
            },
            // Clearing the stale flag is bookkeeping, not a new rule
            // generation. Preserve the inspected DB fence so a rebuilt job
            // reusing the same dedupe row remains newer than this rule
            // version even when application and database clocks differ.
            data: { jobsStale: false, updatedAt: updatedAtAtReadTime },
        });
        return result.count === 1;
    }

    async delete(branchId: string, id: string): Promise<void> {
        await this.prisma.message_trigger_rule.deleteMany({
            where: { id, branchId },
        });
    }

    async deleteIfTargetMatches(
        branchId: string,
        expected: MessageTriggerRuleEntity,
    ): Promise<boolean> {
        const result = await this.prisma.message_trigger_rule.deleteMany({
            where: {
                id: expected.id,
                branchId,
                name: expected.name,
                isActive: expected.isActive,
                eventType: expected.eventType,
                offsetType: expected.offsetType,
                offsetDays: expected.offsetDays,
                recipientType: expected.recipientType,
                templateKey: expected.templateKey,
                isDefault: expected.isDefault,
                jobsStale: expected.jobsStale,
                updatedAt: expected.updatedAt,
            },
        });
        return result.count === 1;
    }

    async deleteIfTargetMatchesAndFenceJobs(
        branchId: string,
        expected: MessageTriggerRuleEntity,
        reason: string,
        fenceStartedAt?: Date,
    ): Promise<boolean> {
        return this.prisma.$transaction(async (transaction) => {
            const rows = await transaction.$queryRaw<MessageTriggerRuleRawRow[]>(Prisma.sql`
                SELECT
                    id,
                    branch_id,
                    name,
                    is_active,
                    event_type,
                    offset_type,
                    offset_days,
                    recipient_type,
                    template_key,
                    is_default,
                    jobs_stale,
                    created_at,
                    updated_at
                FROM "message_trigger_rule"
                WHERE id = ${expected.id}
                  AND branch_id = ${branchId}::uuid
                FOR UPDATE
            `);
            const current = rows[0] ? this.rawToDomain(rows[0]) : null;
            if (!current || !this.sameTarget(current, expected, branchId)) {
                return false;
            }

            const activeJobStatusPredicate = fenceStartedAt
                ? Prisma.sql`status IN ('pending', 'processing', 'dispatching') OR (status = 'sent' AND sent_at >= ${fenceStartedAt})`
                : Prisma.sql`status IN ('pending', 'processing', 'dispatching')`;
            const activeJobs = await transaction.$queryRaw<Array<{ status: string }>>(Prisma.sql`
                SELECT status
                FROM "message_trigger_job"
                WHERE rule_id = ${expected.id}
                  AND branch_id = ${branchId}::uuid
                  AND (${activeJobStatusPredicate})
                FOR UPDATE
            `);
            if (activeJobs.some((job) => job.status === "processing" || job.status === "dispatching" || job.status === "sent")) {
                return false;
            }

            await transaction.$executeRaw(Prisma.sql`
                UPDATE "message_trigger_job"
                SET
                    status = 'canceled',
                    canceled_at = now(),
                    cancel_reason = ${reason},
                    updated_at = now()
                WHERE rule_id = ${expected.id}
                  AND branch_id = ${branchId}::uuid
                  AND status = 'pending'
            `);

            const deletedRows = await transaction.$queryRaw<Array<{ id: string }>>(Prisma.sql`
                DELETE FROM "message_trigger_rule"
                WHERE id = ${expected.id}
                  AND branch_id = ${branchId}::uuid
                RETURNING id
            `);
            return deletedRows.length === 1;
        });
    }

    private toDomain(row: {
        id: string;
        branchId: string | null;
        name: string;
        isActive: boolean;
        eventType: string;
        offsetType: string;
        offsetDays: number;
        recipientType: string;
        templateKey: string;
        isDefault?: boolean;
        jobsStale?: boolean;
        createdAt: Date;
        updatedAt: Date;
    }): MessageTriggerRuleEntity {
        return MessageTriggerRuleEntity.reconstitute(
            row.id,
            row.branchId,
            row.name,
            row.isActive,
            row.eventType as MessageTriggerEventType,
            row.offsetType as MessageTriggerOffsetType,
            row.offsetDays,
            row.recipientType as MessageTriggerRecipientType,
            row.templateKey as MessageTriggerTemplateKey,
            row.createdAt,
            row.updatedAt,
            row.isDefault ?? false,
            row.jobsStale ?? false,
        );
    }

    private rawToDomain(row: MessageTriggerRuleRawRow): MessageTriggerRuleEntity {
        return this.toDomain({
            id: row.id,
            branchId: row.branch_id,
            name: row.name,
            isActive: row.is_active,
            eventType: row.event_type,
            offsetType: row.offset_type,
            offsetDays: row.offset_days,
            recipientType: row.recipient_type,
            templateKey: row.template_key,
            isDefault: row.is_default,
            jobsStale: row.jobs_stale,
            createdAt: row.created_at instanceof Date ? row.created_at : new Date(row.created_at),
            updatedAt: row.updated_at instanceof Date ? row.updated_at : new Date(row.updated_at),
        });
    }

    private sameTarget(
        current: MessageTriggerRuleEntity,
        expected: MessageTriggerRuleEntity,
        branchId: string,
    ): boolean {
        return current.id === expected.id
            && current.branchId === branchId
            && current.branchId === expected.branchId
            && current.name === expected.name
            && current.isActive === expected.isActive
            && current.eventType === expected.eventType
            && current.offsetType === expected.offsetType
            && current.offsetDays === expected.offsetDays
            && current.recipientType === expected.recipientType
            && current.templateKey === expected.templateKey
            && current.isDefault === expected.isDefault
            && current.jobsStale === expected.jobsStale
            && current.createdAt.getTime() === expected.createdAt.getTime()
            && current.updatedAt.getTime() === expected.updatedAt.getTime();
    }
}
