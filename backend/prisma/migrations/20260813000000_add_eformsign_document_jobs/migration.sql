-- Durable eformsign provider-operation jobs.
--
-- This patch is additive and idempotent because database-patches.yml executes
-- it directly on every environment push. Prisma cannot express the CHECK
-- constraints, so this SQL is authoritative for those invariants.

BEGIN;

CREATE TABLE IF NOT EXISTS "eformsign_document_job" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "branch_id" UUID NOT NULL,
    "client_id" INTEGER,
    "document_id" TEXT,
    "job_type" VARCHAR(32) NOT NULL,
    "source" VARCHAR(20) NOT NULL,
    "status" VARCHAR(24) NOT NULL DEFAULT 'queued',
    "request_key" VARCHAR(255) NOT NULL,
    "active_key" VARCHAR(255),
    "payload" JSONB,
    "payload_fingerprint" CHAR(64),
    "progress_step" VARCHAR(80),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "next_attempt_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "heartbeat_at" TIMESTAMPTZ(6),
    "started_at" TIMESTAMPTZ(6),
    "completed_at" TIMESTAMPTZ(6),
    "last_error_code" VARCHAR(80),
    "created_by_user_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "eformsign_document_job_pkey" PRIMARY KEY ("id")
);

-- Converge a table left behind by an interrupted first execution. These are
-- all additive and preserve existing rows; a newly created table already has
-- the complete shape above.
ALTER TABLE "eformsign_document_job"
    ADD COLUMN IF NOT EXISTS "branch_id" UUID,
    ADD COLUMN IF NOT EXISTS "client_id" INTEGER,
    ADD COLUMN IF NOT EXISTS "document_id" TEXT,
    ADD COLUMN IF NOT EXISTS "job_type" VARCHAR(32),
    ADD COLUMN IF NOT EXISTS "source" VARCHAR(20),
    ADD COLUMN IF NOT EXISTS "status" VARCHAR(24) DEFAULT 'queued',
    ADD COLUMN IF NOT EXISTS "request_key" VARCHAR(255),
    ADD COLUMN IF NOT EXISTS "active_key" VARCHAR(255),
    ADD COLUMN IF NOT EXISTS "payload" JSONB,
    ADD COLUMN IF NOT EXISTS "payload_fingerprint" CHAR(64),
    ADD COLUMN IF NOT EXISTS "progress_step" VARCHAR(80),
    ADD COLUMN IF NOT EXISTS "attempts" INTEGER DEFAULT 0,
    ADD COLUMN IF NOT EXISTS "next_attempt_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    ADD COLUMN IF NOT EXISTS "heartbeat_at" TIMESTAMPTZ(6),
    ADD COLUMN IF NOT EXISTS "started_at" TIMESTAMPTZ(6),
    ADD COLUMN IF NOT EXISTS "completed_at" TIMESTAMPTZ(6),
    ADD COLUMN IF NOT EXISTS "last_error_code" VARCHAR(80),
    ADD COLUMN IF NOT EXISTS "created_by_user_id" UUID,
    ADD COLUMN IF NOT EXISTS "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    ADD COLUMN IF NOT EXISTS "updated_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE "eformsign_document_job"
    ALTER COLUMN "branch_id" SET NOT NULL,
    ALTER COLUMN "job_type" SET NOT NULL,
    ALTER COLUMN "source" SET NOT NULL,
    ALTER COLUMN "status" SET NOT NULL,
    ALTER COLUMN "request_key" SET NOT NULL,
    ALTER COLUMN "attempts" SET NOT NULL,
    ALTER COLUMN "next_attempt_at" SET NOT NULL,
    ALTER COLUMN "created_at" SET NOT NULL,
    ALTER COLUMN "updated_at" SET NOT NULL;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'eformsign_document_job_branch_id_fkey'
    ) THEN
        ALTER TABLE "eformsign_document_job"
            ADD CONSTRAINT "eformsign_document_job_branch_id_fkey"
            FOREIGN KEY ("branch_id") REFERENCES "branch"("id")
            ON DELETE NO ACTION ON UPDATE NO ACTION;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'eformsign_document_job_client_id_fkey'
    ) THEN
        ALTER TABLE "eformsign_document_job"
            ADD CONSTRAINT "eformsign_document_job_client_id_fkey"
            FOREIGN KEY ("client_id") REFERENCES "client"("id")
            ON DELETE SET NULL ON UPDATE NO ACTION;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'eformsign_document_job_created_by_user_id_fkey'
    ) THEN
        ALTER TABLE "eformsign_document_job"
            ADD CONSTRAINT "eformsign_document_job_created_by_user_id_fkey"
            FOREIGN KEY ("created_by_user_id") REFERENCES "user"("id")
            ON DELETE SET NULL ON UPDATE NO ACTION;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'eformsign_document_job_job_type_check'
    ) THEN
        ALTER TABLE "eformsign_document_job"
            ADD CONSTRAINT "eformsign_document_job_job_type_check"
            CHECK ("job_type" IN ('create_document', 'finalize_document'));
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'eformsign_document_job_source_check'
    ) THEN
        ALTER TABLE "eformsign_document_job"
            ADD CONSTRAINT "eformsign_document_job_source_check"
            CHECK ("source" IN ('staff', 'auto_finalize'));
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'eformsign_document_job_status_check'
    ) THEN
        ALTER TABLE "eformsign_document_job"
            ADD CONSTRAINT "eformsign_document_job_status_check"
            CHECK ("status" IN ('queued', 'processing', 'reconciling', 'completed', 'failed', 'requires_attention'));
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'eformsign_document_job_attempts_nonnegative_check'
    ) THEN
        ALTER TABLE "eformsign_document_job"
            ADD CONSTRAINT "eformsign_document_job_attempts_nonnegative_check"
            CHECK ("attempts" >= 0);
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'eformsign_document_job_payload_fingerprint_check'
    ) THEN
        ALTER TABLE "eformsign_document_job"
            ADD CONSTRAINT "eformsign_document_job_payload_fingerprint_check"
            CHECK ("payload_fingerprint" IS NULL OR "payload_fingerprint" ~ '^[0-9a-f]{64}$');
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'eformsign_document_job_last_error_code_check'
    ) THEN
        ALTER TABLE "eformsign_document_job"
            ADD CONSTRAINT "eformsign_document_job_last_error_code_check"
            CHECK ("last_error_code" IS NULL OR "last_error_code" ~ '^[A-Z0-9][A-Z0-9_:-]{0,79}$');
    END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "eformsign_document_job_request_key_key"
    ON "eformsign_document_job" ("request_key");

CREATE UNIQUE INDEX IF NOT EXISTS "eformsign_document_job_active_key_key"
    ON "eformsign_document_job" ("active_key");

CREATE INDEX IF NOT EXISTS "idx_eformsign_document_job_status_next_attempt_created"
    ON "eformsign_document_job" ("status", "next_attempt_at", "created_at");

CREATE INDEX IF NOT EXISTS "idx_eformsign_document_job_branch_status_updated"
    ON "eformsign_document_job" ("branch_id", "status", "updated_at");

CREATE INDEX IF NOT EXISTS "idx_eformsign_document_job_document_id"
    ON "eformsign_document_job" ("document_id");

CREATE INDEX IF NOT EXISTS "idx_eformsign_document_job_client_id"
    ON "eformsign_document_job" ("client_id");

COMMIT;
