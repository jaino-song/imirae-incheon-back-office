/**
 * One-shot, restart-safe operator tool for legacy document rows that share one
 * Supabase object. It keeps the stable earliest row on the source path, copies
 * every later row to a deterministic server path, verifies byte length and
 * SHA-256 after download, and conditionally updates the locked row.
 *
 * Dry-run (DB read only):
 *   pnpm --filter ./backend exec ts-node scripts/remediate-document-storage-path-duplicates.ts
 *
 * Apply (requires DATABASE_URL, SUPABASE_URL, SUPABASE_SERVICE_KEY):
 *   pnpm --filter ./backend exec ts-node scripts/remediate-document-storage-path-duplicates.ts \
 *     --apply=copy-and-verify-document-objects
 *
 * Run in a maintenance window before the visibility migration. The tool never
 * deletes a source object. Successful rows are resumable; a verified orphan at
 * the deterministic destination is reused after interruption.
 */
import { ConfigService } from "@nestjs/config";
import { Prisma, PrismaClient } from "@prisma/client";

import {
    type DocumentStorageRemediationRepository,
    type DuplicateDocumentOwner,
    type LockedDocumentRemediation,
    remediateDocumentStoragePathDuplicates,
} from "../application/services/document-storage-duplicate-remediator";
import { SupabaseStorageAdapter } from "../infrastructure/adapters/supabase-storage.adapter";

const APPLY_FLAG = "--apply=copy-and-verify-document-objects";
const TRANSACTION_TIMEOUT_MS = 120_000;

export class PrismaDocumentStorageRemediationRepository
implements DocumentStorageRemediationRepository {
    constructor(private readonly prisma: PrismaClient) {}

    async listDuplicateStoragePaths(): Promise<string[]> {
        const rows = await this.prisma.$queryRaw<Array<{ storagePath: string }>>(Prisma.sql`
            SELECT "storage_path" AS "storagePath"
            FROM "document"
            GROUP BY "storage_path"
            HAVING COUNT(*) > 1
            ORDER BY "storage_path"
        `);
        return rows.map((row) => row.storagePath);
    }

    async listStoragePathOwners(storagePath: string): Promise<DuplicateDocumentOwner[]> {
        return this.prisma.document.findMany({
            where: { storagePath },
            select: {
                id: true,
                branchId: true,
                storagePath: true,
                mimeType: true,
                fileSize: true,
                createdAt: true,
            },
            orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        });
    }

    async withLockedOwner(
        id: string,
        expectedStoragePath: string,
        operation: (transaction: LockedDocumentRemediation) => Promise<void>,
    ): Promise<boolean> {
        return this.prisma.$transaction(async (transaction) => {
            const rows = await transaction.$queryRaw<DuplicateDocumentOwner[]>(Prisma.sql`
                SELECT
                    "id",
                    "branch_id" AS "branchId",
                    "storage_path" AS "storagePath",
                    "mime_type" AS "mimeType",
                    "file_size" AS "fileSize",
                    "created_at" AS "createdAt"
                FROM "document"
                WHERE "id" = ${id} AND "storage_path" = ${expectedStoragePath}
                FOR UPDATE
            `);
            const owner = rows[0];
            if (!owner) return false;

            await operation({
                owner,
                branchExists: async (branchId) => Boolean(
                    await transaction.branch.findUnique({
                        where: { id: branchId },
                        select: { id: true },
                    }),
                ),
                findDocumentIdByStoragePath: async (storagePath) => {
                    const document = await transaction.document.findFirst({
                        where: { storagePath },
                        select: { id: true },
                    });
                    return document?.id ?? null;
                },
                replaceStoragePath: async (storagePath) => {
                    const result = await transaction.document.updateMany({
                        where: { id, storagePath: expectedStoragePath },
                        data: { storagePath, storageUrl: null },
                    });
                    return result.count === 1;
                },
            });
            return true;
        }, {
            isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
            maxWait: 10_000,
            timeout: TRANSACTION_TIMEOUT_MS,
        });
    }
}

async function printDryRun(
    repository: DocumentStorageRemediationRepository,
): Promise<void> {
    const duplicatePaths = await repository.listDuplicateStoragePaths();
    if (duplicatePaths.length === 0) {
        console.log("OK: no duplicate document storage paths found.");
        return;
    }

    console.log(`REFUSED: ${duplicatePaths.length} duplicate path group(s) require remediation.`);
    for (const storagePath of duplicatePaths) {
        const owners = await repository.listStoragePathOwners(storagePath);
        console.log(`${storagePath}: ${owners.map((owner) => owner.id).join(", ")}`);
    }
    console.log(`No changes made. Re-run with ${APPLY_FLAG} in a maintenance window.`);
}

export async function main(): Promise<void> {
    const prisma = new PrismaClient();
    const repository = new PrismaDocumentStorageRemediationRepository(prisma);
    try {
        if (!process.argv.includes(APPLY_FLAG)) {
            await printDryRun(repository);
            return;
        }

        const storage = new SupabaseStorageAdapter(new ConfigService());
        const summary = await remediateDocumentStoragePathDuplicates(
            repository,
            storage,
        );
        console.log(
            `OK: remediated ${summary.ownersRemediated} owner(s) across `
            + `${summary.duplicatePathsFound} duplicate group(s); `
            + `${summary.verifiedCopiesReused} verified copy/copies reused.`,
        );
    } finally {
        await prisma.$disconnect();
    }
}

if (require.main === module) {
    main().catch((error) => {
        console.error(error instanceof Error ? error.message : error);
        process.exit(1);
    });
}
