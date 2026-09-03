export const RECEIPT_LINK_TOKEN_REPOSITORY = "RECEIPT_LINK_TOKEN_REPOSITORY";

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
    /** From the `branch` relation's `name`; null only if the row somehow lacks one. */
    branchName: string | null;
    /** From the `client` relation's `name`; null when the client is unset or unselected. */
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
    /** findUnique by linkTokenHash, with branch.name / client.name included. */
    findByLinkTokenHash(linkTokenHash: string): Promise<ReceiptLinkTokenRecord | null>;
    /** updateMany where { eformsignDocId, active: true }. Returns the number of rows revoked. */
    revokeActiveByDocument(eformsignDocId: number, data: { active: boolean; revokedAt: Date }): Promise<number>;
    create(data: CreateReceiptLinkTokenData): Promise<ReceiptLinkTokenRecord>;
    update(id: string, data: UpdateReceiptLinkTokenData): Promise<ReceiptLinkTokenRecord>;
    /** findMany where { expiresAt: { lt: cutoff } }, selecting id/storagePath/eformsignDocId. */
    findExpired(cutoff: Date): Promise<ExpiredReceiptLinkToken[]>;
    /** deleteMany where { id: { in: ids } }. Returns the number of rows deleted. */
    deleteByIds(ids: string[]): Promise<number>;
    /** findFirst where { storagePath }, select id. True iff any row currently references it. */
    existsByStoragePath(storagePath: string): Promise<boolean>;
}
