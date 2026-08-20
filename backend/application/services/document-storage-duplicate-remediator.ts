import { createHash } from "node:crypto";
import { posix } from "node:path";

import {
    FileStorageObjectNotFoundError,
    type FileStoragePort,
} from "../../domain/ports/file-storage.port";

export interface DuplicateDocumentOwner {
    id: string;
    branchId: string | null;
    storagePath: string;
    mimeType: string;
    fileSize: number;
    createdAt: Date;
}

export interface LockedDocumentRemediation {
    owner: DuplicateDocumentOwner;
    branchExists(branchId: string): Promise<boolean>;
    findDocumentIdByStoragePath(storagePath: string): Promise<string | null>;
    replaceStoragePath(storagePath: string): Promise<boolean>;
}

export interface DocumentStorageRemediationRepository {
    listDuplicateStoragePaths(): Promise<string[]>;
    listStoragePathOwners(storagePath: string): Promise<DuplicateDocumentOwner[]>;
    withLockedOwner(
        id: string,
        expectedStoragePath: string,
        operation: (transaction: LockedDocumentRemediation) => Promise<void>,
    ): Promise<boolean>;
}

export interface DocumentStorageRemediationSummary {
    duplicatePathsFound: number;
    ownersRemediated: number;
    staleOwnersSkipped: number;
    verifiedCopiesReused: number;
}

type VerifiedCopy = {
    createdByThisAttempt: boolean;
    reused: boolean;
};

const REMEDIATION_NAMESPACE = "babyjamjam:document-storage-path-remediation:v1";

function sha256(buffer: Buffer): string {
    return createHash("sha256").update(buffer).digest("hex");
}

function stableUuid(value: string): string {
    const bytes = Buffer.from(createHash("sha256").update(value).digest().subarray(0, 16));
    bytes[6] = (bytes[6]! & 0x0f) | 0x50;
    bytes[8] = (bytes[8]! & 0x3f) | 0x80;
    const hex = bytes.toString("hex");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function createRemediationStoragePath(owner: DuplicateDocumentOwner): string {
    if (!owner.branchId) {
        throw new Error(`Document ${owner.id} has no verified branch.`);
    }

    const candidateExtension = posix.extname(owner.storagePath).toLowerCase();
    const extension = /^\.[a-z0-9]{1,10}$/.test(candidateExtension)
        ? candidateExtension
        : "";
    const objectId = stableUuid(
        `${REMEDIATION_NAMESPACE}:${owner.id}:${owner.storagePath}`,
    );
    return `documents/${owner.branchId}/${objectId}${extension}`;
}

function assertMatchingObject(
    source: Buffer,
    destination: Buffer,
    destinationPath: string,
): void {
    if (source.byteLength !== destination.byteLength) {
        throw new Error(
            `Verified copy refused for ${destinationPath}: byte length mismatch.`,
        );
    }
    if (sha256(source) !== sha256(destination)) {
        throw new Error(
            `Verified copy refused for ${destinationPath}: SHA-256 mismatch.`,
        );
    }
}

async function downloadIfPresent(
    storage: FileStoragePort,
    storagePath: string,
): Promise<Buffer | null> {
    try {
        return await storage.download(storagePath);
    } catch (error) {
        if (error instanceof FileStorageObjectNotFoundError) return null;
        throw error;
    }
}

async function deleteCreatedCopy(
    storage: FileStoragePort,
    destinationPath: string,
    cause: unknown,
): Promise<never> {
    try {
        await storage.delete(destinationPath);
    } catch (cleanupError) {
        const causeMessage = cause instanceof Error ? cause.message : String(cause);
        const cleanupMessage = cleanupError instanceof Error
            ? cleanupError.message
            : String(cleanupError);
        throw new Error(
            `Remediation failed (${causeMessage}) and compensation could not delete ${destinationPath} (${cleanupMessage}). `
            + "The deterministic copy is safe to reuse on the next run; do not delete the source object.",
        );
    }
    throw cause;
}

async function ensureVerifiedCopy(
    storage: FileStoragePort,
    source: Buffer,
    destinationPath: string,
    mimeType: string,
): Promise<VerifiedCopy> {
    const existing = await downloadIfPresent(storage, destinationPath);
    if (existing) {
        assertMatchingObject(source, existing, destinationPath);
        return { createdByThisAttempt: false, reused: true };
    }

    let destination: Buffer | null = null;
    try {
        await storage.upload(source, destinationPath, mimeType);
        destination = await storage.download(destinationPath);
    } catch (uploadError) {
        // Supabase upload may have completed even if signed-URL creation failed.
        // Read back before deciding whether this attempt needs compensation.
        destination = await downloadIfPresent(storage, destinationPath);
        if (!destination) throw uploadError;
    }

    try {
        assertMatchingObject(source, destination, destinationPath);
    } catch (verificationError) {
        return deleteCreatedCopy(storage, destinationPath, verificationError);
    }

    return { createdByThisAttempt: true, reused: false };
}

function sortOwners(owners: DuplicateDocumentOwner[]): DuplicateDocumentOwner[] {
    return [...owners].sort((left, right) => {
        const createdDifference = left.createdAt.getTime() - right.createdAt.getTime();
        return createdDifference || left.id.localeCompare(right.id);
    });
}

export async function remediateDocumentStoragePathDuplicates(
    repository: DocumentStorageRemediationRepository,
    storage: FileStoragePort,
): Promise<DocumentStorageRemediationSummary> {
    const duplicatePaths = await repository.listDuplicateStoragePaths();
    const summary: DocumentStorageRemediationSummary = {
        duplicatePathsFound: duplicatePaths.length,
        ownersRemediated: 0,
        staleOwnersSkipped: 0,
        verifiedCopiesReused: 0,
    };

    for (const sourcePath of duplicatePaths) {
        const owners = sortOwners(
            await repository.listStoragePathOwners(sourcePath),
        );
        if (owners.length < 2) continue;
        if (owners.some((owner) => owner.storagePath !== sourcePath)) {
            throw new Error(`Storage owner snapshot drifted for ${sourcePath}.`);
        }
        if (owners.some((owner) => !owner.branchId)) {
            throw new Error(
                `Remediation refused for ${sourcePath}: every owner needs a verified branch.`,
            );
        }

        const source = await storage.download(sourcePath);
        for (const owner of owners) {
            if (owner.fileSize !== source.byteLength) {
                throw new Error(
                    `Remediation refused for ${sourcePath}: stored size for ${owner.id} does not match the source object.`,
                );
            }
        }

        // The stable earliest row retains the original object. Later rows receive
        // deterministic verified copies, making interruption and retry idempotent.
        for (const owner of owners.slice(1)) {
            const copyState: { value: VerifiedCopy | null } = { value: null };
            const completed = await repository.withLockedOwner(
                owner.id,
                sourcePath,
                async (transaction) => {
                    const lockedOwner = transaction.owner;
                    if (!lockedOwner.branchId
                        || !(await transaction.branchExists(lockedOwner.branchId))) {
                        throw new Error(
                            `Remediation refused for ${lockedOwner.id}: branch is not verified.`,
                        );
                    }
                    if (lockedOwner.fileSize !== source.byteLength) {
                        throw new Error(
                            `Remediation refused for ${lockedOwner.id}: metadata changed while locked.`,
                        );
                    }
                    const destinationPath = createRemediationStoragePath(lockedOwner);

                    const destinationOwnerId = await transaction
                        .findDocumentIdByStoragePath(destinationPath);
                    if (destinationOwnerId && destinationOwnerId !== lockedOwner.id) {
                        throw new Error(
                            `Remediation destination collision at ${destinationPath}.`,
                        );
                    }

                    copyState.value = await ensureVerifiedCopy(
                        storage,
                        source,
                        destinationPath,
                        lockedOwner.mimeType,
                    );

                    try {
                        const replaced = await transaction.replaceStoragePath(destinationPath);
                        if (!replaced) {
                            throw new Error(
                                `Conditional storage_path update lost ownership for ${lockedOwner.id}.`,
                            );
                        }
                    } catch (updateError) {
                        if (copyState.value.createdByThisAttempt) {
                            return deleteCreatedCopy(storage, destinationPath, updateError);
                        }
                        throw updateError;
                    }
                },
            );

            if (!completed) {
                summary.staleOwnersSkipped += 1;
                continue;
            }
            summary.ownersRemediated += 1;
            if (copyState.value?.reused) summary.verifiedCopiesReused += 1;
        }
    }

    const remainingDuplicates = await repository.listDuplicateStoragePaths();
    if (remainingDuplicates.length > 0) {
        throw new Error(
            `Remediation incomplete: ${remainingDuplicates.length} duplicate storage path group(s) remain. Re-run the tool after resolving the reported error.`,
        );
    }

    return summary;
}
