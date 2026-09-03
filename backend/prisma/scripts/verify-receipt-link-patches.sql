-- Guard for 20260904000000_add_receipt_link_token and
-- 20260904000100_contract_auto_finalize_grace_days_7.
--
-- Asserts that the receipt_link_token table exists with its unique hash
-- indexes, its three foreign keys and its two CHECK constraints, and that no
-- branch auto-finalize setting written before the 2026-09-04 decision still
-- carries a graceDays other than 7 (rows the patch rewrote carry a newer
-- updated_at; rows an operator edited after the decision are theirs to keep).
-- Malformed or non-object settings rows are reported, not failed — the
-- service already falls back to the default for them.
DO $$
DECLARE
    _missing text;
    _stale bigint;
    _malformed bigint;
    _row record;
BEGIN
    IF to_regclass('public.receipt_link_token') IS NULL THEN
        RAISE EXCEPTION 'receipt_link_token table is missing';
    END IF;

    FOREACH _missing IN ARRAY ARRAY[
        'receipt_link_token_link_token_hash_key',
        'receipt_link_token_access_token_hash_key',
        'idx_receipt_link_token_doc_active',
        'idx_receipt_link_token_job',
        'idx_receipt_link_token_expires',
        'idx_receipt_link_token_branch'
    ] LOOP
        IF NOT EXISTS (
            SELECT 1 FROM pg_indexes
            WHERE schemaname = 'public' AND tablename = 'receipt_link_token'
              AND indexname = _missing
        ) THEN
            RAISE EXCEPTION 'receipt_link_token index % is missing', _missing;
        END IF;
    END LOOP;

    FOREACH _missing IN ARRAY ARRAY[
        'receipt_link_token_branch_id_fkey',
        'receipt_link_token_client_id_fkey',
        'receipt_link_token_eformsign_doc_id_fkey',
        'receipt_link_token_source_check',
        'receipt_link_token_failed_attempts_check'
    ] LOOP
        IF NOT EXISTS (
            SELECT 1 FROM pg_constraint
            WHERE conname = _missing
              AND conrelid = 'public.receipt_link_token'::regclass
        ) THEN
            RAISE EXCEPTION 'receipt_link_token constraint % is missing', _missing;
        END IF;
    END LOOP;

    _stale := 0;
    _malformed := 0;
    FOR _row IN
        SELECT "key", "value", "updated_at"
        FROM "system_setting"
        WHERE "key" LIKE 'branch:%:contract_automation:auto_finalize'
          AND "updated_at" < TIMESTAMP '2026-09-04'
    LOOP
        BEGIN
            IF jsonb_typeof(_row."value"::jsonb) <> 'object' THEN
                _malformed := _malformed + 1;
            ELSIF (_row."value"::jsonb ->> 'graceDays') IS DISTINCT FROM '7' THEN
                _stale := _stale + 1;
            END IF;
        EXCEPTION WHEN invalid_text_representation THEN
            _malformed := _malformed + 1;
        END;
    END LOOP;

    IF _stale > 0 THEN
        RAISE EXCEPTION
            '% branch auto-finalize setting(s) from before 2026-09-04 still lack graceDays 7', _stale;
    END IF;
    IF _malformed > 0 THEN
        RAISE NOTICE
            '% branch auto-finalize setting(s) are not JSON objects; the service uses the default for them',
            _malformed;
    END IF;
END $$;
