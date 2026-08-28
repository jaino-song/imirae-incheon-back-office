import { Injectable, Optional } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { createHash, randomBytes } from "crypto";
import { PrismaService } from "infrastructure/database/prisma.service";

import { ServiceRecordSecurityEventService } from "./service-record-security-event.service";

export const SERVICE_RECORD_PHONE_CHALLENGE_MAX_FAILED_ATTEMPTS = 5;
export const SERVICE_RECORD_PHONE_CHALLENGE_WINDOW_MS = 15 * 60 * 1000;

/** Resolved context attached to a request after the access token is validated. */
export interface ServiceRecordTokenContext {
    tokenId: string;
    branchId: string;
    scheduleId: number;
    employeeId: number;
    serviceRecordCaseId?: string | null;
}

export type VerifyPhoneResult =
    | { ok: true; accessToken: string }
    | { ok: false; reason: "verification_failed" };


interface ServiceRecordLinkTokenParams {
    branchId: string;
    scheduleId: number;
    employeeId: number;
    serviceRecordCaseId?: string | null;
    expectedPhone: string;
    expiresAt: Date;
}

/**
 * No-login per-assignment service-record access (BJJ-247).
 * Two secrets per token row:
 *   - link token: carried in the SMS URL (possession). Stored plaintext so the issued
 *     form URL can be recovered from the database when needed; only reaches the phone challenge.
 *   - access token: minted after a correct phone number (knowledge). Grants the service-record endpoints
 *     until expiresAt (= schedule.endDate + grace buffer).
 * The access token and expected phone remain sha256 hashes. `linkTokenHash` retains its
 * legacy Prisma/database name even though newly issued form-link values are plaintext.
 */
@Injectable()
export class ServiceRecordTokenService {
    constructor(
        private readonly prismaService: PrismaService,
        @Optional() private readonly securityEventService?: ServiceRecordSecurityEventService,
    ) {}

    private hash(value: string): string {
        return createHash("sha256").update(value).digest("hex");
    }

    /** Strip everything but digits so "010-1234-5678" and "01012345678" compare equal. */
    private normalizePhone(phone: string): string {
        return (phone ?? "").replace(/\D/g, "");
    }

    /**
     * Issue a fresh link for an assignment, revoking any prior active token for the schedule
     * (so a replaced provider's old link stops working). Returns the plaintext link token once.
     */
    async issueLink(params: ServiceRecordLinkTokenParams): Promise<{ linkToken: string }> {
        const linkToken = `efl_${randomBytes(32).toString("base64url")}`;
        await this.prismaService.$transaction(async (tx) => {
            await tx.service_record_token.updateMany({
                where: {
                    active: true,
                    OR: [
                        { scheduleId: params.scheduleId },
                        ...(params.serviceRecordCaseId
                            ? [{ serviceRecordCaseId: params.serviceRecordCaseId }]
                            : []),
                    ],
                },
                data: { active: false, revokedAt: new Date() },
            });
            await tx.service_record_token.create({
                data: {
                    branchId: params.branchId,
                    scheduleId: params.scheduleId,
                    employeeId: params.employeeId,
                    serviceRecordCaseId: params.serviceRecordCaseId,
                    linkTokenHash: linkToken,
                    expectedPhoneHash: this.hash(this.normalizePhone(params.expectedPhone)),
                    expiresAt: params.expiresAt,
                },
            });
        });
        return { linkToken };
    }

    /**
     * Reuse the current provider's active link and only extend its expiry.
     * Provider replacement changes the schedule/employee and revokes the old row,
     * so only an unchanged assignment can match this lookup.
     */
    async reuseActiveLink(
        params: ServiceRecordLinkTokenParams,
        options: { includeLocked?: boolean } = {},
    ): Promise<{ linkToken: string } | null> {
        const includeLocked = options.includeLocked ?? true;
        const record = await this.prismaService.service_record_token.findFirst({
            where: {
                branchId: params.branchId,
                scheduleId: params.scheduleId,
                employeeId: params.employeeId,
                expectedPhoneHash: this.hash(this.normalizePhone(params.expectedPhone)),
                active: true,
                revokedAt: null,
                ...(includeLocked ? {} : { lockedAt: null }),
            },
            orderBy: { createdAt: "desc" },
        });
        if (!record) return null;

        const updated = await this.prismaService.service_record_token.updateMany({
            where: {
                id: record.id,
                branchId: params.branchId,
                scheduleId: params.scheduleId,
                employeeId: params.employeeId,
                expectedPhoneHash: this.hash(this.normalizePhone(params.expectedPhone)),
                active: true,
                revokedAt: null,
                ...(includeLocked ? {} : { lockedAt: null }),
            },
            data: { expiresAt: params.expiresAt },
        });
        if (updated.count === 0) return null;
        return { linkToken: record.linkTokenHash };
    }

    /**
     * Prepare the exact link shown in the admin preview without making it usable yet.
     * The plaintext token is returned once and must stay in the authenticated admin's
     * in-memory form state until send activates this same row.
     */
    async prepareLink(params: ServiceRecordLinkTokenParams): Promise<{ linkToken: string }> {
        const linkToken = `efl_${randomBytes(32).toString("base64url")}`;
        await this.prismaService.service_record_token.create({
            data: {
                branchId: params.branchId,
                scheduleId: params.scheduleId,
                employeeId: params.employeeId,
                serviceRecordCaseId: params.serviceRecordCaseId,
                linkTokenHash: linkToken,
                expectedPhoneHash: this.hash(this.normalizePhone(params.expectedPhone)),
                expiresAt: params.expiresAt,
                active: false,
            },
        });
        return { linkToken };
    }

    /** Activate a prepared link only when it still matches the tenant assignment and phone. */
    async activatePreparedLink(params: ServiceRecordLinkTokenParams & { linkToken: string }): Promise<boolean> {
        const expectedPhoneHash = this.hash(this.normalizePhone(params.expectedPhone));

        return this.prismaService.$transaction(async (tx) => {
            const record = await this.findByLinkToken(params.linkToken, tx);
            if (
                !record
                || record.revokedAt
                || record.expiresAt.getTime() < Date.now()
                || record.branchId !== params.branchId
                || record.scheduleId !== params.scheduleId
                || record.employeeId !== params.employeeId
                || record.expectedPhoneHash !== expectedPhoneHash
            ) {
                return false;
            }

            if (!record.active) {
                await tx.service_record_token.updateMany({
                    where: {
                        active: true,
                        OR: [
                            { scheduleId: params.scheduleId },
                            ...(record.serviceRecordCaseId
                                ? [{ serviceRecordCaseId: record.serviceRecordCaseId }]
                                : []),
                        ],
                    },
                    data: { active: false, revokedAt: new Date() },
                });
            }

            await tx.service_record_token.update({
                where: { id: record.id },
                data: {
                    active: true,
                    revokedAt: null,
                    expiresAt: params.expiresAt,
                },
            });
            return true;
        });
    }

    /** Resolve a usable (active, not revoked, not expired, not locked) link-token row, else null. */
    async resolveLink(linkToken: string) {
        const record = await this.findByLinkToken(linkToken, this.prismaService);
        if (
            !record
            || !record.active
            || record.revokedAt
            || record.lockedAt
            || record.failedAttempts >= SERVICE_RECORD_PHONE_CHALLENGE_MAX_FAILED_ATTEMPTS
            || record.expiresAt.getTime() < Date.now()
        ) {
            return null;
        }
        return record;
    }

    /** Resolve form links by their plaintext database value. */
    private async findByLinkToken(linkToken: string, client: Prisma.TransactionClient | PrismaService) {
        return client.service_record_token.findUnique({
            where: { linkTokenHash: linkToken },
        });
    }

    /**
     * Lock the challenge row before reading its attempt state. The fallback keeps
     * unit-test doubles and old adapters compatible; production Prisma always has
     * `$queryRaw`, so concurrent guesses serialize on this row lock.
     */
    private async findAndLockByLinkToken(linkToken: string, tx: Prisma.TransactionClient) {
        const transaction = tx as Prisma.TransactionClient & {
            $queryRaw?: <T>(query: Prisma.Sql) => Promise<T>;
        };
        if (typeof transaction.$queryRaw !== "function") {
            return this.findByLinkToken(linkToken, tx);
        }

        const rows = await transaction.$queryRaw<Array<{ id: string }>>(Prisma.sql`
            SELECT "id"
            FROM "service_record_token"
            WHERE "link_token_hash" = ${linkToken}
            FOR UPDATE
        `);
        const [row] = rows;
        return row
            ? tx.service_record_token.findUnique({ where: { id: row.id } })
            : null;
    }

    private unavailable(reason: "invalid_token" | "expired" | "locked"): VerifyPhoneResult {
        this.securityEventService?.emit({
            outcome: "challenge_unavailable",
            reason,
        });
        return { ok: false, reason: "verification_failed" };
    }

    private emitChallengeEvent(
        record: {
            id: string;
            branchId: string;
            scheduleId: number;
            employeeId: number;
        },
        outcome: "challenge_failed" | "challenge_locked" | "challenge_succeeded",
        failedAttempts: number,
    ): void {
        this.securityEventService?.emit({
            outcome,
            tokenId: record.id,
            branchId: record.branchId,
            scheduleId: record.scheduleId,
            employeeId: record.employeeId,
            failedAttempts,
        });
    }

    /**
     * Verify a phone number against the link token. On success mint + persist a new access token.
     * Wrong phone numbers consume a finite per-link budget in a fifteen-minute window.
     * The fifth failed guess locks the link until an authenticated admin reissues it.
     *
     * expectedPhoneHash is a snapshot taken at link issuance. If the employee's phone was
     * corrected in admin after issuance, the snapshot goes stale, so a mismatch falls back to
     * the live employee record: a phone matching the employee's current number verifies and
     * heals the snapshot. Links issued to an explicit override phone keep working through the
     * snapshot compare and are never loosened — the fallback only ever accepts the live phone.
     */
    async verifyPhoneAndMintAccess(linkToken: string, phone: string): Promise<VerifyPhoneResult> {
        const submittedPhoneHash = this.hash(this.normalizePhone(phone));
        return this.prismaService.$transaction(async (tx) => {
            const record = await this.findAndLockByLinkToken(linkToken, tx);
            if (!record) return this.unavailable("invalid_token");

            const now = new Date();
            if (!record.active || record.revokedAt) return this.unavailable("invalid_token");
            if (record.expiresAt.getTime() < now.getTime()) return this.unavailable("expired");
            if (record.lockedAt) return this.unavailable("locked");

            let failedAttempts = record.failedAttempts;
            let challengeWindowStartedAt = record.challengeWindowStartedAt;

            // Legacy rows may carry an audit count without the new lock marker. Never
            // let such a row mint access after the finite budget has already been spent.
            if (failedAttempts >= SERVICE_RECORD_PHONE_CHALLENGE_MAX_FAILED_ATTEMPTS) {
                await tx.service_record_token.update({
                    where: { id: record.id },
                    data: {
                        lockedAt: now,
                        accessTokenHash: null,
                        verifiedAt: null,
                    },
                });
                this.emitChallengeEvent(record, "challenge_locked", failedAttempts);
                return { ok: false, reason: "verification_failed" };
            }

            if (
                challengeWindowStartedAt
                && now.getTime() - challengeWindowStartedAt.getTime() >= SERVICE_RECORD_PHONE_CHALLENGE_WINDOW_MS
            ) {
                failedAttempts = 0;
                challengeWindowStartedAt = null;
                await tx.service_record_token.update({
                    where: { id: record.id },
                    data: {
                        failedAttempts: 0,
                        challengeWindowStartedAt: null,
                    },
                });
            }

            let healedPhoneHash: string | null = null;
            if (submittedPhoneHash !== record.expectedPhoneHash) {
                const employee = await tx.employee.findFirst({
                    where: { id: record.employeeId, deletedAt: null },
                    select: { phone: true },
                });
                const livePhone = this.normalizePhone(employee?.phone ?? "");
                if (!livePhone || this.hash(livePhone) !== submittedPhoneHash) {
                    const nextFailedAttempts = failedAttempts + 1;
                    const shouldLock = nextFailedAttempts >= SERVICE_RECORD_PHONE_CHALLENGE_MAX_FAILED_ATTEMPTS;
                    await tx.service_record_token.update({
                        where: { id: record.id },
                        data: {
                            failedAttempts: nextFailedAttempts,
                            challengeWindowStartedAt: challengeWindowStartedAt ?? now,
                            ...(shouldLock
                                ? {
                                    lockedAt: now,
                                    accessTokenHash: null,
                                    verifiedAt: null,
                                }
                                : {}),
                        },
                    });
                    this.emitChallengeEvent(
                        record,
                        shouldLock ? "challenge_locked" : "challenge_failed",
                        nextFailedAttempts,
                    );
                    return { ok: false, reason: "verification_failed" };
                }
                healedPhoneHash = submittedPhoneHash;
            }

            const accessToken = `efa_${randomBytes(32).toString("base64url")}`;
            await tx.service_record_token.update({
                where: { id: record.id },
                data: {
                    accessTokenHash: this.hash(accessToken),
                    verifiedAt: now,
                    failedAttempts: 0,
                    challengeWindowStartedAt: null,
                    lockedAt: null,
                    ...(healedPhoneHash ? { expectedPhoneHash: healedPhoneHash } : {}),
                },
            });
            this.emitChallengeEvent(record, "challenge_succeeded", failedAttempts);
            return { ok: true, accessToken };
        });
    }

    /** Resolve a usable access token to its assignment context, else null. */
    async resolveAccess(accessToken: string): Promise<ServiceRecordTokenContext | null> {
        const record = await this.prismaService.service_record_token.findUnique({
            where: { accessTokenHash: this.hash(accessToken) },
        });
        if (
            !record ||
            !record.active ||
            record.revokedAt ||
            !record.verifiedAt ||
            record.lockedAt ||
            record.failedAttempts >= SERVICE_RECORD_PHONE_CHALLENGE_MAX_FAILED_ATTEMPTS ||
            record.expiresAt.getTime() < Date.now()
        ) {
            return null;
        }
        return {
            tokenId: record.id,
            branchId: record.branchId,
            scheduleId: record.scheduleId,
            employeeId: record.employeeId,
            ...(record.serviceRecordCaseId
                ? { serviceRecordCaseId: record.serviceRecordCaseId }
                : {}),
        };
    }

    async extendExpiryForSchedule(scheduleId: number, newExpiresAt: Date, tx?: Prisma.TransactionClient): Promise<void> {
        await (tx ?? this.prismaService).service_record_token.updateMany({
            where: { scheduleId, active: true, revokedAt: null },
            data: { expiresAt: newExpiresAt },
        });
    }

    async extendExpiryForCase(serviceRecordCaseId: string, newExpiresAt: Date, tx?: Prisma.TransactionClient): Promise<void> {
        await (tx ?? this.prismaService).service_record_token.updateMany({
            where: { serviceRecordCaseId, active: true, revokedAt: null },
            data: { expiresAt: newExpiresAt },
        });
    }

    /** Revoke every active token for an assignment (replacement / termination). */
    async revokeForSchedule(scheduleId: number): Promise<void> {
        await this.prismaService.service_record_token.updateMany({
            where: { scheduleId, active: true },
            data: { active: false, revokedAt: new Date() },
        });
    }
}
