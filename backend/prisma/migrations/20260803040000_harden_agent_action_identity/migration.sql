BEGIN;

ALTER TABLE "agent_action"
    ADD COLUMN IF NOT EXISTS "proposal_revision" TEXT,
    ADD COLUMN IF NOT EXISTS "request_dedupe_key" TEXT,
    ADD COLUMN IF NOT EXISTS "dedupe_expires_at" TIMESTAMPTZ(6);

UPDATE "agent_action"
SET
    "proposal_revision" = COALESCE("proposal_revision", "input_hash"),
    "request_dedupe_key" = COALESCE("request_dedupe_key", "idempotency_key"),
    "dedupe_expires_at" = COALESCE("dedupe_expires_at", "expires_at")
WHERE "proposal_revision" IS NULL
   OR "request_dedupe_key" IS NULL
   OR "dedupe_expires_at" IS NULL;

ALTER TABLE "agent_action"
    ALTER COLUMN "proposal_revision" SET NOT NULL,
    ALTER COLUMN "request_dedupe_key" SET NOT NULL,
    ALTER COLUMN "dedupe_expires_at" SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "agent_action_request_dedupe_key_key"
    ON "agent_action"("request_dedupe_key");
CREATE INDEX IF NOT EXISTS "idx_agent_action_dedupe_expires"
    ON "agent_action"("dedupe_expires_at");

CREATE UNIQUE INDEX IF NOT EXISTS "agent_feedback_message_user_key"
    ON "agent_feedback"("message_id", "user_id");

COMMIT;
