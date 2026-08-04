import { MessageTriggerJobEntity } from "domain/entities/message-trigger-job.entity";

export interface MessageTriggerJobCancellationScope {
    clientId?: number;
    employeeScheduleId?: number;
    scheduledBefore?: Date;
}

export interface IMessageTriggerJobRepository {
    create(job: MessageTriggerJobEntity): Promise<MessageTriggerJobEntity>;
    update(job: MessageTriggerJobEntity): Promise<MessageTriggerJobEntity>;
    findById(id: string): Promise<MessageTriggerJobEntity | null>;
    claimPending(id: string): Promise<boolean>;
    /** Claim only while the branch-scoped rule is not fenced as stale. */
    claimPendingWithRuleFence(id: string, branchId: string | null): Promise<boolean>;
    findDuePending(limit?: number): Promise<MessageTriggerJobEntity[]>;
    findStaleProcessing(cutoff: Date, limit?: number): Promise<MessageTriggerJobEntity[]>;
    findUpcomingPendingByBranch(
        branchId: string,
        limit?: number,
    ): Promise<MessageTriggerJobEntity[]>;
    findTerminalByBranch(
        branchId: string,
        limit?: number,
    ): Promise<MessageTriggerJobEntity[]>;
    findHistoryByBranch(
        branchId: string,
        limit?: number,
        beforeId?: string,
    ): Promise<MessageTriggerJobEntity[]>;
    findPendingByRuleId(ruleId: string): Promise<MessageTriggerJobEntity[]>;
    /** Whether a rule still has active jobs persisted before its current version fence. */
    hasActiveJobsBefore(branchId: string, ruleId: string, before: Date): Promise<boolean>;
    findPendingByRuleIdsAndClientId(ruleIds: string[], clientId: number): Promise<MessageTriggerJobEntity[]>;
    findPendingByRuleIdsAndEmployeeScheduleId(
        ruleIds: string[],
        employeeScheduleId: number,
    ): Promise<MessageTriggerJobEntity[]>;
    findSentByRuleIdAndEmployeeScheduleId(
        ruleId: string,
        employeeScheduleId: number,
    ): Promise<MessageTriggerJobEntity[]>;
    cancelPendingByClientContext(branchId: string, clientId: number, reason: string): Promise<number>;
    cancelOrphanedPending(reason: string, branchId?: string): Promise<number>;
    findRecoverableOrphanedClientJobs(branchId: string, limit?: number): Promise<MessageTriggerJobEntity[]>;
    markOrphanedJobsReconciled(jobIds: string[], replacementClientId: number): Promise<number>;
    cancelPendingByRuleId(ruleId: string, reason: string): Promise<number>;
    cancelPendingOlderThan(ruleId: string, cutoff: Date, reason: string): Promise<number>;
    /**
     * Cancel mutable pending jobs only while the branch-scoped rule is at the
     * inspected generation and stale state. Null means the producer lost the
     * generation race and must leave all job rows untouched.
     */
    cancelPendingForRuleGeneration(
        branchId: string,
        ruleId: string,
        expectedUpdatedAt: Date,
        expectedJobsStale: boolean,
        reason: string,
        scope?: MessageTriggerJobCancellationScope,
    ): Promise<number | null>;
    upsertPending(job: MessageTriggerJobEntity): Promise<MessageTriggerJobEntity>;
    /**
     * Upsert a pending job only while its rule is at the inspected generation
     * and expected stale state. A null result means the producer lost the
     * generation race and must fail closed without touching job rows.
     */
    upsertPendingForRuleGeneration(
        job: MessageTriggerJobEntity,
        expectedUpdatedAt: Date,
        expectedJobsStale: boolean,
    ): Promise<MessageTriggerJobEntity | null>;
    /**
     * Lock and compare a rejected source job, then create the action-bound
     * retry job in the same transaction. A null result means the approved
     * source target drifted or is no longer retryable.
     */
    claimProviderRejectedForRetry(
        branchId: string,
        sourceJobId: string,
        expectedTargetVersion: string,
        expectedSnapshotHash: string,
        expectedSource: MessageTriggerJobEntity,
        retryJob: MessageTriggerJobEntity,
    ): Promise<MessageTriggerJobEntity | null>;
}

export const MESSAGE_TRIGGER_JOB_REPOSITORY = "MESSAGE_TRIGGER_JOB_REPOSITORY";
