import { MessageTriggerJobEntity } from "domain/entities/message-trigger-job.entity";

export interface MessageTriggerJobCancellationScope {
    clientId?: number;
    employeeScheduleId?: number;
    scheduledBefore?: Date;
}

export interface IMessageTriggerJobRepository {
    create(job: MessageTriggerJobEntity): Promise<MessageTriggerJobEntity>;
    update(job: MessageTriggerJobEntity): Promise<MessageTriggerJobEntity>;
    /** Unscoped read used only by system/scheduler callers with no caller branch to fence on. */
    findByIdSystemScope(id: string): Promise<MessageTriggerJobEntity | null>;
    /** Branch-fenced read for request-path callers; a branch mismatch resolves to null, not another branch's row. */
    findByIdInBranch(branchId: string, id: string): Promise<MessageTriggerJobEntity | null>;
    /** Unscoped claim used only by system/scheduler callers; request-path callers must use claimPendingWithRuleFence. */
    claimPendingSystemScope(id: string): Promise<boolean>;
    /**
     * Claim only while the branch-scoped rule is not fenced as stale. The
     * returned token is unique to this processing attempt and must be supplied
     * to every terminal update/fence before a provider call.
     */
    claimPendingWithRuleFence(id: string, branchId: string | null): Promise<string | null>;
    findDuePendingSystemScope(limit?: number): Promise<MessageTriggerJobEntity[]>;
    findStaleProcessingSystemScope(cutoff: Date, limit?: number): Promise<MessageTriggerJobEntity[]>;
    findUpcomingPendingByBranch(
        branchId: string,
        limit?: number,
    ): Promise<MessageTriggerJobEntity[]>;
    findTerminalByBranch(
        branchId: string,
        limit?: number,
    ): Promise<MessageTriggerJobEntity[]>;
    /**
     * Terminal (failed or canceled) jobs for a branch whose terminal
     * transition landed in `[since, until)` — `canceledAt` for a canceled
     * row, `updatedAt` for a failed row (there is no dedicated failedAt
     * column; markFailed() always bumps updatedAt at the moment of
     * failure). Excludes rows the user canceled themselves
     * (canceledByUser = true): a cancel the user pressed must never be
     * reported back to them as a problem. Feeds the daily digest.
     */
    findRecentUndeliveredByBranch(
        branchId: string,
        since: Date,
        until: Date,
        limit: number,
    ): Promise<MessageTriggerJobEntity[]>;
    countRecentUndeliveredByBranch(
        branchId: string,
        since: Date,
        until: Date,
    ): Promise<number>;
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
     * Cancel a single job on the user's behalf. Pending and processing jobs
     * scoped to the given branch are canceled atomically; processing claims
     * are invalidated by clearing their claim token before the pre-provider
     * fence can proceed. The canceled row is marked so the re-sync upsert
     * below never resurrects it. Returns whether the cancel matched a row.
     */
    cancelPendingByUser(id: string, branchId: string, reason: string): Promise<boolean>;
    /**
     * Promote only the exact automatic service-record scheduling marker owned
     * by this claim version. A null result means the claim was replaced or
     * otherwise lost and must fail closed without reading/reviving another row.
     */
    promoteAutomaticSchedulingClaim(
        markerId: string,
        expectedClaimVersion: string,
        job: MessageTriggerJobEntity,
    ): Promise<MessageTriggerJobEntity | null>;
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
        preserveExisting?: boolean,
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
