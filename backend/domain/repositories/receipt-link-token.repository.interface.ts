export const RECEIPT_LINK_TOKEN_REPOSITORY = "RECEIPT_LINK_TOKEN_REPOSITORY";

/**
 * Consecutive birthday-verification failures a token tolerates before it locks. Lives here
 * (not in the service) because the repository's atomic failure-increment needs it too, to
 * decide — in the same write — whether the failure it is recording is the one that starts the
 * lock window.
 */
export const RECEIPT_LINK_MAX_FAILED_ATTEMPTS = 5;

export interface ReceiptLinkTokenRecord {
    id: string;
    eformsignDocId: number;
    accessTokenHash: string | null;
    expectedBirthdayHash: string;
    verifiedAt: Date | null;
    failedAttempts: number;
    lockedAt: Date | null;
    expiresAt: Date;
    active: boolean;
    storagePath: string;
    /** The issuing branch's display name. */
    branchName: string | null;
    /** The client's display name; null when the client is unset. */
    clientName: string | null;
}

export interface CreateReceiptLinkTokenData {
    branchId: string;
    clientId: number | null;
    eformsignDocId: number;
    jobId: string | null;
    linkTokenHash: string;
    expectedBirthdayHash: string;
    expiresAt: Date;
    storagePath: string;
    contentSha256: string;
    byteSize: number;
    /** Matches the DB CHECK constraint `source IN ('auto_trigger', 'manual')`. */
    source: "auto_trigger" | "manual";
    createdBy: string | null;
    createdAt: Date;
}

export interface UpdateReceiptLinkTokenData {
    accessTokenHash?: string | null;
    verifiedAt?: Date | null;
    failedAttempts?: number;
    lockedAt?: Date | null;
}

export interface ExpiredReceiptLinkToken {
    id: string;
    storagePath: string;
    eformsignDocId: number;
}

/**
 * Outcome of `reserveVerificationAttempt`. `"locked"` means the token was already inside an
 * earlier lock window when the reservation ran — the row's values are unchanged (the statement
 * still writes them and takes the row lock; it just writes back the pre-write value) and no
 * attempt was consumed. `"recorded"` means the write happened (a fresh increment, a post-window
 * reset to 1, or both plus a newly-set `lockedAt` when the write's own count reached
 * `maxAttempts`) and carries the authoritative post-write state the caller must act on.
 * `"unusable"` means the reservation targeted a row that is no longer eligible to be verified
 * at all — inactive (revoked/replaced) or past its expiry — as of this same write; the caller
 * must re-read the token's status to report the correct terminal reason (`expired`/`revoked`/
 * `not_found`) rather than treating this as a plain "not found".
 */
export type ReserveVerificationAttemptResult =
    | { outcome: "locked"; lockedUntil: Date }
    | { outcome: "recorded"; failedAttempts: number; lockedAt: Date | null; expectedBirthdayHash: string }
    | { outcome: "unusable" };

export interface IReceiptLinkTokenRepository {
    /** The token this hash belongs to, with its branch and client display names, or null if no
     *  such token was ever issued. */
    findByLinkTokenHash(linkTokenHash: string): Promise<ReceiptLinkTokenRecord | null>;
    /**
     * Replaces a document's active token: whichever token is currently active for
     * `eformsignDocId` is revoked and the new one is created, as one atomic unit. A failed
     * create can never leave the document with zero active tokens, and the revoke and the
     * create can never be observed independently (no window where two tokens are active, or
     * where the old one is gone and the new one isn't there yet).
     */
    createReplacingActive(data: CreateReceiptLinkTokenData, now: Date): Promise<ReceiptLinkTokenRecord>;
    /** Applies a partial state change (verification outcome, post-lock-window reset, ...) to
     *  one token. */
    update(id: string, data: UpdateReceiptLinkTokenData): Promise<ReceiptLinkTokenRecord>;
    /**
     * Atomically reserves one birthday-verification attempt, deciding lock state in the SAME
     * database write as the increment — never from a value the caller read before this call.
     * Semantics, evaluated against the row's state as of this write (never a caller-supplied
     * snapshot):
     *  - The row is no longer active or has already expired (as of `now`) → no counter write;
     *    returns `{ outcome: "unusable" }`.
     *  - Still inside an earlier lock window (`lockedAt` set and `lockedAt + lockWindowMs > now`)
     *    → the values are unchanged (the statement still writes them and takes the row lock, it
     *    just writes back the pre-write value); returns `{ outcome: "locked", lockedUntil }`.
     *  - `lockedAt` set but its window has elapsed → resets the counter to 1 and clears
     *    `lockedAt`, in this same write.
     *  - Otherwise → increments the counter by 1; if the new count reaches `maxAttempts`, also
     *    sets `lockedAt: now` in this same write.
     * Two concurrent callers racing on the same row can never both read a stale pre-increment
     * count and both conclude "not yet locked" — every reservation serializes against the row.
     */
    reserveVerificationAttempt(
        id: string,
        now: Date,
        lockWindowMs: number,
        maxAttempts: number,
    ): Promise<ReserveVerificationAttemptResult>;
    /** Tokens that expired before `cutoff`, capped at 1000 per call — the daily cleanup job
     *  drains any leftovers beyond that on its next run, so this never needs to return an
     *  unbounded set. */
    findExpired(cutoff: Date): Promise<ExpiredReceiptLinkToken[]>;
    /** Permanently removes the given tokens. Returns how many rows were actually deleted. */
    deleteByIds(ids: string[]): Promise<number>;
    /** Whether any token — expired or not — currently references this storage path. Task 2.4
     *  uses this to skip re-uploading a receipt whose exact storage path is already live. */
    existsByStoragePath(storagePath: string): Promise<boolean>;
    /** The subset of `storagePaths` still referenced by a token that has not expired as of
     *  `cutoff` (i.e. still "live"). Used to find which expired tokens' storage objects are safe
     *  to delete — no live token needs them — without removing any row first. */
    findStoragePathsInUse(storagePaths: string[], cutoff: Date): Promise<string[]>;
    /**
     * The active token already issued for this job, if any. Task 2.4's issue pipeline may be
     * invoked more than once for the same dispatch job (e.g. a delivery that converges onto an
     * earlier acceptance and never sends), and must not mint a second token for it — this is
     * how it detects that a previous run already succeeded.
     */
    findActiveByJobId(jobId: string): Promise<ReceiptLinkTokenRecord | null>;
}
