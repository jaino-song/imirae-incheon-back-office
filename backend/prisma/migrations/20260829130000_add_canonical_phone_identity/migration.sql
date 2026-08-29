-- Persist a formatting-independent phone identity while retaining the
-- user-entered display value in phone. Existing duplicates are rejected before
-- replacing the legacy raw-phone indexes; no row is selected as a winner.

BEGIN;

ALTER TABLE "public"."client"
    ADD COLUMN IF NOT EXISTS "phone_normalized" TEXT;

ALTER TABLE "public"."employee"
    ADD COLUMN IF NOT EXISTS "phone_normalized" TEXT;

-- Backfill clients using the same digit extraction and +82 conversion as the
-- application canonicalizer. Invalid values are left NULL so the migration
-- does not invent an identity for an unparseable legacy display value.
WITH stripped AS (
    SELECT
        "id",
        CASE
            WHEN "phone" IS NULL THEN NULL
            ELSE regexp_replace("phone", '\D', '', 'g')
        END AS "digits"
    FROM "public"."client"
), canonical AS (
    SELECT
        "id",
        CASE
            WHEN "digits" LIKE '82%' THEN '0' || substring("digits" FROM 3)
            ELSE "digits"
        END AS "candidate"
    FROM stripped
), normalized AS (
    SELECT
        "id",
        CASE
            WHEN "candidate" IS NOT NULL
                AND length("candidate") BETWEEN 9 AND 11
                AND left("candidate", 1) = '0'
            THEN "candidate"
            ELSE NULL
        END AS "phone_normalized"
    FROM canonical
)
UPDATE "public"."client" AS target
SET "phone_normalized" = normalized."phone_normalized"
FROM normalized
WHERE target."id" = normalized."id";

-- Backfill employees with the same deterministic rule. Employee.phone remains
-- required for display compatibility, so an unparseable legacy value receives
-- a NULL identity key and is surfaced for remediation instead of being guessed.
WITH stripped AS (
    SELECT
        "id",
        regexp_replace("phone", '\D', '', 'g') AS "digits"
    FROM "public"."employee"
), canonical AS (
    SELECT
        "id",
        CASE
            WHEN "digits" LIKE '82%' THEN '0' || substring("digits" FROM 3)
            ELSE "digits"
        END AS "candidate"
    FROM stripped
), normalized AS (
    SELECT
        "id",
        CASE
            WHEN "candidate" IS NOT NULL
                AND length("candidate") BETWEEN 9 AND 11
                AND left("candidate", 1) = '0'
            THEN "candidate"
            ELSE NULL
        END AS "phone_normalized"
    FROM canonical
)
UPDATE "public"."employee" AS target
SET "phone_normalized" = normalized."phone_normalized"
FROM normalized
WHERE target."id" = normalized."id";

-- A formatting-equivalent collision is a data error, not a deduplication
-- opportunity. Abort the transaction with stable, row-identifying evidence.
DO $$
DECLARE
    _client_offending_rows jsonb;
    _employee_offending_rows jsonb;
BEGIN
    SELECT jsonb_agg(to_jsonb(duplicate_group) ORDER BY duplicate_group."branch_id", duplicate_group."phone_normalized")
    INTO _client_offending_rows
    FROM (
        SELECT
            "branch_id",
            "phone_normalized",
            array_agg("id" ORDER BY "id") AS "client_ids",
            COUNT(*) AS "duplicate_count"
        FROM "public"."client"
        WHERE "branch_id" IS NOT NULL
          AND "phone_normalized" IS NOT NULL
        GROUP BY "branch_id", "phone_normalized"
        HAVING COUNT(*) > 1
    ) AS duplicate_group;

    IF _client_offending_rows IS NOT NULL THEN
        RAISE EXCEPTION 'client has duplicate (branch_id, phone_normalized) groups: %', _client_offending_rows;
    END IF;

    SELECT jsonb_agg(to_jsonb(duplicate_group) ORDER BY duplicate_group."branch_id", duplicate_group."phone_normalized")
    INTO _employee_offending_rows
    FROM (
        SELECT
            "branch_id",
            "phone_normalized",
            array_agg("id" ORDER BY "id") AS "employee_ids",
            COUNT(*) AS "duplicate_count"
        FROM "public"."employee"
        WHERE "branch_id" IS NOT NULL
          AND "phone_normalized" IS NOT NULL
        GROUP BY "branch_id", "phone_normalized"
        HAVING COUNT(*) > 1
    ) AS duplicate_group;

    IF _employee_offending_rows IS NOT NULL THEN
        RAISE EXCEPTION 'employee has duplicate (branch_id, phone_normalized) groups: %', _employee_offending_rows;
    END IF;
END $$;

-- Replace the raw display-phone indexes with canonical branch-scoped indexes.
ALTER TABLE "public"."client"
    DROP CONSTRAINT IF EXISTS "client_branch_phone_key";
DROP INDEX IF EXISTS "public"."client_branch_phone_key";
ALTER TABLE "public"."employee"
    DROP CONSTRAINT IF EXISTS "employee_branch_id_phone_key";
DROP INDEX IF EXISTS "public"."employee_branch_id_phone_key";

DROP INDEX IF EXISTS "public"."client_branch_phone_normalized_key";
CREATE UNIQUE INDEX "client_branch_phone_normalized_key"
    ON "public"."client"("branch_id", "phone_normalized");

DROP INDEX IF EXISTS "public"."employee_branch_id_phone_normalized_key";
CREATE UNIQUE INDEX "employee_branch_id_phone_normalized_key"
    ON "public"."employee"("branch_id", "phone_normalized");

COMMIT;
