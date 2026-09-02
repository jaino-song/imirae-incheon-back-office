-- Repair replacement assignments whose start_date inherited the client's contract start.
--
-- Two of the three handover paths (ClientService.update and syncEmployeeAssignment)
-- truncated the OUTGOING schedule to the handover day but created the INCOMING one
-- with the client's contract start, so every provider in a client's chain appeared to
-- have begun on the contract's first day. The outgoing end_date was always written
-- correctly, so it carries the true handover date and the chain is recoverable:
--
--     incoming.start_date := previous schedule's end_date
--
-- Idempotent by construction: the guards below match only rows that still carry the
-- defect, so a re-run is UPDATE 0. The workflow re-executes this on every push.

-- 1) employee_schedule: pull each replacement's start back onto the handover day.
WITH chain AS (
    SELECT
        s."id",
        s."start_date",
        s."end_date",
        LAG(s."end_date") OVER (PARTITION BY s."client_id" ORDER BY s."id") AS prev_end_date
    FROM "employee_schedule" s
),
repairable AS (
    SELECT
        c."id",
        c."prev_end_date" AS new_start_date,
        -- A handover on an already-ended contract would otherwise invert the range.
        -- Pull the end up to the handover day rather than extending by a default
        -- service period, matching employeeScheduleHandoverPeriod in the app.
        GREATEST(c."end_date", c."prev_end_date") AS new_end_date
    FROM chain c
    WHERE c."prev_end_date" IS NOT NULL
      -- Only a start that sits BEFORE the handover is the defect. A later start is a
      -- legitimate gap between assignments and must not be dragged backwards.
      AND c."start_date" < c."prev_end_date"
      -- Skip schedules with an in-flight 배정 안내 job: start_date is hashed into the
      -- job's payload fingerprint, and rewriting it here would cancel the send
      -- terminally. These are picked up by a later run once the job has dispatched.
      AND NOT EXISTS (
          SELECT 1
          FROM "message_trigger_job" j
          WHERE j."employee_schedule_id" = c."id"
            AND j."status" IN ('pending', 'processing')
      )
)
UPDATE "employee_schedule" s
SET "start_date" = r."new_start_date",
    "end_date"   = r."new_end_date"
FROM repairable r
WHERE s."id" = r."id";

-- 2) service_record_assignment mirrors the schedule verbatim at write time, so it
--    carries the same wrong dates. Re-mirror from the corrected source; this is the
--    same assignment the app's ensureForClient upsert performs on its next run.
UPDATE "service_record_assignment" a
SET "start_date" = s."start_date",
    "end_date"   = s."end_date"
FROM "employee_schedule" s
WHERE a."schedule_id" = s."id"
  AND (
      a."start_date" IS DISTINCT FROM s."start_date"
      OR a."end_date" IS DISTINCT FROM s."end_date"
  );
