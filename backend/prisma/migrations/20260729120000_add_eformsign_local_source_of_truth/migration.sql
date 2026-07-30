BEGIN;

ALTER TABLE "eformsign_doc"
    ADD COLUMN IF NOT EXISTS "customer_phone" VARCHAR(11),
    ADD COLUMN IF NOT EXISTS "detail_payload" JSONB,
    ADD COLUMN IF NOT EXISTS "detail_source_updated_date" TIMESTAMPTZ(6),
    ADD COLUMN IF NOT EXISTS "detail_synced_at" TIMESTAMPTZ(6),
    ADD COLUMN IF NOT EXISTS "sync_status" TEXT NOT NULL DEFAULT 'pending',
    ADD COLUMN IF NOT EXISTS "sync_error" TEXT,
    ADD COLUMN IF NOT EXISTS "sync_error_at" TIMESTAMPTZ(6);

CREATE INDEX IF NOT EXISTS "idx_eformsign_doc_branch_customer_phone"
    ON "eformsign_doc"("branch_id", "customer_phone");

CREATE TABLE IF NOT EXISTS "eformsign_doc_file" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "eformsign_doc_id" INTEGER NOT NULL,
    "file_type" TEXT NOT NULL,
    "content" BYTEA NOT NULL,
    "content_type" TEXT NOT NULL,
    "content_disposition" TEXT,
    "byte_size" INTEGER NOT NULL,
    "sha256" CHAR(64) NOT NULL,
    "source_updated_date" TIMESTAMPTZ(6) NOT NULL,
    "synced_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "eformsign_doc_file_pkey" PRIMARY KEY ("id")
);

-- Prisma's @updatedAt is application-managed and has no database default.
-- Keep reruns aligned even if an earlier partial execution created the table
-- with DEFAULT CURRENT_TIMESTAMP.
ALTER TABLE "eformsign_doc_file"
    ALTER COLUMN "updated_at" DROP DEFAULT;

CREATE UNIQUE INDEX IF NOT EXISTS "uniq_eformsign_doc_file_type"
    ON "eformsign_doc_file"("eformsign_doc_id", "file_type");
CREATE INDEX IF NOT EXISTS "idx_eformsign_doc_file_document"
    ON "eformsign_doc_file"("eformsign_doc_id");

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'eformsign_doc_file_eformsign_doc_id_fkey'
    ) THEN
        ALTER TABLE "eformsign_doc_file"
            ADD CONSTRAINT "eformsign_doc_file_eformsign_doc_id_fkey"
            FOREIGN KEY ("eformsign_doc_id")
            REFERENCES "eformsign_doc"("id")
            ON DELETE CASCADE
            ON UPDATE NO ACTION;
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'eformsign_doc_sync_status_check'
    ) THEN
        ALTER TABLE "eformsign_doc"
            ADD CONSTRAINT "eformsign_doc_sync_status_check"
            CHECK ("sync_status" IN ('pending', 'syncing', 'ready', 'partial', 'failed'));
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'eformsign_doc_file_type_check'
    ) THEN
        ALTER TABLE "eformsign_doc_file"
            ADD CONSTRAINT "eformsign_doc_file_type_check"
            CHECK ("file_type" IN ('document', 'audit_trail'));
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'eformsign_doc_file_size_check'
    ) THEN
        ALTER TABLE "eformsign_doc_file"
            ADD CONSTRAINT "eformsign_doc_file_size_check"
            CHECK ("byte_size" = octet_length("content"));
    END IF;
END $$;

COMMIT;
