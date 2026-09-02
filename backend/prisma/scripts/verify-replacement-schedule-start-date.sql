-- Guard for 20260902000000_repair_replacement_schedule_start_date.
--
-- Asserts that no replacement schedule still starts before its handover day, that the
-- repair left no inverted date range behind, and that service_record_assignment mirrors
-- the corrected schedule. Rows deliberately skipped by the patch (an in-flight 배정 안내
-- job whose payload fingerprint hashes start_date) are reported, not failed — they are
-- repaired by a later run once the job has dispatched.
DO $$
DECLARE
    _damaged bigint;
    _deferred bigint;
    _inverted bigint;
    _unmirrored bigint;
BEGIN
    IF to_regclass('public.employee_schedule') IS NULL THEN
        RAISE EXCEPTION 'employee_schedule table is missing';
    END IF;
    IF to_regclass('public.service_record_assignment') IS NULL THEN
        RAISE EXCEPTION 'service_record_assignment table is missing';
    END IF;
    IF to_regclass('public.message_trigger_job') IS NULL THEN
        RAISE EXCEPTION 'message_trigger_job table is missing';
    END IF;

    WITH chain AS (
        SELECT
            s."id",
            s."start_date",
            LAG(s."end_date") OVER (PARTITION BY s."client_id" ORDER BY s."id") AS prev_end_date
        FROM "employee_schedule" s
    ),
    still_damaged AS (
        SELECT
            c."id",
            EXISTS (
                SELECT 1
                FROM "message_trigger_job" j
                WHERE j."employee_schedule_id" = c."id"
                  AND j."status" IN ('pending', 'processing')
            ) AS has_in_flight_job
        FROM chain c
        WHERE c."prev_end_date" IS NOT NULL
          AND c."start_date" < c."prev_end_date"
    )
    SELECT
        count(*) FILTER (WHERE NOT has_in_flight_job),
        count(*) FILTER (WHERE has_in_flight_job)
    INTO _damaged, _deferred
    FROM still_damaged;

    IF _damaged > 0 THEN
        RAISE EXCEPTION
            '% replacement schedule(s) still start before their handover day', _damaged;
    END IF;

    SELECT count(*) INTO _inverted
    FROM "employee_schedule"
    WHERE "start_date" > "end_date";
    IF _inverted > 0 THEN
        RAISE EXCEPTION '% employee_schedule row(s) have an inverted date range', _inverted;
    END IF;

    SELECT count(*) INTO _unmirrored
    FROM "service_record_assignment" a
    JOIN "employee_schedule" s ON s."id" = a."schedule_id"
    WHERE a."start_date" IS DISTINCT FROM s."start_date"
       OR a."end_date" IS DISTINCT FROM s."end_date";
    IF _unmirrored > 0 THEN
        RAISE EXCEPTION
            '% service_record_assignment row(s) do not mirror their schedule dates', _unmirrored;
    END IF;

    IF _deferred > 0 THEN
        RAISE NOTICE
            '% replacement schedule(s) deferred: an in-flight 배정 안내 job pins start_date; a later run repairs them',
            _deferred;
    END IF;
END $$;
