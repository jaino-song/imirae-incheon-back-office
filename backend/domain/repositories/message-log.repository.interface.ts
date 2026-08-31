import { MessageLogEntity } from "domain/entities/message-log.entity";

export interface IMessageLogRepository {
    save(log: MessageLogEntity): Promise<MessageLogEntity>;
    update(log: MessageLogEntity): Promise<MessageLogEntity>;
    /**
     * Persist (or converge on) one deterministic provider attempt before any
     * external request. Implementations must reject a fingerprint mismatch.
     */
    prepareProviderAttempt(log: MessageLogEntity): Promise<MessageLogEntity>;
    /** Atomically claim the prepared row immediately before crossing the network. */
    claimProviderAttempt(log: MessageLogEntity): Promise<MessageLogEntity | null>;
    /** Conditionally apply one operator reconciliation to an uncertain attempt. */
    reconcileProviderAttempt(
        log: MessageLogEntity,
        outcome: "delivered" | "not-delivered",
        actor: string,
        reason: string,
        providerMessageId?: string | null,
    ): Promise<MessageLogEntity | null>;
    startRetryAttempt(
        sourceLog: MessageLogEntity,
        retryLog: MessageLogEntity,
    ): Promise<MessageLogEntity | null>;
    findByIdInBranch(branchId: string, id: number): Promise<MessageLogEntity | null>;
    findSentTriggerJobIdsSystemScope(jobIds: string[]): Promise<Set<string>>;
    findUncertainTriggerJobIdsSystemScope(jobIds: string[]): Promise<Set<string>>;
    findPendingRetriesSystemScope(): Promise<MessageLogEntity[]>;
    findRetryableServiceRecordSmsByScheduleId(scheduleId: number): Promise<MessageLogEntity[]>;
    findRecentByBranch(
        branchId: string,
        limit?: number,
        skip?: number,
    ): Promise<MessageLogEntity[]>;
}

export const MESSAGE_LOG_REPOSITORY = "MESSAGE_LOG_REPOSITORY";
