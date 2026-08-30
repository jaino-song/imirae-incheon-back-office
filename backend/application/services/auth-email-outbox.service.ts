import { Inject, Injectable, Logger } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import { Prisma } from "@prisma/client";

import {
    EMAIL_PORT,
    EmailPort,
    EmailProviderError,
} from "domain/ports/email.port";
import { PrismaService } from "infrastructure/database/prisma.service";
import { AuthEmailTokenService } from "./auth-email-token.service";

const MAX_DELIVERY_ATTEMPTS = 5;
const STARTED_ATTEMPT_TIMEOUT_MINUTES = 5;

type ClaimedEmail = {
    id: string;
    auth_token_id: string;
    kind: string;
    recipient: string;
    name: string | null;
    attempts: number;
    attempt_version: number;
    provider_idempotency_key: string;
};

export interface AuthEmailOutboxReconciliationInput {
    id: string;
    attemptVersion: number;
    outcome: "accepted" | "not_delivered";
    reason: string;
    providerMessageId?: string;
}

class AuthTokenUnavailableError extends Error {
    constructor() {
        super("auth_token_invalid");
        this.name = "AuthTokenUnavailableError";
    }
}

@Injectable()
export class AuthEmailOutboxService {
    private readonly logger = new Logger(AuthEmailOutboxService.name);

    constructor(
        private readonly prisma: PrismaService,
        private readonly tokens: AuthEmailTokenService,
        @Inject(EMAIL_PORT) private readonly email: EmailPort,
    ) {}

    @Cron("*/5 * * * * *")
    async deliverPending(): Promise<void> {
        const claimed = await this.claimBatch(20);
        for (const item of claimed) {
            await this.deliver(item);
        }
    }

    /**
     * Reconcile an uncertain row after an operator or provider lookup proves
     * the outcome. This is intentionally CAS fenced and never calls the
     * provider, so it cannot create a duplicate delivery.
     */
    async reconcile(input: AuthEmailOutboxReconciliationInput): Promise<boolean> {
        const reason = input.reason.trim().slice(0, 1000);
        if (!reason) {
            throw new Error("reconciliation_reason_required");
        }
        if (input.outcome !== "accepted" && input.outcome !== "not_delivered") {
            throw new Error("reconciliation_outcome_invalid");
        }

        if (input.outcome === "accepted") {
            const providerMessageId = input.providerMessageId?.trim();
            if (!providerMessageId) {
                throw new Error("provider_message_id_required");
            }

            const result = await this.prisma.auth_email_outbox.updateMany({
                where: {
                    id: input.id,
                    status: "uncertain",
                    attemptVersion: input.attemptVersion,
                },
                data: {
                    status: "accepted",
                    providerMessageId: providerMessageId.slice(0, 255),
                    providerAcceptedAt: new Date(),
                    sentAt: new Date(),
                    claimedAt: null,
                    nextAttemptAt: new Date(),
                    errorCode: null,
                    uncertainAt: null,
                    uncertainReason: null,
                },
            });
            return result.count === 1;
        }

        const result = await this.prisma.auth_email_outbox.updateMany({
            where: {
                id: input.id,
                status: "uncertain",
                attemptVersion: input.attemptVersion,
            },
            data: {
                status: "failed",
                claimedAt: null,
                nextAttemptAt: new Date(),
                errorCode: "reconciled_not_delivered",
                uncertainReason: reason,
            },
        });
        return result.count === 1;
    }

    private async claimBatch(limit: number): Promise<ClaimedEmail[]> {
        return this.prisma.$transaction(async (tx) => {
            // A worker that disappeared after the started marker leaves an
            // ambiguous provider outcome. Fence it as uncertain; never make
            // it eligible for another provider call automatically.
            await tx.$executeRaw(Prisma.sql`
                UPDATE "auth_email_outbox" AS outbox
                SET
                    "status" = 'uncertain',
                    "claimed_at" = NULL,
                    "uncertain_at" = COALESCE("uncertain_at", NOW()),
                    "uncertain_reason" = COALESCE(
                        "uncertain_reason",
                        'worker_attempt_expired_requires_reconciliation'
                    ),
                    "error_code" = 'provider_uncertain',
                    "updated_at" = NOW()
                WHERE outbox."status" IN ('started', 'processing')
                  AND (
                      outbox."claimed_at" IS NULL
                      OR outbox."claimed_at" <= NOW() - (${STARTED_ATTEMPT_TIMEOUT_MINUTES} * INTERVAL '1 minute')
                  )
            `);

            // Pending is a pre-boundary legacy state and can converge to the
            // prepared state. A legacy retry is ambiguous (the old worker
            // could have received provider acceptance before its DB update
            // failed), so fence it as uncertain before selecting candidates.
            await tx.$executeRaw(Prisma.sql`
                UPDATE "auth_email_outbox"
                SET
                    "status" = 'prepared',
                    "updated_at" = NOW()
                WHERE "status" = 'pending'
            `);

            await tx.$executeRaw(Prisma.sql`
                UPDATE "auth_email_outbox"
                SET
                    "status" = 'uncertain',
                    "claimed_at" = NULL,
                    "uncertain_at" = COALESCE("uncertain_at", NOW()),
                    "uncertain_reason" = COALESCE(
                        "uncertain_reason",
                        'legacy_retry_requires_reconciliation'
                    ),
                    "error_code" = 'provider_uncertain',
                    "updated_at" = NOW()
                WHERE "status" = 'retry'
            `);

            // Token invalidation is a known pre-send failure. It is safe to
            // close these rows as failed because no provider call can happen.
            await tx.$executeRaw(Prisma.sql`
                UPDATE "auth_email_outbox" AS outbox
                SET
                    "status" = 'failed',
                    "claimed_at" = NULL,
                    "error_code" = 'auth_token_invalid',
                    "updated_at" = NOW()
                WHERE outbox."status" = 'prepared'
                  AND NOT EXISTS (
                      SELECT 1
                      FROM "auth_token" AS token
                      WHERE token."id" = outbox."auth_token_id"
                        AND token."type" = outbox."kind"
                        AND token."used_at" IS NULL
                        AND token."expires_at" > NOW()
                  )
            `);

            return tx.$queryRaw<ClaimedEmail[]>(Prisma.sql`
                WITH candidates AS (
                    SELECT outbox."id"
                    FROM "auth_email_outbox" AS outbox
                    WHERE outbox."status" = 'prepared'
                      AND outbox."attempts" < ${MAX_DELIVERY_ATTEMPTS}
                      AND outbox."next_attempt_at" <= NOW()
                      AND EXISTS (
                          SELECT 1
                          FROM "auth_token" AS token
                          WHERE token."id" = outbox."auth_token_id"
                            AND token."type" = outbox."kind"
                            AND token."used_at" IS NULL
                            AND token."expires_at" > NOW()
                      )
                    ORDER BY outbox."created_at" ASC
                    FOR UPDATE SKIP LOCKED
                    LIMIT ${limit}
                )
                UPDATE "auth_email_outbox" AS outbox
                SET
                    "status" = 'started',
                    "claimed_at" = NOW(),
                    "provider_started_at" = NOW(),
                    "attempts" = outbox."attempts" + 1,
                    "attempt_version" = outbox."attempt_version" + 1,
                    "updated_at" = NOW()
                FROM candidates
                WHERE outbox."id" = candidates."id"
                RETURNING
                    outbox."id",
                    outbox."auth_token_id",
                    outbox."kind",
                    outbox."recipient",
                    outbox."name",
                    outbox."attempts",
                    outbox."attempt_version",
                    outbox."provider_idempotency_key"
            `);
        });
    }

    private async deliver(item: ClaimedEmail): Promise<void> {
        let providerCallStarted = false;
        let providerMessageId: string | undefined;

        try {
            const valid = await this.isClaimStillValid(item);
            if (!valid) {
                throw new AuthTokenUnavailableError();
            }

            const publicToken = this.tokens.publicTokenForId(item.auth_token_id);
            providerCallStarted = true;
            providerMessageId = await this.sendEmail(item, publicToken);
            providerMessageId = providerMessageId.trim();
            if (!providerMessageId) {
                throw new EmailProviderError("provider_acceptance_missing_id", "unknown");
            }

            const completed = await this.markAccepted(item, providerMessageId);
            if (completed !== 1) {
                this.logger.warn(JSON.stringify({
                    event: "auth_email_outbox",
                    result: "stale_attempt_completion_ignored",
                    outboxId: item.id,
                    attemptVersion: item.attempt_version,
                }));
                return;
            }

            this.logger.log(JSON.stringify({
                event: "auth_email_outbox",
                result: "accepted",
                kind: item.kind,
                outboxId: item.id,
                attemptVersion: item.attempt_version,
            }));
        } catch (error) {
            const retryable = error instanceof EmailProviderError
                ? error.stage === "pre_send"
                : !providerCallStarted;
            if (retryable) {
                await this.releaseBeforeSend(item, error);
                return;
            }

            await this.markUncertain(item, error, providerMessageId);
        }
    }

    /**
     * Complete only the attempt that staged the provider call. A row/status
     * match alone is insufficient because another worker may own a newer
     * attempt by the time the provider responds.
     */
    private async markAccepted(item: ClaimedEmail, providerMessageId: string): Promise<number> {
        const result = await this.prisma.auth_email_outbox.updateMany({
            where: {
                id: item.id,
                status: "started",
                attemptVersion: item.attempt_version,
                providerIdempotencyKey: item.provider_idempotency_key,
            },
            data: {
                status: "accepted",
                providerMessageId: providerMessageId.slice(0, 255),
                providerAcceptedAt: new Date(),
                sentAt: new Date(),
                claimedAt: null,
                nextAttemptAt: new Date(),
                errorCode: null,
                uncertainAt: null,
                uncertainReason: null,
            },
        });
        return result.count;
    }

    private async isClaimStillValid(item: ClaimedEmail): Promise<boolean> {
        const valid = await this.prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`
            SELECT outbox."id"
            FROM "auth_email_outbox" AS outbox
            JOIN "auth_token" AS token
              ON token."id" = outbox."auth_token_id"
            WHERE outbox."id" = CAST(${item.id} AS UUID)
              AND outbox."status" = 'started'
              AND outbox."attempt_version" = ${item.attempt_version}
              AND outbox."provider_idempotency_key" = ${item.provider_idempotency_key}
              AND token."id" = CAST(${item.auth_token_id} AS UUID)
              AND token."type" = ${item.kind}
              AND token."used_at" IS NULL
              AND token."expires_at" > NOW()
        `);
        return valid.length === 1;
    }

    private async sendEmail(item: ClaimedEmail, publicToken: string): Promise<string> {
        const idempotency = { idempotencyKey: item.provider_idempotency_key };
        if (item.kind === "email_verification") {
            const url = `${this.frontendUrl()}/verify-email?token=${encodeURIComponent(publicToken)}`;
            return this.email.sendVerificationEmail(item.recipient, item.name, url, idempotency);
        }
        if (item.kind === "password_reset") {
            const url = `${this.frontendUrl()}/reset-password?token=${encodeURIComponent(publicToken)}`;
            return this.email.sendPasswordResetEmail(item.recipient, item.name, url, idempotency);
        }
        throw new EmailProviderError("unsupported_outbox_kind", "pre_send");
    }

    /**
     * Release an attempt only when the provider boundary was not crossed.
     * This CAS is deliberately versioned so an old worker cannot reopen a
     * newer attempt after a concurrent claim.
     */
    private async releaseBeforeSend(item: ClaimedEmail, error: unknown): Promise<void> {
        const exhausted = item.attempts >= MAX_DELIVERY_ATTEMPTS;
        const retryDelayMs = Math.min(
            60 * 60 * 1000,
            30_000 * 2 ** Math.max(0, item.attempts - 1),
        );

        try {
            await this.prisma.auth_email_outbox.updateMany({
                where: {
                    id: item.id,
                    status: "started",
                    attemptVersion: item.attempt_version,
                    providerIdempotencyKey: item.provider_idempotency_key,
                },
                data: {
                    status: exhausted ? "failed" : "prepared",
                    claimedAt: null,
                    nextAttemptAt: new Date(Date.now() + retryDelayMs),
                    errorCode: error instanceof AuthTokenUnavailableError
                        ? "auth_token_invalid"
                        : this.safeErrorCode(error),
                },
            });
        } catch (persistError) {
            this.logger.error(JSON.stringify({
                event: "auth_email_outbox",
                result: "pre_send_failure_persistence_failed",
                outboxId: item.id,
                attemptVersion: item.attempt_version,
                error: this.safeErrorCode(persistError),
            }));
        }
    }

    private async markUncertain(
        item: ClaimedEmail,
        error: unknown,
        providerMessageId?: string,
    ): Promise<void> {
        try {
            await this.prisma.auth_email_outbox.updateMany({
                where: {
                    id: item.id,
                    status: "started",
                    attemptVersion: item.attempt_version,
                    providerIdempotencyKey: item.provider_idempotency_key,
                },
                data: {
                    status: "uncertain",
                    claimedAt: null,
                    nextAttemptAt: new Date(),
                    providerMessageId: providerMessageId?.slice(0, 255) ?? null,
                    errorCode: "provider_uncertain",
                    uncertainAt: new Date(),
                    uncertainReason: this.safeErrorCode(error),
                },
            });
        } catch (persistError) {
            this.logger.error(JSON.stringify({
                event: "auth_email_outbox",
                result: "uncertain_persistence_failed",
                outboxId: item.id,
                attemptVersion: item.attempt_version,
                error: this.safeErrorCode(persistError),
            }));
        }
    }

    private frontendUrl(): string {
        if (process.env["NODE_ENV"] === "production") {
            return process.env["PRODUCTION_FRONTEND_URL"] || "http://localhost:3000";
        }
        if (process.env["NODE_ENV"] === "preview") {
            return process.env["PREVIEW_FRONTEND_URL"] || "http://localhost:3000";
        }
        return process.env["DEVELOPMENT_FRONTEND_URL"] || "http://localhost:3000";
    }

    private safeErrorCode(error: unknown): string {
        if (error instanceof EmailProviderError) {
            return error.message.replace(/[^A-Za-z0-9_:-]/g, "_").slice(0, 64);
        }
        const name = error instanceof Error ? error.name : "UnknownError";
        return name.replace(/[^A-Za-z0-9_:-]/g, "_").slice(0, 64);
    }
}
