-- Verifies 20260807000000_scope_document_category_value_per_branch.
-- Every assertion below is guaranteed by that migration, which runs immediately
-- before this file in .github/workflows/database-patches.yml, so this script is
-- safe to execute on every push in every environment.
DO $$
BEGIN
    IF to_regclass('public.document_category') IS NULL THEN
        RAISE EXCEPTION 'document_category table is missing';
    END IF;

    IF EXISTS (
        SELECT 1 FROM pg_indexes
        WHERE schemaname = 'public'
          AND indexname = 'document_category_value_key'
    ) THEN
        RAISE EXCEPTION 'legacy global unique index document_category_value_key still exists; category values must be unique per branch, not globally';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_indexes
        WHERE schemaname = 'public'
          AND indexname = 'document_category_branch_id_value_key'
    ) THEN
        RAISE EXCEPTION 'per-branch unique index document_category_branch_id_value_key is missing';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_indexes
        WHERE schemaname = 'public'
          AND indexname = 'document_category_value_global_key'
    ) THEN
        RAISE EXCEPTION 'global partial unique index document_category_value_global_key is missing';
    END IF;

    -- Data invariants. Both are enforced by the two unique indexes checked above,
    -- so they cannot fail while those indexes exist — asserted anyway so an index
    -- drop combined with data drift cannot go unnoticed.
    IF EXISTS (
        SELECT "value"
        FROM "document_category"
        WHERE "branch_id" IS NULL
        GROUP BY "value"
        HAVING COUNT(*) > 1
    ) THEN
        RAISE EXCEPTION 'duplicate global (branch-null) document_category values exist';
    END IF;

    IF EXISTS (
        SELECT "branch_id", "value"
        FROM "document_category"
        WHERE "branch_id" IS NOT NULL
        GROUP BY "branch_id", "value"
        HAVING COUNT(*) > 1
    ) THEN
        RAISE EXCEPTION 'duplicate document_category values exist within a single branch';
    END IF;
END $$;
