-- This migration is executed directly by database-patches.yml on every
-- environment push. Keep it safe to repeat while still failing closed if an
-- interrupted or out-of-band change left the column with the wrong shape.
BEGIN;

ALTER TABLE "eformsign_doc"
    ADD COLUMN IF NOT EXISTS "auto_registered_client" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "eformsign_doc"
    ALTER COLUMN "auto_registered_client" SET DEFAULT false,
    ALTER COLUMN "auto_registered_client" SET NOT NULL;

DO $$
DECLARE
    _column_type oid;
BEGIN
    SELECT atttypid
    INTO _column_type
    FROM pg_attribute
    WHERE attrelid = 'public.eformsign_doc'::regclass
      AND attname = 'auto_registered_client'
      AND NOT attisdropped;

    IF _column_type IS DISTINCT FROM 'pg_catalog.bool'::regtype THEN
        RAISE EXCEPTION 'eformsign_doc.auto_registered_client must remain boolean';
    END IF;
END $$;

COMMIT;
