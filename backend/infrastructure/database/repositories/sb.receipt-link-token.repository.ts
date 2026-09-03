import { Injectable } from "@nestjs/common";
import { PrismaService } from "infrastructure/database/prisma.service";
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

@Injectable()
export class SbReceiptLinkTokenRepository implements IReceiptLinkTokenRepository {
    constructor(private readonly prisma: PrismaService) {}

    async findByLinkTokenHash(linkTokenHash: string): Promise<ReceiptLinkTokenRecord | null> {
        const row = await this.prisma.receipt_link_token.findUnique({
            where: { linkTokenHash },
            include: INCLUDE_NAMES,
        });
        return row ? toRecord(row) : null;
    }

    async createReplacingActive(data: CreateReceiptLinkTokenData, now: Date): Promise<ReceiptLinkTokenRecord> {
        const row = await this.prisma.$transaction(async (tx) => {
            await tx.receipt_link_token.updateMany({
                where: { eformsignDocId: data.eformsignDocId, active: true },
                data: { active: false, revokedAt: now },
            });
            return tx.receipt_link_token.create({ data, include: INCLUDE_NAMES });
        });
        return toRecord(row);
    }

    async update(id: string, data: UpdateReceiptLinkTokenData): Promise<ReceiptLinkTokenRecord> {
        const row = await this.prisma.receipt_link_token.update({
            where: { id },
            data,
            include: INCLUDE_NAMES,
        });
        return toRecord(row);
    }

    async incrementFailedAttempts(id: string, now: Date): Promise<{ failedAttempts: number; lockedAt: Date | null }> {
        return this.prisma.$transaction(async (tx) => {
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
}
