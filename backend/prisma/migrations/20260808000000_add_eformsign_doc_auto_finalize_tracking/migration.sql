-- Track nightly auto-finalize attempts on maternity contracts so exhausted
-- documents (3 failed attempts) leave the retry pool and surface for manual
-- handling instead of hammering the headless browser every midnight.
-- IF NOT EXISTS: the database-patches workflow re-runs every step on each
-- push to dev/preview/main, so every patch must be idempotent.
ALTER TABLE "eformsign_doc"
    ADD COLUMN IF NOT EXISTS "auto_finalize_attempts" INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS "auto_finalize_last_attempt_at" TIMESTAMPTZ(6),
    ADD COLUMN IF NOT EXISTS "auto_finalize_last_error" TEXT;
