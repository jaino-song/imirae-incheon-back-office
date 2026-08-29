-- Durable local boundary for non-idempotent SMS provider requests.
-- Existing message_log rows remain readable and retry-compatible; their
-- provider_acceptance_state defaults to `legacy` until a new attempt is staged.
BEGIN;

ALTER TABLE "message_log"
    ADD COLUMN IF NOT EXISTS "provider_acceptance_key" TEXT,
    ADD COLUMN IF NOT EXISTS "provider_acceptance_fingerprint" TEXT,
    ADD COLUMN IF NOT EXISTS "provider_acceptance_state" VARCHAR(32) NOT NULL DEFAULT 'legacy',
    ADD COLUMN IF NOT EXISTS "provider_call_started_at" TIMESTAMPTZ(6),
    ADD COLUMN IF NOT EXISTS "provider_accepted_at" TIMESTAMPTZ(6),
    ADD COLUMN IF NOT EXISTS "provider_reconciled_at" TIMESTAMPTZ(6),
    ADD COLUMN IF NOT EXISTS "provider_reconciled_by" VARCHAR(200),
    ADD COLUMN IF NOT EXISTS "provider_reconciliation_reason" VARCHAR(1000);

CREATE UNIQUE INDEX IF NOT EXISTS "message_log_provider_acceptance_key_key"
    ON "message_log" ("provider_acceptance_key");

CREATE INDEX IF NOT EXISTS "idx_message_log_provider_acceptance_state_retry"
    ON "message_log" ("provider_acceptance_state", "next_retry_at");

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'message_log_provider_acceptance_state_check'
    ) THEN
        ALTER TABLE "message_log"
            ADD CONSTRAINT "message_log_provider_acceptance_state_check"
            CHECK ("provider_acceptance_state" IN (
                'legacy',
                'prepared',
                'started',
                'accepted',
                'rejected',
                'uncertain',
                'reconciled_not_delivered',
                'reconciled_delivered'
            ));
    END IF;
END $$;

COMMIT;
