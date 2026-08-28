export const SMS_DELIVERY_MAX_ATTEMPTS = 3;
export const SMS_DELIVERY_RETRY_DELAY_MS = 5 * 60 * 1000;

export interface MessageDeliveryRetryPolicy {
    maxAttempts: number;
    retryDelayMs: number;
}

export function getMessageDeliveryRetryPolicy(provider: string): MessageDeliveryRetryPolicy {
    if (provider === "aligo_sms") {
        return {
            maxAttempts: SMS_DELIVERY_MAX_ATTEMPTS,
            retryDelayMs: SMS_DELIVERY_RETRY_DELAY_MS,
        };
    }

    return {
        maxAttempts: SMS_DELIVERY_MAX_ATTEMPTS,
        retryDelayMs: SMS_DELIVERY_RETRY_DELAY_MS,
    };
}

export type MessageLogStatus = "pending" | "sent" | "failed";

/** Local state for the boundary around a non-idempotent SMS provider call. */
export type SmsProviderAcceptanceState =
    | "legacy"
    | "prepared"
    | "started"
    | "accepted"
    | "rejected"
    | "uncertain"
    | "reconciled_not_delivered"
    | "reconciled_delivered";

export const SMS_UNCERTAIN_RECONCILIATION_MESSAGE =
    "문자 발송 결과가 불확실하여 자동 재전송을 중단했습니다. 제공자 이력 확인 후 수동 확인이 필요합니다.";

export class MessageLogEntity {
    constructor(
        public readonly id: number,
        public branchId: string | null,
        public provider: string,
        public templateKey: string,
        public triggerJobId: string | null,
        public receiver: string,
        public clientId: number | null,
        public messageBody: string,
        public variables: Record<string, string>,
        public status: MessageLogStatus,
        public aligoMid: string | null,
        public errorMessage: string | null,
        public attempts: number,
        public lastAttemptAt: Date | null,
        public nextRetryAt: Date | null,
        public createdAt: Date,
        public updatedAt: Date,
        public recipientName: string | null = null,
        public recipientPhone: string | null = null,
        public providerAcceptanceKey: string | null = null,
        public providerAcceptanceFingerprint: string | null = null,
        public providerAcceptanceState: SmsProviderAcceptanceState = "legacy",
        public providerCallStartedAt: Date | null = null,
        public providerAcceptedAt: Date | null = null,
        public providerReconciledAt: Date | null = null,
        public providerReconciledBy: string | null = null,
        public providerReconciliationReason: string | null = null,
    ) {}

    markSent(aligoMid?: string): void {
        this.status = "sent";
        this.aligoMid = aligoMid ?? null;
        this.errorMessage = null;
        this.lastAttemptAt = new Date();
        this.nextRetryAt = null;
        this.attempts += 1;
    }

    markFailed(errorMessage: string): void {
        this.attempts += 1;
        this.lastAttemptAt = new Date();
        this.errorMessage = errorMessage;

        if (this.canRetry()) {
            this.scheduleRetry();
        } else {
            this.status = "failed";
            this.nextRetryAt = null;
        }
    }

    canRetry(): boolean {
        return this.attempts < getMessageDeliveryRetryPolicy(this.provider).maxAttempts;
    }

    markRetrySuperseded(reason: string): void {
        this.status = "failed";
        this.errorMessage = reason;
        this.nextRetryAt = null;
        this.updatedAt = new Date();
    }

    private scheduleRetry(): void {
        this.nextRetryAt = new Date(Date.now() + getMessageDeliveryRetryPolicy(this.provider).retryDelayMs);
    }

    static create(params: {
        branchId?: string;
        provider: string;
        templateKey: string;
        triggerJobId?: string;
        receiver: string;
        clientId?: number;
        recipientName?: string | null;
        recipientPhone?: string | null;
        messageBody: string;
        variables: Record<string, string>;
        providerAcceptanceKey?: string | null;
        providerAcceptanceFingerprint?: string | null;
        providerAcceptanceState?: SmsProviderAcceptanceState;
    }): MessageLogEntity {
        const now = new Date();
        return new MessageLogEntity(
            0,
            params.branchId ?? null,
            params.provider,
            params.templateKey,
            params.triggerJobId ?? null,
            params.receiver,
            params.clientId ?? null,
            params.messageBody,
            params.variables,
            "pending",
            null,
            null,
            0,
            null,
            null,
            now,
            now,
            params.recipientName ?? null,
            params.recipientPhone ?? params.receiver,
            params.providerAcceptanceKey ?? null,
            params.providerAcceptanceFingerprint ?? null,
            params.providerAcceptanceState ?? "legacy",
        );
    }

    static reconstitute(
        id: number,
        branchId: string | null,
        provider: string,
        templateKey: string,
        triggerJobId: string | null,
        receiver: string,
        clientId: number | null,
        messageBody: string,
        variables: Record<string, string>,
        status: MessageLogStatus,
        aligoMid: string | null,
        errorMessage: string | null,
        attempts: number,
        lastAttemptAt: Date | null,
        nextRetryAt: Date | null,
        createdAt: Date,
        updatedAt: Date = createdAt,
        recipientName: string | null = null,
        recipientPhone: string | null = null,
        providerAcceptanceKey: string | null = null,
        providerAcceptanceFingerprint: string | null = null,
        providerAcceptanceState: SmsProviderAcceptanceState = "legacy",
        providerCallStartedAt: Date | null = null,
        providerAcceptedAt: Date | null = null,
        providerReconciledAt: Date | null = null,
        providerReconciledBy: string | null = null,
        providerReconciliationReason: string | null = null,
    ): MessageLogEntity {
        return new MessageLogEntity(
            id, branchId, provider, templateKey, triggerJobId, receiver, clientId,
            messageBody, variables, status, aligoMid, errorMessage, attempts,
            lastAttemptAt, nextRetryAt, createdAt, updatedAt, recipientName, recipientPhone,
            providerAcceptanceKey,
            providerAcceptanceFingerprint,
            providerAcceptanceState,
            providerCallStartedAt,
            providerAcceptedAt,
            providerReconciledAt,
            providerReconciledBy,
            providerReconciliationReason,
        );
    }

    /** Mark the exact persisted attempt as crossing the provider boundary. */
    markProviderCallStarted(now = new Date()): void {
        if (this.providerAcceptanceState !== "prepared") {
            throw new Error(
                `SMS provider acceptance state cannot start from ${this.providerAcceptanceState}`,
            );
        }
        this.providerAcceptanceState = "started";
        this.providerCallStartedAt = now;
        this.updatedAt = now;
    }

    /** Record a provider response while retaining the original fingerprint. */
    recordProviderResult(params: {
        accepted: boolean;
        providerMessageId?: string | null;
        errorMessage?: string | null;
        now?: Date;
    }): void {
        if (this.providerAcceptanceState !== "started") {
            throw new Error(
                `SMS provider result cannot be recorded from ${this.providerAcceptanceState}`,
            );
        }
        const now = params.now ?? new Date();
        this.providerAcceptanceState = params.accepted ? "accepted" : "rejected";
        this.providerAcceptedAt = params.accepted ? now : null;
        this.aligoMid = params.providerMessageId ?? null;
        this.errorMessage = params.accepted ? null : params.errorMessage ?? null;
        this.lastAttemptAt = now;
        this.attempts += 1;
        this.updatedAt = now;
    }

    /**
     * A transport/process failure after the start marker is always uncertain:
     * without a provider receipt we cannot distinguish rejection from
     * acceptance, so no automatic resend is safe.
     */
    markProviderOutcomeUncertain(errorMessage: string, now = new Date()): void {
        if (this.providerAcceptanceState !== "started") {
            throw new Error(
                `SMS provider uncertainty cannot be recorded from ${this.providerAcceptanceState}`,
            );
        }
        this.providerAcceptanceState = "uncertain";
        this.errorMessage = `${errorMessage} ${SMS_UNCERTAIN_RECONCILIATION_MESSAGE}`.trim();
        this.attempts += 1;
        this.lastAttemptAt = now;
        this.providerAcceptedAt = null;
        this.updatedAt = now;
    }

    /** Apply one authoritative operator reconciliation. */
    reconcileProviderOutcome(params: {
        outcome: "delivered" | "not-delivered";
        actor: string;
        reason: string;
        providerMessageId?: string | null;
        now?: Date;
    }): void {
        const actor = params.actor.trim();
        const reason = params.reason.trim();
        const providerMessageId = params.providerMessageId?.trim() || null;
        if (!actor || !reason) {
            throw new Error("SMS provider reconciliation actor and reason are required");
        }
        if (
            actor.length > 200
            || reason.length > 1000
            || (providerMessageId !== null && providerMessageId.length > 200)
        ) {
            throw new Error("SMS provider reconciliation audit fields are too long");
        }
        if (this.providerAcceptanceState !== "started" && this.providerAcceptanceState !== "uncertain") {
            throw new Error(
                `SMS provider reconciliation is not allowed from ${this.providerAcceptanceState}`,
            );
        }

        const now = params.now ?? new Date();
        this.providerAcceptanceState = params.outcome === "delivered"
            ? "reconciled_delivered"
            : "reconciled_not_delivered";
        this.providerReconciledAt = now;
        this.providerReconciledBy = actor;
        this.providerReconciliationReason = reason;
        this.aligoMid = providerMessageId ?? this.aligoMid;
        this.updatedAt = now;
        this.lastAttemptAt = now;

        if (params.outcome === "delivered") {
            this.status = "sent";
            this.errorMessage = null;
            this.nextRetryAt = null;
            this.providerAcceptedAt = this.providerAcceptedAt ?? now;
            this.variables = { ...this.variables, retrySafety: "delivered" };
            return;
        }

        this.status = "failed";
        this.errorMessage = reason;
        this.nextRetryAt = now;
        this.variables = { ...this.variables, retrySafety: "reconciled-not-delivered" };
    }

    canStartProviderCall(): boolean {
        return this.providerAcceptanceState === "prepared";
    }

    isProviderOutcomeUncertain(): boolean {
        return this.providerAcceptanceState === "started" || this.providerAcceptanceState === "uncertain";
    }

    isExplicitlyReconciledNotDelivered(): boolean {
        return this.providerAcceptanceState === "reconciled_not_delivered";
    }
}
