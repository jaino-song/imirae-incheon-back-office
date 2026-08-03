import { Injectable } from "@nestjs/common";
import { PrismaService } from "infrastructure/database/prisma.service";
import type { Prisma } from "@prisma/client";
import { IMessageTriggerRuleRepository } from "domain/repositories/message-trigger-rule.repository.interface";
import { MessageTriggerRuleEntity } from "domain/entities/message-trigger-rule.entity";
import {
    MessageTriggerEventType,
    MessageTriggerOffsetType,
    MessageTriggerRecipientType,
    MessageTriggerTemplateKey,
} from "domain/constants/message-trigger-catalog";

@Injectable()
export class SbMessageTriggerRuleRepository implements IMessageTriggerRuleRepository {
    constructor(private readonly prisma: PrismaService) {}

    async findAll(branchId: string): Promise<MessageTriggerRuleEntity[]> {
        const rows = await this.prisma.message_trigger_rule.findMany({
            where: { branchId },
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
    ): Promise<MessageTriggerRuleEntity> {
        const row = await this.prisma.message_trigger_rule.update({
            where: { id: rule.id },
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

    async markJobsStale(ruleId: string, transaction?: Prisma.TransactionClient): Promise<void> {
        await (transaction ?? this.prisma).message_trigger_rule.updateMany({
            where: { id: ruleId },
            data: { jobsStale: true },
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
            data: { jobsStale: false },
        });
        return result.count === 1;
    }

    async delete(branchId: string, id: string): Promise<void> {
        await this.prisma.message_trigger_rule.deleteMany({
            where: { id, branchId },
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
}
