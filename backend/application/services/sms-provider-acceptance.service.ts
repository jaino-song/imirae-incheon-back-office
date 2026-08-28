import { ConflictException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { createHash } from "node:crypto";
import {
    MessageLogEntity,
    SmsProviderAcceptanceState,
} from "domain/entities/message-log.entity";
import {
    IMessageLogRepository,
    MESSAGE_LOG_REPOSITORY,
} from "domain/repositories/message-log.repository.interface";

const MAX_IDEMPOTENCY_KEY_LENGTH = 200;

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

function digest(value: unknown): string {
    return createHash("sha256").update(stableJson(value)).digest("hex");
}

/**
 * Build an opaque, deterministic logical identity.  The raw recipient and
 * message body never appear in the returned key or in logs.
 */
export function buildSmsProviderAcceptanceKey(scope: string, logicalIdentity: string): string {
    const normalizedScope = scope.trim();
    const normalizedIdentity = logicalIdentity.trim();
    if (!normalizedScope || !normalizedIdentity) {
        throw new Error("SMS provider acceptance scope and identity are required");
    }
    if (normalizedIdentity.length > MAX_IDEMPOTENCY_KEY_LENGTH) {
        throw new Error("SMS provider acceptance identity is too long");
    }
    return `sms:${digest({ scope: normalizedScope, identity: normalizedIdentity })}`;
}

/** Return an opaque fingerprint for the exact provider-bound request. */
export function buildSmsProviderAcceptanceFingerprint(input: Record<string, unknown>): string {
    return digest(input);
}

export type SmsProviderReconciliationOutcome = "delivered" | "not-delivered";

export interface SmsProviderReconciliationInput {
    branchId: string;
    logId: number;
    outcome: SmsProviderReconciliationOutcome;
    actor: string;
    reason: string;
    providerMessageId?: string | null;
}

/**
 * Owns the local half of the SMS provider acceptance boundary.  It does not
 * send requests or assert provider idempotency; it only makes the local
 * attempt durable, fences the network crossing, and exposes a bounded
 * authoritative reconciliation seam.
 */
@Injectable()
export class SmsProviderAcceptanceService {
    constructor(
        @Inject(MESSAGE_LOG_REPOSITORY)
        private readonly logRepository: IMessageLogRepository,
    ) {}

    async prepare(log: MessageLogEntity): Promise<MessageLogEntity> {
        if (log.providerAcceptanceState !== "prepared") {
            throw new ConflictException(
                `SMS provider attempt is not prepared (${log.providerAcceptanceState})`,
            );
        }
        const repository = this.logRepository as IMessageLogRepository & {
            prepareProviderAttempt?: (attempt: MessageLogEntity) => Promise<MessageLogEntity>;
        };
        if (typeof repository.prepareProviderAttempt === "function") {
            return repository.prepareProviderAttempt(log);
        }

        // Compatibility fallback for isolated unit doubles and legacy
        // repository implementations. Production uses the transactional
        // implementation above.
        return this.logRepository.save(log);
    }

    async beginProviderCall(log: MessageLogEntity): Promise<MessageLogEntity> {
        if (log.providerAcceptanceState !== "prepared") {
            throw new ConflictException(
                `SMS provider attempt cannot start from ${log.providerAcceptanceState}`,
            );
        }

        const repository = this.logRepository as IMessageLogRepository & {
            claimProviderAttempt?: (attempt: MessageLogEntity) => Promise<MessageLogEntity | null>;
        };
        if (typeof repository.claimProviderAttempt === "function") {
            const claimed = await repository.claimProviderAttempt(log);
            if (!claimed) {
                throw new ConflictException("SMS provider attempt is already claimed or no longer prepared");
            }
            return claimed;
        }

        log.markProviderCallStarted();
        await this.logRepository.update(log);
        return log;
    }

    async persist(log: MessageLogEntity): Promise<MessageLogEntity> {
        return this.logRepository.update(log);
    }

    async reconcile(input: SmsProviderReconciliationInput): Promise<MessageLogEntity> {
        const actor = input.actor.trim();
        const reason = input.reason.trim();
        const providerMessageId = input.providerMessageId?.trim() || null;
        if (!actor || !reason) {
            throw new ConflictException("SMS provider reconciliation actor and reason are required");
        }
        if (providerMessageId && providerMessageId.length > 200) {
            throw new ConflictException("SMS provider reconciliation provider message id is too long");
        }
        if (input.outcome !== "delivered" && input.outcome !== "not-delivered") {
            throw new ConflictException("SMS provider reconciliation outcome is invalid");
        }

        const source = await this.logRepository.findByIdInBranch(input.branchId, input.logId);
        if (!source || source.provider !== "aligo_sms") {
            throw new NotFoundException("재조정할 문자 발송 기록을 찾을 수 없습니다.");
        }

        const existingOutcome = this.reconciledOutcome(source.providerAcceptanceState);
        if (existingOutcome) {
            if (existingOutcome === input.outcome) return source;
            throw new ConflictException("SMS provider reconciliation is immutable");
        }
        if (!source.canReconcileProviderOutcome()) {
            throw new ConflictException(
                `SMS provider reconciliation is not allowed from ${source.providerAcceptanceState}`,
            );
        }

        const repository = this.logRepository as IMessageLogRepository & {
            reconcileProviderAttempt?: (
                attempt: MessageLogEntity,
                outcome: SmsProviderReconciliationOutcome,
                actor: string,
                reason: string,
                providerMessageId?: string | null,
            ) => Promise<MessageLogEntity | null>;
        };
        if (typeof repository.reconcileProviderAttempt === "function") {
            const reconciled = await repository.reconcileProviderAttempt(
                source,
                input.outcome,
                actor,
                reason,
                providerMessageId,
            );
            if (!reconciled) {
                throw new ConflictException("SMS provider reconciliation raced with another transition");
            }
            return reconciled;
        }

        source.reconcileProviderOutcome({
            outcome: input.outcome,
            actor,
            reason,
            providerMessageId,
        });
        return this.logRepository.update(source);
    }

    private reconciledOutcome(state: SmsProviderAcceptanceState): SmsProviderReconciliationOutcome | null {
        if (state === "reconciled_delivered") return "delivered";
        if (state === "reconciled_not_delivered") return "not-delivered";
        return null;
    }
}
