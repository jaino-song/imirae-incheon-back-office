-- BJJ-AUD-52: durable auth-email provider boundary.
--
-- Provider calls must not run inside a database transaction. The outbox row
-- records a stable provider key and attempt version before the call so a
-- worker restart can fail closed instead of replaying an ambiguous request.

BEGIN;

ALTER TABLE "auth_email_outbox"
    ADD COLUMN IF NOT EXISTS "attempt_version" INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS "provider_idempotency_key" VARCHAR(255),
    ADD COLUMN IF NOT EXISTS "provider_message_id" VARCHAR(255),
    ADD COLUMN IF NOT EXISTS "provider_started_at" TIMESTAMPTZ(6),
    ADD COLUMN IF NOT EXISTS "provider_accepted_at" TIMESTAMPTZ(6),
    ADD COLUMN IF NOT EXISTS "uncertain_at" TIMESTAMPTZ(6),
    ADD COLUMN IF NOT EXISTS "uncertain_reason" VARCHAR(1000);

-- Existing rows need an opaque, row-stable key before the column becomes
-- required. Their previous attempt count is the best available CAS version.
UPDATE "auth_email_outbox"
SET
    "provider_idempotency_key" = COALESCE(
        "provider_idempotency_key",
        'auth-email:' || "id"::text
    ),
    "attempt_version" = GREATEST(
        COALESCE("attempt_version", 0),
        COALESCE("attempts", 0)
    )
WHERE "provider_idempotency_key" IS NULL
   OR "attempt_version" IS NULL
   OR "attempt_version" < "attempts";

-- Rows left in the old processing state may have crossed the provider
-- boundary. Preserve them as uncertain rather than replaying them.
UPDATE "auth_email_outbox"
SET
    "status" = 'uncertain',
    "claimed_at" = NULL,
    "provider_started_at" = COALESCE("provider_started_at", "claimed_at", "updated_at"),
    "uncertain_at" = COALESCE("uncertain_at", "claimed_at", "updated_at", NOW()),
    "uncertain_reason" = COALESCE(
        "uncertain_reason",
        'legacy_processing_requires_reconciliation'
    ),
    "error_code" = 'provider_uncertain'
WHERE "status" = 'processing';

UPDATE "auth_email_outbox"
SET
    "status" = 'accepted',
    "claimed_at" = NULL,
    "provider_accepted_at" = COALESCE("provider_accepted_at", "sent_at")
WHERE "status" = 'sent';

UPDATE "auth_email_outbox"
SET "status" = 'prepared'
WHERE "status" = 'pending';

-- A legacy retry does not tell us whether the provider request crossed the
-- boundary before the old transaction failed. Keep it fail-closed until an
-- operator/provider lookup proves the outcome.
UPDATE "auth_email_outbox"
SET
    "status" = 'uncertain',
    "claimed_at" = NULL,
    "uncertain_at" = COALESCE("uncertain_at", "updated_at", NOW()),
    "uncertain_reason" = COALESCE(
        "uncertain_reason",
        'legacy_retry_requires_reconciliation'
    ),
    "error_code" = 'provider_uncertain'
WHERE "status" = 'retry';

ALTER TABLE "auth_email_outbox"
    ALTER COLUMN "attempt_version" SET DEFAULT 0,
    ALTER COLUMN "attempt_version" SET NOT NULL,
    ALTER COLUMN "provider_idempotency_key" SET NOT NULL;

ALTER TABLE "auth_email_outbox"
    ALTER COLUMN "provider_idempotency_key" SET DEFAULT ((gen_random_uuid())::text),
    ALTER COLUMN "status" SET DEFAULT 'prepared';

CREATE UNIQUE INDEX IF NOT EXISTS "auth_email_outbox_provider_idempotency_key_key"
    ON "auth_email_outbox" ("provider_idempotency_key");

CREATE INDEX IF NOT EXISTS "idx_auth_email_outbox_provider_boundary"
    ON "auth_email_outbox" ("status", "attempt_version");

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'auth_email_outbox_provider_status_check'
          AND conrelid = 'public.auth_email_outbox'::regclass
    ) THEN
        ALTER TABLE "auth_email_outbox"
            ADD CONSTRAINT "auth_email_outbox_provider_status_check"
            CHECK ("status" IN (
                'prepared',
                'started',
                'accepted',
                'uncertain',
                'failed',
                -- Kept during rolling deployment for old workers. The
                -- normalization above converges existing rows immediately.
                'pending',
                'retry',
                'processing',
                'sent'
            ));
    END IF;
END $$;

COMMIT;
