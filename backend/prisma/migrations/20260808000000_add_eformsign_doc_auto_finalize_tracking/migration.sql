-- Track nightly auto-finalize attempts on maternity contracts so exhausted
-- documents (3 failed attempts) leave the retry pool and surface for manual
-- handling instead of hammering the headless browser every midnight.
ALTER TABLE "eformsign_doc"
    ADD COLUMN "auto_finalize_attempts" INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN "auto_finalize_last_attempt_at" TIMESTAMPTZ(6),
    ADD COLUMN "auto_finalize_last_error" TEXT;
