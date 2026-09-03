import { Injectable } from "@nestjs/common";
import { PrismaService } from "infrastructure/database/prisma.service";
import {
    CreateReceiptLinkTokenData,
    ExpiredReceiptLinkToken,
    IReceiptLinkTokenRepository,
    ReceiptLinkTokenRecord,
    UpdateReceiptLinkTokenData,
} from "domain/repositories/receipt-link-token.repository.interface";

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
            include: { branch: { select: { name: true } }, client: { select: { name: true } } },
        });
        return row ? toRecord(row) : null;
    }

    async revokeActiveByDocument(
        eformsignDocId: number,
        data: { active: boolean; revokedAt: Date },
    ): Promise<number> {
        const result = await this.prisma.receipt_link_token.updateMany({
            where: { eformsignDocId, active: true },
            data,
        });
        return result.count;
    }

    async create(data: CreateReceiptLinkTokenData): Promise<ReceiptLinkTokenRecord> {
        const row = await this.prisma.receipt_link_token.create({ data });
        return toRecord(row);
    }

    async update(id: string, data: UpdateReceiptLinkTokenData): Promise<ReceiptLinkTokenRecord> {
        const row = await this.prisma.receipt_link_token.update({ where: { id }, data });
        return toRecord(row);
    }

    async findExpired(cutoff: Date): Promise<ExpiredReceiptLinkToken[]> {
        return this.prisma.receipt_link_token.findMany({
            where: { expiresAt: { lt: cutoff } },
            select: { id: true, storagePath: true, eformsignDocId: true },
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
}
