import { MessageTriggerEventType } from "domain/constants/message-trigger-catalog";
import { MessageTriggerTemplateKey } from "domain/constants/message-trigger-catalog";
import { MessageTriggerRuleEntity } from "domain/entities/message-trigger-rule.entity";
import type { Prisma } from "@prisma/client";

export interface IMessageTriggerRuleRepository {
    findAll(branchId: string): Promise<MessageTriggerRuleEntity[]>;
    findById(branchId: string, id: string): Promise<MessageTriggerRuleEntity | null>;
    findActiveByEventTypes(
        branchId: string,
        eventTypes: MessageTriggerEventType[],
    ): Promise<MessageTriggerRuleEntity[]>;
    /** Minimal global read used to prevent a shared template edit from breaking active tenant rules. */
    findActiveTemplateKeys(
        templateKeys: MessageTriggerTemplateKey[],
        transaction?: Prisma.TransactionClient,
    ): Promise<MessageTriggerTemplateKey[]>;
    findInactiveDefaultRules(limit?: number): Promise<MessageTriggerRuleEntity[]>;
    findStaleRules(limit?: number): Promise<MessageTriggerRuleEntity[]>;
    create(branchId: string, rule: MessageTriggerRuleEntity, transaction?: Prisma.TransactionClient): Promise<MessageTriggerRuleEntity>;
    update(
        branchId: string,
        rule: MessageTriggerRuleEntity,
        transaction?: Prisma.TransactionClient,
    ): Promise<MessageTriggerRuleEntity>;
    /**
     * Compare the complete branch-scoped rule snapshot and update it in one
     * conditional mutation. A null result means the approved target drifted.
     */
    updateIfTargetMatches(
        branchId: string,
        expected: MessageTriggerRuleEntity,
        next: MessageTriggerRuleEntity,
    ): Promise<MessageTriggerRuleEntity | null>;
    /**
     * Lock the branch-scoped rule, compare the approved snapshot, fence all
     * active dispatch jobs, and commit the rule mutation as one transaction.
     * A null result means the target drifted or a dispatch already won.
     */
    updateIfTargetMatchesAndFenceJobs(
        branchId: string,
        expected: MessageTriggerRuleEntity,
        next: MessageTriggerRuleEntity,
        reason: string,
        fenceStartedAt?: Date,
        transaction?: Prisma.TransactionClient,
    ): Promise<MessageTriggerRuleEntity | null>;
    markJobsStale(branchId: string, ruleId: string, transaction?: Prisma.TransactionClient): Promise<void>;
    /** Idempotent upsert of a branch-less system rule row (branchId null); update is a no-op. */
    ensureSystemRule(rule: MessageTriggerRuleEntity, transaction?: Prisma.TransactionClient): Promise<void>;
    clearJobsStaleIfUnchanged(ruleId: string, updatedAtAtReadTime: Date): Promise<boolean>;
    delete(branchId: string, id: string): Promise<void>;
    /** Delete only when the full branch-scoped approved snapshot still matches. */
    deleteIfTargetMatches(branchId: string, expected: MessageTriggerRuleEntity): Promise<boolean>;
    /** Delete only after the branch-scoped rule lock fences active dispatch jobs. */
    deleteIfTargetMatchesAndFenceJobs(
        branchId: string,
        expected: MessageTriggerRuleEntity,
        reason: string,
        fenceStartedAt?: Date,
    ): Promise<boolean>;
}

export const MESSAGE_TRIGGER_RULE_REPOSITORY = "MESSAGE_TRIGGER_RULE_REPOSITORY";
