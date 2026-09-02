-- Record early termination on its own column instead of overwriting end_date.
--
-- terminateService used to close a client's active schedules by writing
-- end_date = today. That destroyed the contracted period and, for a schedule
-- terminated before it began, wrote start_date > end_date — an impossible
-- interval that this path never validated (updateMany bypasses the entity
-- invariant) and that no CHECK constraint catches.
--
-- Idempotent: the column add is guarded, and the backfill matches only rows
-- that still carry the defect, so a re-run is UPDATE 0.

ALTER TABLE "employee_schedule"
    ADD COLUMN IF NOT EXISTS "terminated_at" timestamptz(6);

COMMENT ON COLUMN "employee_schedule"."terminated_at" IS
    'When the client''s service was terminated early. Null means not terminated.';

-- Recover what is still recoverable from the inverted rows. end_date currently
-- holds the termination date, so move it to the column that means that, and
-- lift end_date back to a valid bound. The originally contracted end date was
-- overwritten before this migration existed and cannot be recovered.
UPDATE "employee_schedule"
SET "terminated_at" = COALESCE("terminated_at", "end_date"::timestamptz),
    "end_date"      = GREATEST("start_date", "end_date")
WHERE "start_date" > "end_date";

-- Backfill the flag for clients already terminated, so "is this assignment live"
-- becomes answerable from the schedule row instead of only from the client row.
-- The client's end_date was itself overwritten with the termination date by the
-- same code path, which is why it is the best available source here.
UPDATE "employee_schedule" s
SET "terminated_at" = c."end_date"::timestamptz
FROM "client" c
WHERE s."client_id" = c."id"
  AND c."service_status" = 'terminated'
  AND c."end_date" IS NOT NULL
  AND s."replaced" = false
  AND s."terminated_at" IS NULL;

-- Mirror the corrected bounds, matching the app's ensureForClient upsert.
UPDATE "service_record_assignment" a
SET "start_date" = s."start_date",
    "end_date"   = s."end_date"
FROM "employee_schedule" s
WHERE a."schedule_id" = s."id"
  AND (
      a."start_date" IS DISTINCT FROM s."start_date"
      OR a."end_date" IS DISTINCT FROM s."end_date"
  );
