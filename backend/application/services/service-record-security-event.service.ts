import { Injectable, Logger } from "@nestjs/common";

export type ServiceRecordSecurityEventOutcome =
    | "challenge_failed"
    | "challenge_locked"
    | "challenge_succeeded"
    | "challenge_unavailable"
    | "link_reissued";

export interface ServiceRecordSecurityEventInput {
    outcome: ServiceRecordSecurityEventOutcome;
    reason?: "invalid_token" | "expired" | "locked";
    branchId?: string | null;
    scheduleId?: number | null;
    employeeId?: number | null;
    tokenId?: string | null;
    actorUserId?: string | null;
    failedAttempts?: number | null;
    correlationId?: string;
}

/**
 * Structured security telemetry for the no-login service-record flow.
 *
 * This boundary intentionally accepts only identifiers and counters. Link tokens,
 * access tokens, phone numbers, and other challenge material cannot be passed to
 * the writer and therefore cannot leak into logs.
 */
@Injectable()
export class ServiceRecordSecurityEventService {
    private readonly logger = new Logger(ServiceRecordSecurityEventService.name);

    emit(input: ServiceRecordSecurityEventInput): void {
        this.logger.warn(JSON.stringify({
            event: "service_record_phone_challenge",
            ...input,
            at: new Date().toISOString(),
        }));
    }
}
