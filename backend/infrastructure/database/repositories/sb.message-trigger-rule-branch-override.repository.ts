import { Injectable } from "@nestjs/common";
import { PrismaService } from "infrastructure/database/prisma.service";
import {
    IMessageTriggerRuleBranchOverrideRepository,
    MessageTriggerRuleBranchOverride,
} from "domain/repositories/message-trigger-rule-branch-override.repository.interface";

@Injectable()
export class SbMessageTriggerRuleBranchOverrideRepository implements IMessageTriggerRuleBranchOverrideRepository {
    constructor(private readonly prisma: PrismaService) {}

    async findOne(branchId: string, ruleId: string): Promise<MessageTriggerRuleBranchOverride | null> {
        return this.prisma.message_trigger_rule_branch_override.findUnique({
            where: { branchId_ruleId: { branchId, ruleId } },
            select: { branchId: true, ruleId: true, isActive: true },
        });
    }

    async findAllByBranch(branchId: string): Promise<MessageTriggerRuleBranchOverride[]> {
        return this.prisma.message_trigger_rule_branch_override.findMany({
            where: { branchId },
            select: { branchId: true, ruleId: true, isActive: true },
        });
    }

    async upsert(branchId: string, ruleId: string, isActive: boolean): Promise<MessageTriggerRuleBranchOverride> {
        return this.prisma.message_trigger_rule_branch_override.upsert({
            where: { branchId_ruleId: { branchId, ruleId } },
            create: { branchId, ruleId, isActive },
            update: { isActive },
            select: { branchId: true, ruleId: true, isActive: true },
        });
    }

    async cancelJobsForBranchRule(branchId: string, ruleId: string, cancelReason: string, retryReason: string): Promise<void> {
        await this.prisma.$transaction([
            this.prisma.message_trigger_job.updateMany({
                where: { branchId, ruleId, status: "pending" },
                data: { status: "canceled", canceledAt: new Date(), cancelReason, canceledByUser: false },
            }),
            this.prisma.message_trigger_job.updateMany({
                where: { branchId, ruleId, status: "failed", cancelReason: retryReason },
                data: { status: "canceled", canceledAt: new Date(), cancelReason, canceledByUser: false },
            }),
        ]);
    }
}
