BEGIN;

ALTER TABLE "eformsign_doc"
    ADD COLUMN IF NOT EXISTS "template_name" TEXT,
    ADD COLUMN IF NOT EXISTS "customer_name" TEXT,
    ADD COLUMN IF NOT EXISTS "creator_name" TEXT,
    ADD COLUMN IF NOT EXISTS "last_editor_name" TEXT,
    ADD COLUMN IF NOT EXISTS "step_recipient_types" TEXT;

COMMIT;
