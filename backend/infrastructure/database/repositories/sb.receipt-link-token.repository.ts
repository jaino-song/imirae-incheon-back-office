import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "infrastructure/database/prisma.service";
import { runSystemScope } from "infrastructure/tenant/run-system-scope";
import {
    CreateReceiptLinkTokenData,
    ExpiredReceiptLinkToken,
    IReceiptLinkTokenRepository,
    ReceiptLinkTokenRecord,
    ReserveVerificationAttemptResult,
    UpdateReceiptLinkTokenData,
} from "domain/repositories/receipt-link-token.repository.interface";

const INCLUDE_NAMES = { branch: { select: { name: true } }, client: { select: { name: true } } } as const;
const JOB_ISSUANCE_LOCK_NAMESPACE = "babyjamjam:receipt-link-job-issuance:v1";

interface RawRow {
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
    branch?: { name: string } | null;
    client?: { name: string } | null;
}

function toRecord(row: RawRow): ReceiptLinkTokenRecord {
    return {
        id: row.id,
        eformsignDocId: row.eformsignDocId,
        accessTokenHash: row.accessTokenHash,
        expectedBirthdayHash: row.expectedBirthdayHash,
        verifiedAt: row.verifiedAt,
        failedAttempts: row.failedAttempts,
        lockedAt: row.lockedAt,
        expiresAt: row.expiresAt,
        active: row.active,
        storagePath: row.storagePath,
        branchName: row.branch?.name ?? null,
        clientName: row.client?.name ?? null,
    };
}

/**
 * `receipt_link_token` is a tenant model (has `branch_id`) as of the drift-spec
 * registration in `tenant-models.generated.ts`, so the tenant-isolation Prisma
 * extension now applies to it. Three methods below are token-KEYED lookups
 * reached from the public, unauthenticated receipt-link endpoints
 * (`ReceiptLinkController`'s status/verify routes): the presented link token
 * IS the credential, and the branch is not yet known — it is resolved BY the
 * lookup, not available before it. That is structurally identical to
 * `TenantGuard`'s own membership-lookup bypass (`tenant.guard.ts`,
 * `run-system-scope.ts`), so those three (plus `reserveVerificationAttempt`,
 * the atomic birthday-attempt reservation backing the same public `verify`
 * endpoint) wrap their bodies in `runSystemScope`, deliberately and
 * auditedly bypassing tenant isolation for a query that is legitimately
 * cross-branch by design. The other methods (`createReplacingActive`,
 * `findExpired`, `deleteByIds`, `existsByStoragePath`,
 * `findStoragePathsInUse`, `findActiveByJobId`) run under scheduler/delivery
 * context (no HTTP-origin ALS store, or an already-branch-scoped write from
 * `ReceiptLinkIssueService`) and stay unwrapped.
 */
@Injectable()
export class SbReceiptLinkTokenRepository implements IReceiptLinkTokenRepository {
    constructor(private readonly prisma: PrismaService) {}

    async withJobIssuanceLock<T>(
        jobId: string,
        operation: (contended: boolean) => Promise<T>,
    ): Promise<T> {
        return this.prisma.$transaction(async (tx) => {
            const lockKey = `${JOB_ISSUANCE_LOCK_NAMESPACE}:${jobId}`;
            const rows = await tx.$queryRaw<Array<{ acquired: boolean }>>(Prisma.sql`
                SELECT pg_try_advisory_xact_lock(hashtextextended(${lockKey}, 0)) AS acquired
            `);
            const acquired = rows[0]?.acquired === true;
            if (!acquired) {
                await tx.$queryRaw(Prisma.sql`
                    SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))
                `);
            }
            return operation(!acquired);
        });
    }

    // Cross-branch by design: see the class comment above.
    async findByLinkTokenHash(linkTokenHash: string): Promise<ReceiptLinkTokenRecord | null> {
        return runSystemScope(async () => {
            const row = await this.prisma.receipt_link_token.findUnique({
                where: { linkTokenHash },
                include: INCLUDE_NAMES,
            });
            return row ? toRecord(row) : null;
        });
    }

    async createReplacingActive(data: CreateReceiptLinkTokenData, now: Date): Promise<ReceiptLinkTokenRecord> {
        const row = await this.prisma.$transaction(async (tx) => {
            await tx.receipt_link_token.updateMany({
                // Branch-pinned per the tenant-isolation extension's write-pin rule: the
                // revoke targets only the issuing branch's previously active token for
                // this document, matching the branch the new row is created under.
                where: { eformsignDocId: data.eformsignDocId, active: true, branchId: data.branchId },
                data: { active: false, revokedAt: now },
            });
            return tx.receipt_link_token.create({ data, include: INCLUDE_NAMES });
        });
        return toRecord(row);
    }

    // Cross-branch by design: see the class comment above. This is the verify()
    // access-token mint's only caller — the post-lock-window reset now happens inside
    // reserveVerificationAttempt's own SQL, not here.
    async update(id: string, data: UpdateReceiptLinkTokenData): Promise<ReceiptLinkTokenRecord> {
        return runSystemScope(async () => {
            const row = await this.prisma.receipt_link_token.update({
                where: { id },
                data,
                include: INCLUDE_NAMES,
            });
            return toRecord(row);
        });
    }

    // Cross-branch by design: see the class comment above.
    //
    // ONE atomic statement (a locking CTE feeding a single UPDATE...FROM...RETURNING), not a
    // read-then-decide-then-write sequence: two concurrent reservations against the same row
    // always serialize on the row lock the CTE's `FOR UPDATE` takes, so neither can ever act on
    // a stale pre-write snapshot of `locked_at`/`failed_attempts`. `before` captures that
    // snapshot explicitly (aliased `b`) because, inside a single UPDATE's SET/RETURNING
    // expressions, referencing the target table's own columns would otherwise resolve to
    // whichever value THIS statement is writing, not the value the decision must be based on.
    async reserveVerificationAttempt(
        id: string,
        now: Date,
        lockWindowMs: number,
        maxAttempts: number,
    ): Promise<ReserveVerificationAttemptResult> {
        return runSystemScope(async () => {
            const rows = await this.prisma.$queryRaw<
                Array<{ failedAttempts: number; lockedAt: Date | null; expectedBirthdayHash: string; wasLocked: boolean }>
            >(Prisma.sql`
                WITH before AS (
                    SELECT id, locked_at, failed_attempts, expected_birthday_hash
                    FROM receipt_link_token
                    WHERE id = ${id}::uuid AND active AND expires_at > ${now}::timestamptz
                    FOR UPDATE
                )
                UPDATE receipt_link_token t
                SET
                    failed_attempts = CASE
                        WHEN b.locked_at IS NOT NULL
                             AND b.locked_at + make_interval(secs => (${lockWindowMs}::double precision / 1000)) > ${now}::timestamptz
                        THEN b.failed_attempts
                        WHEN b.locked_at IS NOT NULL THEN 1
                        ELSE b.failed_attempts + 1
                    END,
                    locked_at = CASE
                        WHEN b.locked_at IS NOT NULL
                             AND b.locked_at + make_interval(secs => (${lockWindowMs}::double precision / 1000)) > ${now}::timestamptz
                        THEN b.locked_at
                        WHEN b.locked_at IS NOT NULL THEN NULL
                        WHEN b.failed_attempts + 1 >= ${maxAttempts}::int THEN ${now}::timestamptz
                        ELSE NULL
                    END
                FROM before b
                WHERE t.id = b.id
                RETURNING
                    t.failed_attempts AS "failedAttempts",
                    t.locked_at AS "lockedAt",
                    t.expected_birthday_hash AS "expectedBirthdayHash",
                    (b.locked_at IS NOT NULL
                        AND b.locked_at + make_interval(secs => (${lockWindowMs}::double precision / 1000)) > ${now}::timestamptz
                    ) AS "wasLocked"
            `);
            const row = rows[0];
            if (!row) {
                // The CTE's WHERE (id AND active AND expires_at > now) matched zero rows: the
                // token is missing, already inactive, or expired as of this same `now`. The
                // caller re-reads the row to report the correct terminal reason.
                return { outcome: "unusable" };
            }
            if (row.wasLocked) {
                // Values unchanged: the statement still writes t.locked_at/failed_attempts
                // above, it just writes back the pre-write value in this branch (see the row
                // lock the CTE's FOR UPDATE holds for the duration of the write).
                return { outcome: "locked", lockedUntil: new Date(row.lockedAt!.getTime() + lockWindowMs) };
            }
            return {
                outcome: "recorded",
                failedAttempts: row.failedAttempts,
                lockedAt: row.lockedAt,
                expectedBirthdayHash: row.expectedBirthdayHash,
            };
        });
    }

    async findExpired(cutoff: Date): Promise<ExpiredReceiptLinkToken[]> {
        return this.prisma.receipt_link_token.findMany({
            where: { expiresAt: { lt: cutoff } },
            select: { id: true, storagePath: true, eformsignDocId: true },
            take: 1000,
        });
    }

    async deleteByIds(ids: string[]): Promise<number> {
        if (ids.length === 0) return 0;
        const result = await this.prisma.receipt_link_token.deleteMany({ where: { id: { in: ids } } });
        return result.count;
    }

    async existsByStoragePath(storagePath: string): Promise<boolean> {
        const row = await this.prisma.receipt_link_token.findFirst({
            where: { storagePath },
            select: { id: true },
        });
        return row !== null;
    }

    async findStoragePathsInUse(storagePaths: string[], cutoff: Date): Promise<string[]> {
        if (storagePaths.length === 0) return [];
        const rows = await this.prisma.receipt_link_token.findMany({
            where: { storagePath: { in: storagePaths }, expiresAt: { gte: cutoff } },
            select: { storagePath: true },
            distinct: ["storagePath"],
        });
        return rows.map((row) => row.storagePath);
    }

    async findActiveByJobId(jobId: string): Promise<ReceiptLinkTokenRecord | null> {
        const row = await this.prisma.receipt_link_token.findFirst({
            where: { jobId, active: true },
            orderBy: { createdAt: "desc" },
            include: INCLUDE_NAMES,
        });
        return row ? toRecord(row) : null;
    }
}
