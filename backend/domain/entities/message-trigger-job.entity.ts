import {
    MessageTriggerRecipientType,
    MessageTriggerTemplateKey,
} from "domain/constants/message-trigger-catalog";
import {
    TRIGGER_JOB_CONFIG_RETRY_DELAY_MS,
    TRIGGER_JOB_MAX_ATTEMPTS,
    TRIGGER_JOB_RETRY_DELAY_MS,
} from "domain/constants/message-automation-policy";

export type MessageTriggerJobStatus =
    | "pending"
    | "processing"
    | "dispatching"
    | "sent"
    | "failed"
    | "canceled";

export interface MessageTriggerCatchUpMetadata {
    batchId: string;
    sequence: number;
    intervalMinutes: number;
    originalScheduledFor: string;
    predecessorDedupeKey: string | null;
}

export interface MessageTriggerJobPayload {
    clientId?: number | null;
    clientName?: string | null;
    employeeId?: number | null;
    employeeName?: string | null;
    /**
     * Hash of the schedule and assignment source used to build an employee
     * assignment job. It is intentionally opaque so address data is not
     * duplicated into the dispatch payload.
     */
    employeeScheduleFingerprint?: string;
    memberId: string;
    recipientName: string;
    recipientPhone: string;
    templateVariables: Record<string, string>;
    buttonUrl?: string | null;
    messageBody?: string | null;
    catchUp?: MessageTriggerCatchUpMetadata;
    /** The staff user who triggered a manual send, when applicable. Absent for automatic jobs. */
    sentByUserId?: string | null;
}

export class MessageTriggerJobEntity {
    constructor(
        public readonly id: string,
        public branchId: string | null,
        public ruleId: string,
        public status: MessageTriggerJobStatus,
        public scheduledFor: Date,
        public sentAt: Date | null,
        public canceledAt: Date | null,
        public cancelReason: string | null,
        public clientId: number | null,
        public employeeScheduleId: number | null,
        public recipientType: MessageTriggerRecipientType,
        public recipientPhone: string | null,
        public templateKey: MessageTriggerTemplateKey,
        public dedupeKey: string,
        public payload: MessageTriggerJobPayload,
        public attempts: number,
        public nextAttemptAt: Date | null,
        public createdAt: Date,
        public updatedAt: Date,
        /** Immutable token for the currently claimed processing attempt. */
        public claimToken: string | null = null,
    ) {}

    static create(params: {
        branchId?: string;
        ruleId: string;
        scheduledFor: Date;
        clientId?: number | null;
        employeeScheduleId?: number | null;
        recipientType: MessageTriggerRecipientType;
        recipientPhone?: string | null;
        templateKey: MessageTriggerTemplateKey;
        dedupeKey: string;
        payload: MessageTriggerJobPayload;
    }): MessageTriggerJobEntity {
        const now = new Date();
        return new MessageTriggerJobEntity(
            "",
            params.branchId ?? null,
            params.ruleId,
            "pending",
            params.scheduledFor,
            null,
            null,
            null,
            params.clientId ?? null,
            params.employeeScheduleId ?? null,
            params.recipientType,
            params.recipientPhone ?? null,
            params.templateKey,
            params.dedupeKey,
            params.payload,
            0,
            null,
            now,
            now,
            null,
        );
    }

    static reconstitute(
        id: string,
        branchId: string | null,
        ruleId: string,
        status: MessageTriggerJobStatus,
        scheduledFor: Date,
        sentAt: Date | null,
        canceledAt: Date | null,
        cancelReason: string | null,
        clientId: number | null,
        employeeScheduleId: number | null,
        recipientType: MessageTriggerRecipientType,
        recipientPhone: string | null,
        templateKey: MessageTriggerTemplateKey,
        dedupeKey: string,
        payload: MessageTriggerJobPayload,
        createdAt: Date,
        updatedAt: Date,
        attempts = 0,
        nextAttemptAt: Date | null = null,
        claimToken: string | null = null,
    ): MessageTriggerJobEntity {
        return new MessageTriggerJobEntity(
            id,
            branchId,
            ruleId,
            status,
            scheduledFor,
            sentAt,
            canceledAt,
            cancelReason,
            clientId,
            employeeScheduleId,
            recipientType,
            recipientPhone,
            templateKey,
            dedupeKey,
            payload,
            attempts,
            nextAttemptAt,
            createdAt,
            updatedAt,
            claimToken,
        );
    }

    markProcessing(claimToken?: string | null): void {
        this.status = "processing";
        if (claimToken !== undefined) {
            this.claimToken = claimToken;
        }
        this.updatedAt = new Date();
    }

    /**
     * The dispatching state is an irreversible authorization boundary. Once a
     * claim reaches it, the provider path may open its own database connection
     * without holding the claim row lock; terminal completion remains fenced
     * by the immutable claim token.
     */
    markDispatchAuthorized(): void {
        this.status = "dispatching";
        this.updatedAt = new Date();
    }

    defer(kind: "config" | "transient", reason: string): void {
        const now = new Date();

        if (kind === "config") {
            this.status = "pending";
            this.nextAttemptAt = new Date(now.getTime() + TRIGGER_JOB_CONFIG_RETRY_DELAY_MS);
            this.updatedAt = now;
            return;
        }

        this.attempts += 1;
        if (this.attempts >= TRIGGER_JOB_MAX_ATTEMPTS) {
            this.markFailed(reason);
            return;
        }

        this.status = "pending";
        this.nextAttemptAt = new Date(now.getTime() + TRIGGER_JOB_RETRY_DELAY_MS);
        this.updatedAt = now;
    }

    markSent(): void {
        this.status = "sent";
        this.sentAt = new Date();
        this.nextAttemptAt = null;
        this.updatedAt = new Date();
    }

    markFailed(reason?: string): void {
        this.status = "failed";
        this.cancelReason = reason ?? null;
        this.updatedAt = new Date();
    }

    cancel(reason: string): void {
        this.status = "canceled";
        this.cancelReason = reason;
        this.canceledAt = new Date();
        this.updatedAt = new Date();
    }
}
