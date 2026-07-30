ALTER TABLE "eformsign_doc"
ADD COLUMN IF NOT EXISTS "permanent_purge_requested_at" TIMESTAMPTZ(6);

CREATE INDEX IF NOT EXISTS "idx_eformsign_doc_permanent_purge_requested_at"
ON "eformsign_doc"("permanent_purge_requested_at");
