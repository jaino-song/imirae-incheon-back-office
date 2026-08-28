-- Keep the preflight and every DDL statement atomic. Prisma does not wrap
-- PostgreSQL migrations in a transaction automatically. This patch is run
-- directly on every environment push, so each additive object must be safe to
-- repeat while existing data and constraint drift still fail closed.
BEGIN;

-- Fail before changing the schema if legacy rows cannot satisfy the new
-- ownership invariant. Never guess which row should own a shared object.
DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM "document"
        WHERE "branch_id" IS NULL
    ) THEN
        RAISE EXCEPTION 'document visibility migration refused: rows with NULL branch_id must be assigned to a verified branch first';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM "document"
        GROUP BY "storage_path"
        HAVING COUNT(*) > 1
    ) THEN
        RAISE EXCEPTION 'document visibility migration refused: run scripts/remediate-document-storage-path-duplicates.ts before retrying';
    END IF;
END $$;

ALTER TABLE "document"
    ADD COLUMN IF NOT EXISTS "visibility_scope" VARCHAR(32) NOT NULL DEFAULT 'branch';

ALTER TABLE "document"
    ALTER COLUMN "visibility_scope" SET DEFAULT 'branch',
    ALTER COLUMN "visibility_scope" SET NOT NULL;

DO $$
DECLARE
    _column_type oid;
    _column_typmod integer;
BEGIN
    SELECT atttypid, atttypmod
    INTO _column_type, _column_typmod
    FROM pg_attribute
    WHERE attrelid = 'public.document'::regclass
      AND attname = 'visibility_scope'
      AND NOT attisdropped;

    IF _column_type IS DISTINCT FROM 'pg_catalog.varchar'::regtype
       OR _column_typmod IS DISTINCT FROM 36 THEN
        RAISE EXCEPTION 'document.visibility_scope must remain VARCHAR(32)';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM "document"
        WHERE "visibility_scope" NOT IN ('branch', 'all_branches')
    ) THEN
        RAISE EXCEPTION 'document visibility migration refused: visibility_scope contains an unsupported value';
    END IF;
END $$;

-- Constrain the fail-closed visibility vocabulary at the persistence boundary.
DO $$
DECLARE
    _constraint_definition text;
BEGIN
    SELECT pg_get_constraintdef(oid)
    INTO _constraint_definition
    FROM pg_constraint
    WHERE conname = 'document_visibility_scope_check'
      AND conrelid = 'public.document'::regclass;

    IF _constraint_definition IS NULL THEN
        ALTER TABLE "document"
        ADD CONSTRAINT "document_visibility_scope_check"
        CHECK ("visibility_scope" IN ('branch', 'all_branches'));
    ELSIF regexp_replace(lower(_constraint_definition), '\s+', '', 'g')
        <> 'check(((visibility_scope)::text=any((array[''branch''::charactervarying,''all_branches''::charactervarying])::text[])))' THEN
        RAISE EXCEPTION 'document_visibility_scope_check definition drifted';
    END IF;
END $$;

-- Every storage object may be owned by at most one document row.
CREATE UNIQUE INDEX IF NOT EXISTS "document_storage_path_key"
    ON "document"("storage_path");

DO $$
DECLARE
    _index_definition text;
BEGIN
    SELECT indexdef
    INTO _index_definition
    FROM pg_indexes
    WHERE schemaname = 'public'
      AND tablename = 'document'
      AND indexname = 'document_storage_path_key';

    IF _index_definition IS NULL
       OR _index_definition NOT LIKE 'CREATE UNIQUE INDEX%'
       OR _index_definition NOT LIKE '%storage_path%' THEN
        RAISE EXCEPTION 'document_storage_path_key definition drifted';
    END IF;
END $$;

-- CreateIndex
CREATE INDEX IF NOT EXISTS "idx_document_visibility_scope"
    ON "document"("visibility_scope");

DO $$
DECLARE
    _index_definition text;
BEGIN
    SELECT indexdef
    INTO _index_definition
    FROM pg_indexes
    WHERE schemaname = 'public'
      AND tablename = 'document'
      AND indexname = 'idx_document_visibility_scope';

    IF _index_definition IS NULL
       OR _index_definition LIKE 'CREATE UNIQUE INDEX%'
       OR _index_definition NOT LIKE '%visibility_scope%' THEN
        RAISE EXCEPTION 'idx_document_visibility_scope definition drifted';
    END IF;
END $$;

COMMIT;
