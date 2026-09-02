-- Every provider-facing message-trigger attempt gets a unique claim token.
-- The token is rotated atomically when a pending row is claimed and cleared
-- whenever a source mutation cancels an active attempt. Terminal completion
-- writes use it as a compare-and-swap fence, so an older worker cannot mutate
-- a newer claim.
ALTER TABLE "message_trigger_job"
    ADD COLUMN IF NOT EXISTS "claim_token" TEXT;

-- Preserve the invariant for rows that were already processing when this
-- additive migration lands. Pending/terminal rows intentionally remain null
-- until a worker claims them.
UPDATE "message_trigger_job"
SET "claim_token" = gen_random_uuid()::text
WHERE "status" = 'processing'
  AND "claim_token" IS NULL;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'message_trigger_job_processing_claim_token_check'
          AND conrelid = 'public.message_trigger_job'::regclass
    ) THEN
        ALTER TABLE "message_trigger_job"
            ADD CONSTRAINT "message_trigger_job_processing_claim_token_check"
            CHECK ("status" <> 'processing' OR "claim_token" IS NOT NULL);
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS "idx_message_trigger_job_claim_token"
    ON "message_trigger_job" ("claim_token")
    WHERE "claim_token" IS NOT NULL;
