-- BJJ-AUD-83: finite, atomic service-record phone challenge defense.
-- Additive and backfill-safe: legacy rows keep their existing expiry/attempt count;
-- rows that already recorded five or more failures are conservatively locked.

ALTER TABLE "service_record_token"
    ADD COLUMN IF NOT EXISTS "challenge_window_started_at" TIMESTAMPTZ(6);

ALTER TABLE "service_record_token"
    ADD COLUMN IF NOT EXISTS "locked_at" TIMESTAMPTZ(6);

UPDATE "service_record_token"
SET "challenge_window_started_at" = COALESCE("challenge_window_started_at", "created_at")
WHERE "failed_attempts" > 0
  AND "challenge_window_started_at" IS NULL;

UPDATE "service_record_token"
SET "locked_at" = COALESCE("locked_at", "created_at")
WHERE "failed_attempts" >= 5
  AND "locked_at" IS NULL
  AND "active" = TRUE
  AND "revoked_at" IS NULL;

CREATE INDEX IF NOT EXISTS "idx_service_record_token_challenge_state"
    ON "service_record_token" ("active", "locked_at", "expires_at");
