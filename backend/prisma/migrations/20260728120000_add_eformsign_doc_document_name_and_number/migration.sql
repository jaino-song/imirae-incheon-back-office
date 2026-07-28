BEGIN;

ALTER TABLE "eformsign_doc"
    ADD COLUMN IF NOT EXISTS "document_name" TEXT,
    ADD COLUMN IF NOT EXISTS "document_number" TEXT;

COMMIT;
