import { Inject, Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import {
    IReceiptLinkTokenRepository,
    RECEIPT_LINK_MAX_FAILED_ATTEMPTS,
    RECEIPT_LINK_TOKEN_REPOSITORY,
    ReceiptLinkTokenRecord,
} from "domain/repositories/receipt-link-token.repository.interface";

export { RECEIPT_LINK_MAX_FAILED_ATTEMPTS };
export const RECEIPT_LINK_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const RECEIPT_LINK_LOCK_MS = 30 * 60 * 1000;

export type ReceiptLinkSource = "auto_trigger" | "manual";

export interface IssueReceiptLinkTokenParams {
    branchId: string;
    clientId: number;
    eformsignDocId: number;
    jobId?: string | null;
    /** 산모 생년월일 — 6자리(YYMMDD) 또는 8자리(YYYYMMDD). normalizeBirthdayInput으로 정규화 후 해시된다;
     *  정규화에 실패하면 issue()가 던진다. */
    birthday: string;
    storagePath: string;
    contentSha256: string;
    byteSize: number;
    source: ReceiptLinkSource;
    createdBy?: string | null;
    now?: Date;
}

export interface IssuedReceiptLinkToken {
    id: string;
    linkToken: string;
    expiresAt: Date;
}

export type ReceiptLinkUnusableReason = "not_found" | "expired" | "revoked";

export type ReceiptLinkStatus =
    | {
          ok: true;
          state: "pending" | "verified";
          branchName: string;
          expiresAt: string;
          remainingAttempts: number;
          lockedUntil: string | null;
      }
    | { ok: false; reason: ReceiptLinkUnusableReason };

export type VerifyReceiptBirthdayResult =
    | { ok: true; accessToken: string; clientName: string }
    | { ok: false; reason: "verification_failed"; remainingAttempts: number }
    | { ok: false; reason: "locked"; lockedUntil: string }
    | { ok: false; reason: "invalid_format" }
    | { ok: false; reason: ReceiptLinkUnusableReason };

export interface ReceiptLinkAccess {
    id: string;
    storagePath: string;
    clientName: string;
    expiresAt: Date;
}

const DEFAULT_CLIENT_NAME = "산모";

/** 6자리 그대로, 8자리(YYYYMMDD)는 뒤 6자리, 그 외는 null. 숫자 외 문자는 무시. */
export function normalizeBirthdayInput(raw: string): string | null {
    const digits = (raw ?? "").replace(/\D/g, "");
    if (digits.length === 6) return digits;
    if (digits.length === 8) return digits.slice(2);
    return null;
}

function sha256(value: string): string {
    return createHash("sha256").update(value).digest("hex");
}

/** Constant-time hex-digest comparison. Birthday and access-token hashes must never leak, via
 *  comparison timing, how many leading bytes of a guess matched. */
function timingSafeEqualHex(a: string, b: string): boolean {
    const bufA = Buffer.from(a, "hex");
    const bufB = Buffer.from(b, "hex");
    if (bufA.length !== bufB.length) return false;
    return timingSafeEqual(bufA, bufB);
}

@Injectable()
export class ReceiptLinkTokenService {
    private readonly salt: string;

    constructor(
        @Inject(RECEIPT_LINK_TOKEN_REPOSITORY) private readonly repository: IReceiptLinkTokenRepository,
        configService: ConfigService,
    ) {
        this.salt = configService.get<string>("RECEIPT_LINK_HASH_SALT", "") ?? "";
    }

    /** Fail closed: a birthday hash must never be computed without a configured salt. */
    private requireSalt(): string {
        if (!this.salt) {
            throw new Error(
                "RECEIPT_LINK_HASH_SALT is not configured; refusing to hash a birthday without a salt",
            );
        }
        return this.salt;
    }

    private hashBirthday(yymmdd: string): string {
        return sha256(`${this.requireSalt()}:${yymmdd}`);
    }

    async issue(params: IssueReceiptLinkTokenParams): Promise<IssuedReceiptLinkToken> {
        // Must normalize before hashing: verifyBirthday always normalizes its input first, so an
        // un-normalized expected hash (e.g. from an 8-digit or malformed birthday) would mint a
        // link nobody could ever open.
        const birthday = normalizeBirthdayInput(params.birthday);
        if (!birthday) {
            throw new Error("issue: birthday must be YYMMDD (6 digits)");
        }

        const now = params.now ?? new Date();
        const linkToken = `efr_${randomBytes(32).toString("base64url")}`;
        const expiresAt = new Date(now.getTime() + RECEIPT_LINK_TTL_MS);

        const row = await this.repository.createReplacingActive(
            {
                branchId: params.branchId,
                clientId: params.clientId,
                eformsignDocId: params.eformsignDocId,
                jobId: params.jobId ?? null,
                linkTokenHash: sha256(linkToken),
                expectedBirthdayHash: this.hashBirthday(birthday),
                expiresAt,
                storagePath: params.storagePath,
                contentSha256: params.contentSha256,
                byteSize: params.byteSize,
                source: params.source,
                createdBy: params.createdBy ?? null,
                createdAt: now,
            },
            now,
        );

        return { id: row.id, linkToken, expiresAt };
    }

    private async findRow(linkToken: string): Promise<ReceiptLinkTokenRecord | null> {
        return this.repository.findByLinkTokenHash(sha256(linkToken));
    }

    private unusableReason(row: ReceiptLinkTokenRecord | null, now: Date): ReceiptLinkUnusableReason | null {
        if (!row) return "not_found";
        if (!row.active) return "revoked";
        if (row.expiresAt.getTime() <= now.getTime()) return "expired";
        return null;
    }

    private lockedUntil(row: ReceiptLinkTokenRecord, now: Date): Date | null {
        if (!row.lockedAt) return null;
        const until = new Date(row.lockedAt.getTime() + RECEIPT_LINK_LOCK_MS);
        return until.getTime() > now.getTime() ? until : null;
    }

    async getStatus(linkToken: string, now: Date): Promise<ReceiptLinkStatus> {
        const row = await this.findRow(linkToken);
        const unusable = this.unusableReason(row, now);
        if (unusable || !row) return { ok: false, reason: unusable ?? "not_found" };

        const lockedUntil = this.lockedUntil(row, now);
        const failed = lockedUntil || !row.lockedAt ? row.failedAttempts : 0;
        return {
            ok: true,
            state: row.verifiedAt ? "verified" : "pending",
            branchName: row.branchName ?? "",
            expiresAt: row.expiresAt.toISOString(),
            remainingAttempts: lockedUntil ? 0 : Math.max(0, RECEIPT_LINK_MAX_FAILED_ATTEMPTS - failed),
            lockedUntil: lockedUntil ? lockedUntil.toISOString() : null,
        };
    }

    async verifyBirthday(linkToken: string, rawInput: string, now: Date): Promise<VerifyReceiptBirthdayResult> {
        const row = await this.findRow(linkToken);
        const unusable = this.unusableReason(row, now);
        if (unusable || !row) return { ok: false, reason: unusable ?? "not_found" };

        const normalized = normalizeBirthdayInput(rawInput);
        if (!normalized) return { ok: false, reason: "invalid_format" };

        // Atomic: the repository decides "still locked" / "reset" / "increment (+ maybe newly
        // lock)" all in the SAME write, never from a snapshot read before this call — two (or
        // two hundred) concurrent guesses can never both see themselves as "not yet at the
        // limit". No comparison happens until this reservation succeeds.
        const reservation = await this.repository.reserveVerificationAttempt(
            row.id,
            now,
            RECEIPT_LINK_LOCK_MS,
            RECEIPT_LINK_MAX_FAILED_ATTEMPTS,
        );
        if (reservation.outcome === "locked") {
            return { ok: false, reason: "locked", lockedUntil: reservation.lockedUntil.toISOString() };
        }

        if (!timingSafeEqualHex(this.hashBirthday(normalized), reservation.expectedBirthdayHash)) {
            // This reservation's own write just tipped the counter to the limit — report locked
            // rather than a remainingAttempts count of 0 that implies another guess is possible.
            if (reservation.lockedAt) {
                return {
                    ok: false,
                    reason: "locked",
                    lockedUntil: new Date(reservation.lockedAt.getTime() + RECEIPT_LINK_LOCK_MS).toISOString(),
                };
            }
            return {
                ok: false,
                reason: "verification_failed",
                remainingAttempts: Math.max(0, RECEIPT_LINK_MAX_FAILED_ATTEMPTS - reservation.failedAttempts),
            };
        }

        const accessToken = `efra_${randomBytes(32).toString("base64url")}`;
        await this.repository.update(row.id, {
            accessTokenHash: sha256(accessToken),
            verifiedAt: now,
            failedAttempts: 0,
            lockedAt: null,
        });
        return { ok: true, accessToken, clientName: row.clientName ?? DEFAULT_CLIENT_NAME };
    }

    async resolveAccess(linkToken: string, accessToken: string, now: Date): Promise<ReceiptLinkAccess | null> {
        const row = await this.findRow(linkToken);
        if (!row || this.unusableReason(row, now)) return null;
        if (!row.accessTokenHash || !timingSafeEqualHex(row.accessTokenHash, sha256(accessToken))) return null;
        return { id: row.id, storagePath: row.storagePath, clientName: row.clientName ?? DEFAULT_CLIENT_NAME, expiresAt: row.expiresAt };
    }

    /**
     * Tokens expired before `cutoff`, plus the storage paths that no live (not-yet-expired-as-of-
     * `cutoff`) token still uses. Read-only: it deletes nothing. Task 2.7 deletes the storage
     * objects at `orphanStoragePaths` first and only then calls `deleteByIds(ids)` — rows must
     * survive a crash between the two, so this must never remove them itself.
     */
    async collectExpired(cutoff: Date): Promise<{ ids: string[]; orphanStoragePaths: string[] }> {
        const expired = await this.repository.findExpired(cutoff);
        if (expired.length === 0) return { ids: [], orphanStoragePaths: [] };

        const ids = expired.map((row) => row.id);
        const candidatePaths = Array.from(new Set(expired.map((row) => row.storagePath)));

        const stillInUse = new Set(await this.repository.findStoragePathsInUse(candidatePaths, cutoff));
        const orphanStoragePaths = candidatePaths.filter((path) => !stillInUse.has(path));

        return { ids, orphanStoragePaths };
    }

    async deleteByIds(ids: string[]): Promise<number> {
        if (ids.length === 0) return 0;
        return this.repository.deleteByIds(ids);
    }
}
