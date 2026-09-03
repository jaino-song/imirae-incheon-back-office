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
     * Atomically records one more failed birthday attempt and returns the authoritative
     * post-increment state — never the value the caller read before this call. When the
     * returned count reaches `RECEIPT_LINK_MAX_FAILED_ATTEMPTS`, this also starts the lock
     * window (`lockedAt: now`) in the same operation, so two concurrent guesses can never both
     * read a stale pre-increment count and both conclude the token isn't locked yet.
     */
    incrementFailedAttempts(id: string, now: Date): Promise<{ failedAttempts: number; lockedAt: Date | null }>;
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
