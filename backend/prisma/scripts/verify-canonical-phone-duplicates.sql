-- Read-only pre-flight for the canonical phone identity migration
-- (20260829130000_add_canonical_phone_identity).
--
-- The migration itself fails closed: it RAISEs on duplicate
-- (branch_id, phone_normalized) groups before touching the old unique
-- constraints. Running this file BEFORE the patches in the production job
-- surfaces the same duplicates as an early, dedicated failure with the
-- offending groups listed, so they can be merged away before deploy instead
-- of aborting mid-workflow. It never writes.

DO $$
DECLARE
    _client_offending_rows   text;
    _employee_offending_rows text;
BEGIN
    SELECT string_agg(
        format('%s (branch=%s, phone_normalized=%s, rows=%s)',
               group_id, branch_id, phone_normalized, row_count),
        E'\n')
    INTO _client_offending_rows
    FROM (
        SELECT row_number() OVER () AS group_id,
               branch_id,
               phone_normalized,
               COUNT(*) AS row_count
        FROM "public"."client"
        WHERE phone_normalized IS NOT NULL AND branch_id IS NOT NULL
        GROUP BY branch_id, phone_normalized
        HAVING COUNT(*) > 1
    ) AS duplicate_group;

    IF _client_offending_rows IS NOT NULL THEN
        RAISE EXCEPTION 'client has duplicate (branch_id, phone_normalized) groups: %', _client_offending_rows;
    END IF;

    SELECT string_agg(
        format('%s (branch=%s, phone_normalized=%s, rows=%s)',
               group_id, branch_id, phone_normalized, row_count),
        E'\n')
    INTO _employee_offending_rows
    FROM (
        SELECT row_number() OVER () AS group_id,
               branch_id,
               phone_normalized,
               COUNT(*) AS row_count
        FROM "public"."employee"
        WHERE phone_normalized IS NOT NULL AND branch_id IS NOT NULL
        GROUP BY branch_id, phone_normalized
        HAVING COUNT(*) > 1
    ) AS duplicate_group;

    IF _employee_offending_rows IS NOT NULL THEN
        RAISE EXCEPTION 'employee has duplicate (branch_id, phone_normalized) groups: %', _employee_offending_rows;
    END IF;

    RAISE NOTICE 'canonical phone duplicates: none';
END $$;
