-- Keep the preflight and every DDL statement atomic. Prisma does not wrap
-- PostgreSQL migrations in a transaction automatically.
BEGIN;

-- Fail before changing the schema if legacy rows cannot satisfy the new
-- ownership invariant. Never guess which row should own a shared object.
DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM "document"
        WHERE "branch_id" IS NULL
    ) THEN
        RAISE EXCEPTION 'document visibility migration refused: rows with NULL branch_id must be assigned to a verified branch first';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM "document"
        GROUP BY "storage_path"
        HAVING COUNT(*) > 1
    ) THEN
        RAISE EXCEPTION 'document visibility migration refused: run scripts/remediate-document-storage-path-duplicates.ts before retrying';
    END IF;
END $$;

-- AlterTable
ALTER TABLE "document" ADD COLUMN "visibility_scope" VARCHAR(32) NOT NULL DEFAULT 'branch';

-- Constrain the fail-closed visibility vocabulary at the persistence boundary.
ALTER TABLE "document"
ADD CONSTRAINT "document_visibility_scope_check"
CHECK ("visibility_scope" IN ('branch', 'all_branches'));

-- Every storage object may be owned by at most one document row.
CREATE UNIQUE INDEX "document_storage_path_key" ON "document"("storage_path");

-- CreateIndex
CREATE INDEX "idx_document_visibility_scope" ON "document"("visibility_scope");

COMMIT;
