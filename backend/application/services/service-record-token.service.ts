import { Injectable, Logger } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { createHash, randomBytes } from "crypto";
import { PrismaService } from "infrastructure/database/prisma.service";

/** Resolved context attached to a request after the access token is validated. */
export interface ServiceRecordTokenContext {
    tokenId: string;
    branchId: string;
    scheduleId: number;
    employeeId: number;
    serviceRecordCaseId?: string | null;
    accessMode?: "admin_header_edit";
    linkToken?: string;
}

export type VerifyPhoneResult =
    | { ok: true; accessToken: string }
    | { ok: false; reason: "invalid_token" | "wrong_phone" };


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
    private readonly logger = new Logger(ServiceRecordTokenService.name);

    constructor(private readonly prismaService: PrismaService) {}

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
    async reuseActiveLink(params: ServiceRecordLinkTokenParams): Promise<{ linkToken: string } | null> {
        const record = await this.prismaService.service_record_token.findFirst({
            where: {
                branchId: params.branchId,
                scheduleId: params.scheduleId,
                employeeId: params.employeeId,
                expectedPhoneHash: this.hash(this.normalizePhone(params.expectedPhone)),
                active: true,
                revokedAt: null,
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

    /** Resolve a usable (active, not revoked, not expired) link-token row, else null. */
    async resolveLink(linkToken: string) {
        const record = await this.findByLinkToken(linkToken, this.prismaService);
        if (!record || !record.active || record.revokedAt || record.expiresAt.getTime() < Date.now()) {
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
     * Verify a phone number against the link token. On success mint + persist a new access token.
     * Wrong phone numbers may be retried without limit — the attempt count is kept for audit only.
     */
    async verifyPhoneAndMintAccess(linkToken: string, phone: string): Promise<VerifyPhoneResult> {
        const record = await this.resolveLink(linkToken);
        if (!record) return { ok: false, reason: "invalid_token" };

        if (this.hash(this.normalizePhone(phone)) !== record.expectedPhoneHash) {
            await this.prismaService.service_record_token.update({
                where: { id: record.id },
                data: { failedAttempts: { increment: 1 } },
            });
            return { ok: false, reason: "wrong_phone" };
        }

        const accessToken = `efa_${randomBytes(32).toString("base64url")}`;
        await this.prismaService.service_record_token.update({
            where: { id: record.id },
            data: { accessTokenHash: this.hash(accessToken), verifiedAt: new Date(), failedAttempts: 0 },
        });
        return { ok: true, accessToken };
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
