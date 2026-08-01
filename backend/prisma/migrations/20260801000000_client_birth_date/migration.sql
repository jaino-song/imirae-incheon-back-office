-- Add the client's actual birth date (출산일), tracked alongside the existing
-- expected due date (due_date). Nullable, no backfill: unknown for existing rows.

BEGIN;

ALTER TABLE "client"
    ADD COLUMN IF NOT EXISTS "birth_date" DATE;

COMMIT;
