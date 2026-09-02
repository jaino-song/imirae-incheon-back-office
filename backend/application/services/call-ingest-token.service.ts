import { Injectable, Logger, NotFoundException } from "@nestjs/common";
import { createHash, randomBytes } from "crypto";
import { PrismaService } from "infrastructure/database/prisma.service";

export interface CreatedIngestToken {
    id: string;
    branchId: string;
    label: string;
    /** Plaintext token — returned exactly once at creation, never stored. */
    token: string;
}

export interface CallIngestTokenListItem {
    id: string;
    label: string;
    active: boolean;
    createdAt: Date;
}

@Injectable()
export class CallIngestTokenService {
    private readonly logger = new Logger(CallIngestTokenService.name);

    constructor(private readonly prismaService: PrismaService) {}

    private hash(token: string): string {
        return createHash("sha256").update(token).digest("hex");
    }

    async createToken(branchId: string, label: string): Promise<CreatedIngestToken> {
        const token = `cit_${randomBytes(32).toString("base64url")}`;
        const record = await this.prismaService.call_ingest_token.create({
            data: { branchId, label, tokenHash: this.hash(token) },
        });
        return { id: record.id, branchId, label, token };
    }

    /**
     * Rows only — never selects tokenHash. Explicitly reshaped below (not a
     * bare pass-through of the Prisma record) so an accidental broadening of
     * the `select` never leaks the hash or any other column to callers.
     */
    async list(branchId: string): Promise<CallIngestTokenListItem[]> {
        const records = await this.prismaService.call_ingest_token.findMany({
            where: { branchId },
            select: { id: true, label: true, active: true, createdAt: true },
            orderBy: { createdAt: "desc" },
        });
        return records.map((record) => ({
            id: record.id,
            label: record.label,
            active: record.active,
            createdAt: record.createdAt,
        }));
    }

    /** Returns the owning branchId for an active token, else null. */
    async resolveBranchId(token: string): Promise<string | null> {
        const record = await this.prismaService.call_ingest_token.findUnique({
            where: { tokenHash: this.hash(token) },
        });
        if (!record || !record.active) return null;

        this.prismaService.call_ingest_token
            .update({ where: { id: record.id }, data: { lastUsedAt: new Date() } })
            .catch((error) => this.logger.warn(`Failed to touch lastUsedAt: ${error}`));

        return record.branchId;
    }

    async revoke(id: string, branchId: string): Promise<void> {
        const result = await this.prismaService.call_ingest_token.updateMany({
            where: { id, branchId },
            data: { active: false, revokedAt: new Date() },
        });
        if (result.count === 0) {
            throw new NotFoundException("Token not found");
        }
    }
}
