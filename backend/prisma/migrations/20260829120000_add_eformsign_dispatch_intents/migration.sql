-- Durable at-most-once boundary for every provider-changing eformsign action.
--
-- This patch is additive and idempotent because database-patches.yml executes
-- it directly on every environment push. Prisma cannot express the CHECK
-- constraints, so this SQL is authoritative for the state-machine invariants.

BEGIN;

CREATE TABLE IF NOT EXISTS "eformsign_dispatch_intent" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "branch_id" UUID NOT NULL,
    "client_id" INTEGER,
    "local_document_id" INTEGER,
    "assignment_id" INTEGER,
    "provider_document_id" TEXT,
    "template_id" TEXT,
    "action" VARCHAR(32) NOT NULL,
    "generation" VARCHAR(128) NOT NULL,
    "business_key" CHAR(64) NOT NULL,
    "fingerprint" CHAR(64) NOT NULL,
    "status" VARCHAR(32) NOT NULL DEFAULT 'prepared',
    "attempt_count" INTEGER NOT NULL DEFAULT 0,
    "started_at" TIMESTAMPTZ(6),
    "provider_accepted_at" TIMESTAMPTZ(6),
    "uncertain_at" TIMESTAMPTZ(6),
    "uncertain_reason" TEXT,
    "provider_receipt" JSONB,
    "reconciled_at" TIMESTAMPTZ(6),
    "reconciled_outcome" VARCHAR(24),
    "reconciled_by_user_id" UUID,
    "reconciliation_reason" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "eformsign_dispatch_intent_pkey" PRIMARY KEY ("id")
);

-- Converge a table left behind by an interrupted first execution. Missing
-- required values are rejected below rather than inventing ownership or intent
-- identity for existing rows.
ALTER TABLE "eformsign_dispatch_intent"
    ADD COLUMN IF NOT EXISTS "id" UUID DEFAULT gen_random_uuid(),
    ADD COLUMN IF NOT EXISTS "branch_id" UUID,
    ADD COLUMN IF NOT EXISTS "client_id" INTEGER,
    ADD COLUMN IF NOT EXISTS "local_document_id" INTEGER,
    ADD COLUMN IF NOT EXISTS "assignment_id" INTEGER,
    ADD COLUMN IF NOT EXISTS "provider_document_id" TEXT,
    ADD COLUMN IF NOT EXISTS "template_id" TEXT,
    ADD COLUMN IF NOT EXISTS "action" VARCHAR(32),
    ADD COLUMN IF NOT EXISTS "generation" VARCHAR(128),
    ADD COLUMN IF NOT EXISTS "business_key" CHAR(64),
    ADD COLUMN IF NOT EXISTS "fingerprint" CHAR(64),
    ADD COLUMN IF NOT EXISTS "status" VARCHAR(32) DEFAULT 'prepared',
    ADD COLUMN IF NOT EXISTS "attempt_count" INTEGER DEFAULT 0,
    ADD COLUMN IF NOT EXISTS "started_at" TIMESTAMPTZ(6),
    ADD COLUMN IF NOT EXISTS "provider_accepted_at" TIMESTAMPTZ(6),
    ADD COLUMN IF NOT EXISTS "uncertain_at" TIMESTAMPTZ(6),
    ADD COLUMN IF NOT EXISTS "uncertain_reason" TEXT,
    ADD COLUMN IF NOT EXISTS "provider_receipt" JSONB,
    ADD COLUMN IF NOT EXISTS "reconciled_at" TIMESTAMPTZ(6),
    ADD COLUMN IF NOT EXISTS "reconciled_outcome" VARCHAR(24),
    ADD COLUMN IF NOT EXISTS "reconciled_by_user_id" UUID,
    ADD COLUMN IF NOT EXISTS "reconciliation_reason" TEXT,
    ADD COLUMN IF NOT EXISTS "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    ADD COLUMN IF NOT EXISTS "updated_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP;

DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM "eformsign_dispatch_intent"
        WHERE id IS NULL OR branch_id IS NULL OR action IS NULL
           OR generation IS NULL OR business_key IS NULL OR fingerprint IS NULL
           OR status IS NULL OR attempt_count IS NULL
           OR created_at IS NULL OR updated_at IS NULL
    ) THEN
        RAISE EXCEPTION 'eformsign_dispatch_intent contains rows missing required values';
    END IF;
END $$;

ALTER TABLE "eformsign_dispatch_intent"
    ALTER COLUMN "id" SET NOT NULL,
    ALTER COLUMN "id" SET DEFAULT gen_random_uuid(),
    ALTER COLUMN "branch_id" SET NOT NULL,
    ALTER COLUMN "action" SET NOT NULL,
    ALTER COLUMN "generation" SET NOT NULL,
    ALTER COLUMN "business_key" SET NOT NULL,
    ALTER COLUMN "fingerprint" SET NOT NULL,
    ALTER COLUMN "status" SET NOT NULL,
    ALTER COLUMN "attempt_count" SET NOT NULL,
    ALTER COLUMN "created_at" SET NOT NULL,
    ALTER COLUMN "updated_at" SET NOT NULL;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'eformsign_dispatch_intent_pkey'
          AND conrelid = 'public.eformsign_dispatch_intent'::regclass
    ) THEN
        ALTER TABLE "eformsign_dispatch_intent"
            ADD CONSTRAINT "eformsign_dispatch_intent_pkey" PRIMARY KEY ("id");
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'eformsign_dispatch_intent_branch_id_fkey'
          AND conrelid = 'public.eformsign_dispatch_intent'::regclass
    ) THEN
        ALTER TABLE "eformsign_dispatch_intent"
            ADD CONSTRAINT "eformsign_dispatch_intent_branch_id_fkey"
            FOREIGN KEY ("branch_id") REFERENCES "branch"("id")
            ON DELETE NO ACTION ON UPDATE NO ACTION;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'eformsign_dispatch_intent_action_check'
          AND conrelid = 'public.eformsign_dispatch_intent'::regclass
    ) THEN
        ALTER TABLE "eformsign_dispatch_intent"
            ADD CONSTRAINT "eformsign_dispatch_intent_action_check"
            CHECK ("action" IN ('create', 'finalize'));
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'eformsign_dispatch_intent_status_check'
          AND conrelid = 'public.eformsign_dispatch_intent'::regclass
    ) THEN
        ALTER TABLE "eformsign_dispatch_intent"
            ADD CONSTRAINT "eformsign_dispatch_intent_status_check"
            CHECK ("status" IN (
                'prepared',
                'started',
                'uncertain',
                'accepted',
                'reconciled_not_delivered',
                'reconciled_delivered'
            ));
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'eformsign_dispatch_intent_reconciled_outcome_check'
          AND conrelid = 'public.eformsign_dispatch_intent'::regclass
    ) THEN
        ALTER TABLE "eformsign_dispatch_intent"
            ADD CONSTRAINT "eformsign_dispatch_intent_reconciled_outcome_check"
            CHECK ("reconciled_outcome" IS NULL OR "reconciled_outcome" IN ('delivered', 'not_delivered'));
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'eformsign_dispatch_intent_reconciliation_state_check'
          AND conrelid = 'public.eformsign_dispatch_intent'::regclass
    ) THEN
        ALTER TABLE "eformsign_dispatch_intent"
            ADD CONSTRAINT "eformsign_dispatch_intent_reconciliation_state_check"
            CHECK (
                ("status" <> 'reconciled_delivered' OR "reconciled_outcome" = 'delivered')
                AND ("status" <> 'reconciled_not_delivered' OR "reconciled_outcome" = 'not_delivered')
            );
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'eformsign_dispatch_intent_accepted_receipt_check'
          AND conrelid = 'public.eformsign_dispatch_intent'::regclass
    ) THEN
        ALTER TABLE "eformsign_dispatch_intent"
            ADD CONSTRAINT "eformsign_dispatch_intent_accepted_receipt_check"
            CHECK (
                "status" <> 'accepted'
                OR ("provider_document_id" IS NOT NULL AND length(btrim("provider_document_id")) > 0)
            );
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'eformsign_dispatch_intent_attempt_count_check'
          AND conrelid = 'public.eformsign_dispatch_intent'::regclass
    ) THEN
        ALTER TABLE "eformsign_dispatch_intent"
            ADD CONSTRAINT "eformsign_dispatch_intent_attempt_count_check"
            CHECK ("attempt_count" >= 0);
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'eformsign_dispatch_intent_identity_format_check'
          AND conrelid = 'public.eformsign_dispatch_intent'::regclass
    ) THEN
        ALTER TABLE "eformsign_dispatch_intent"
            ADD CONSTRAINT "eformsign_dispatch_intent_identity_format_check"
            CHECK (
                "business_key" ~ '^[0-9a-f]{64}$'
                AND "fingerprint" ~ '^[0-9a-f]{64}$'
                AND length(btrim("generation")) > 0
            );
    END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "eformsign_dispatch_intent_business_key"
    ON "eformsign_dispatch_intent" ("business_key");
CREATE INDEX IF NOT EXISTS "idx_eformsign_dispatch_intent_branch_status"
    ON "eformsign_dispatch_intent" ("branch_id", "status");
CREATE INDEX IF NOT EXISTS "idx_eformsign_dispatch_intent_branch_document"
    ON "eformsign_dispatch_intent" ("branch_id", "local_document_id");

COMMIT;
