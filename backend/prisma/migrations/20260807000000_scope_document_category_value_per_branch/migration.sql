-- Scope document_category.value uniqueness per branch (multi-tenancy fix).
--
-- Before: value was globally unique (document_category_value_key from 0_init), so
-- no two branches could ever use the same category value. On top of that, the
-- multi-tenancy backfill (prisma/scripts/migrate-to-multi-tenancy-clean.ts) had
-- assigned every category — including the eight global seed categories from
-- prisma/migrate-categories.ts — to the first branch with is_custom = true.
-- A second branch therefore saw an empty category list (findAll returns
-- branch_id = mine OR branch_id IS NULL, and no branch-null rows were left) and
-- could not recreate "contract" etc. because the global unique fired. Since
-- category_id is required on upload, that branch could not upload at all.
--
-- After:
--   * value is unique per branch:    document_category_branch_id_value_key (branch_id, value)
--   * value is unique among globals: document_category_value_global_key (value) WHERE branch_id IS NULL
--     (partial unique index — Prisma cannot express it; schema.prisma carries a
--     "Database note" comment on the model instead)
--   * the eight seed categories are restored to global scope
--     (branch_id = NULL, is_custom = false)
--
-- Idempotency: this file is re-executed on every push to dev/preview/main by
-- .github/workflows/database-patches.yml, so every statement is guarded. The
-- remediation UPDATE only touches rows still in the broken state and never flips
-- a row onto a value that already has a global twin, so it cannot violate the
-- partial unique index on any re-run.

BEGIN;

-- 1. Drop the global unique on value. 0_init created it as a plain UNIQUE INDEX
--    (document_category_value_key); the DROP CONSTRAINT is belt-and-braces for
--    any environment where the same name exists as a table constraint instead.
ALTER TABLE "document_category" DROP CONSTRAINT IF EXISTS "document_category_value_key";
DROP INDEX IF EXISTS "document_category_value_key";

-- 2. Restore the eight seed categories to global scope. On the first run the old
--    global unique guarantees at most one row per value repo-wide, so matching on
--    the known value strings is well-defined. Guards for re-runs:
--      * branch_id IS NOT NULL — no-op once the row is already global;
--      * NOT EXISTS global twin — never flips a branch-owned row onto a value that
--        already has a global row (that UPDATE would violate the partial unique
--        index below and permanently break this patch job);
--      * DISTINCT ON (value) — flips at most one row per value even if duplicates
--        were created after the global unique was dropped, so the statement can
--        never collide with itself.
UPDATE "document_category" dc
SET "branch_id" = NULL,
    "is_custom" = false
WHERE dc."id" IN (
        SELECT DISTINCT ON ("value") "id"
        FROM "document_category"
        WHERE "value" IN (
                'contract', 'invoice', 'receipt', 'report',
                'certificate', 'form', 'notice', 'employee-contract'
            )
          AND "branch_id" IS NOT NULL
        ORDER BY "value", "created_at" ASC, "id" ASC
    )
  AND NOT EXISTS (
        SELECT 1
        FROM "document_category" g
        WHERE g."value" = dc."value"
          AND g."branch_id" IS NULL
    );

-- Defensive normalization: a seed row that is already global but still flagged
-- custom (should not occur — the UPDATE above sets both columns together — but
-- costs nothing and converges the flag).
UPDATE "document_category"
SET "is_custom" = false
WHERE "value" IN (
        'contract', 'invoice', 'receipt', 'report',
        'certificate', 'form', 'notice', 'employee-contract'
    )
  AND "branch_id" IS NULL
  AND "is_custom" = true;

-- 3. Per-branch uniqueness (matches @@unique([branchId, value]) in schema.prisma).
--    Safe on first run: the old global unique implies no duplicate (branch_id, value).
CREATE UNIQUE INDEX IF NOT EXISTS "document_category_branch_id_value_key"
    ON "document_category"("branch_id", "value");

-- 4. Global rows are not constrained by the composite unique (Postgres never
--    treats two NULLs as equal), so keep global category values unique with a
--    partial unique index. Safe on first run for the same reason as step 3.
CREATE UNIQUE INDEX IF NOT EXISTS "document_category_value_global_key"
    ON "document_category"("value")
    WHERE "branch_id" IS NULL;

COMMIT;
