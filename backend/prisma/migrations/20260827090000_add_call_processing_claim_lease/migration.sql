-- Persist the processing claim lease so abandoned provider calls can be reclaimed
-- without racing a worker that is still within its lease.
-- IF NOT EXISTS keeps the additive patch safe for the repository's repeated deploy
-- workflow and for databases that already received the column out of band.
ALTER TABLE "call_record"
    ADD COLUMN IF NOT EXISTS "processing_claimed_at" TIMESTAMPTZ(6);

CREATE INDEX IF NOT EXISTS "idx_call_record_processing_status_claimed_at"
    ON "call_record" ("processing_status", "processing_claimed_at");
