-- Data patch: every branch's contract auto-finalize grace period becomes 7
-- days (operator decision 2026-09-03). This file is re-executed on every push
-- by the database-patches workflow (no _prisma_migrations tracking — see
-- prisma/README.md), so it carries two guards:
--   1. A malformed system_setting.value (e.g. truncated JSON) is skipped, not
--      allowed to abort the whole run: the ::jsonb cast happens inside a
--      nested BEGIN/EXCEPTION block per row, mirroring the defensive parsing
--      in SystemSettingService.parseContractAutoFinalizeConfig. A value that
--      parses but isn't a JSON object (e.g. a bare scalar) is skipped too.
--   2. Only rows last updated before 2026-09-04 00:00 KST are rewritten, so
--      re-running this file on a later deploy never clobbers an operator's
--      edit made AFTER 2026-09-04 00:00 KST — and only edits after that
--      instant are protected; an edit that already landed before the cutoff
--      is indistinguishable from this patch's own prior run and is rewritten
--      again on every re-run, same as an untouched row. The cutoff is a
--      TIMESTAMPTZ literal with an explicit +09 offset (not a bare TIMESTAMP),
--      so the comparison is the same absolute instant regardless of the
--      connection's session timezone — a bare TIMESTAMP would be interpreted
--      in whatever timezone the running session happens to have set.
DO $$
DECLARE
    r RECORD;
    parsed JSONB;
BEGIN
    FOR r IN
        SELECT key, value
        FROM system_setting
        WHERE key LIKE 'branch:%:contract_automation:auto_finalize'
          AND updated_at < TIMESTAMPTZ '2026-09-04 00:00:00+09'
    LOOP
        BEGIN
            parsed := r.value::jsonb;
        EXCEPTION WHEN invalid_text_representation THEN
            RAISE NOTICE 'skipping malformed system_setting row %', r.key;
            CONTINUE;
        END;

        IF jsonb_typeof(parsed) <> 'object' THEN
            RAISE NOTICE 'skipping non-object system_setting row %', r.key;
            CONTINUE;
        END IF;

        UPDATE system_setting
        SET value = jsonb_set(parsed, '{graceDays}', '7', true)::text,
            updated_at = now()
        WHERE key = r.key;
    END LOOP;
END $$;
