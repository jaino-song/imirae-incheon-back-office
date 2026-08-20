-- INTENTIONALLY NOT WIRED INTO .github/workflows/database-patches.yml.
--
-- The multi-tenancy backfill (prisma/scripts/migrate-to-multi-tenancy-clean.ts)
-- used to read documents through `where: { orgId: null }` while writing branch_id,
-- so every document that already carried a non-null legacy org_id was silently
-- skipped and kept branch_id = NULL. Such rows are invisible to every branch
-- (all repository queries filter on branch_id), keep their storage objects billed
-- forever, and permanently block their storage_path from reuse
-- (legacy rows without a branch remain outside every branch-scoped mutation path).
--
-- Do NOT add this file to the database-patches workflow until production has been
-- checked with both:
--
--     SELECT count(*) FROM document WHERE branch_id IS NULL;
--     SELECT storage_path, count(*) FROM document
--       GROUP BY storage_path HAVING count(*) > 1;
--
-- If that count is non-zero, wiring this file up would fail the DB patch job in
-- every environment on every push. First re-run the (now fixed) backfill script or
-- remediate the rows manually, confirm the count reads 0, and only then add this
-- verify step after the corresponding migration step in all three workflow jobs.
DO $$
BEGIN
    IF to_regclass('public.document') IS NULL THEN
        RAISE EXCEPTION 'document table is missing';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM "document"
        WHERE "branch_id" IS NULL
    ) THEN
        RAISE EXCEPTION 'document rows with NULL branch_id exist; they are invisible to every branch and must be reassigned to a branch';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM "document"
        GROUP BY "storage_path"
        HAVING COUNT(*) > 1
    ) THEN
        RAISE EXCEPTION 'document rows share storage_path ownership; inspect and remediate them before applying the visibility migration';
    END IF;
END $$;
