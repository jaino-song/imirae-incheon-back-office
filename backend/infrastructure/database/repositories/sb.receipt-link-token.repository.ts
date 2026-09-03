import { Injectable } from "@nestjs/common";
import { PrismaService } from "infrastructure/database/prisma.service";
import { runSystemScope } from "infrastructure/tenant/run-system-scope";
import {
    CreateReceiptLinkTokenData,
    ExpiredReceiptLinkToken,
    IReceiptLinkTokenRepository,
    RECEIPT_LINK_MAX_FAILED_ATTEMPTS,
    ReceiptLinkTokenRecord,
    UpdateReceiptLinkTokenData,
} from "domain/repositories/receipt-link-token.repository.interface";

const INCLUDE_NAMES = { branch: { select: { name: true } }, client: { select: { name: true } } } as const;

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
 * `run-system-scope.ts`), so those three wrap their bodies in
 * `runSystemScope`, deliberately and auditedly bypassing tenant isolation for
 * a query that is legitimately cross-branch by design. The other methods
 * (`createReplacingActive`, `findExpired`, `deleteByIds`, `existsByStoragePath`,
 * `findStoragePathsInUse`, `findActiveByJobId`) run under scheduler/delivery
 * context (no HTTP-origin ALS store, or an already-branch-scoped write from
 * `ReceiptLinkIssueService`) and stay unwrapped.
 */
@Injectable()
export class SbReceiptLinkTokenRepository implements IReceiptLinkTokenRepository {
    constructor(private readonly prisma: PrismaService) {}

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

    // Cross-branch by design: see the class comment above. Covers both the
    // verify() access-token mint and the periodic post-lock-window reset.
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
    async incrementFailedAttempts(id: string, now: Date): Promise<{ failedAttempts: number; lockedAt: Date | null }> {
        return runSystemScope(async () => {
            const result = await this.prisma.$transaction(async (tx) => {
                const incremented = await tx.receipt_link_token.update({
                    where: { id },
                    data: { failedAttempts: { increment: 1 } },
                    select: { failedAttempts: true },
                });

                if (incremented.failedAttempts < RECEIPT_LINK_MAX_FAILED_ATTEMPTS) {
                    return { failedAttempts: incremented.failedAttempts, lockedAt: null };
                }

                const locked = await tx.receipt_link_token.update({
                    where: { id },
                    data: { lockedAt: now },
                    select: { failedAttempts: true, lockedAt: true },
                });
                return { failedAttempts: locked.failedAttempts, lockedAt: locked.lockedAt };
            });
            return result;
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
