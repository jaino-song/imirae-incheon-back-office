-- Fail-closed verification for 20260813000000_add_eformsign_document_jobs.
DO $$
DECLARE
    missing_columns TEXT;
BEGIN
    IF to_regclass('public.eformsign_document_job') IS NULL THEN
        RAISE EXCEPTION 'eformsign_document_job table is missing';
    END IF;

    SELECT string_agg(required.column_name, ', ' ORDER BY required.column_name)
    INTO missing_columns
    FROM (
        VALUES
            ('id'), ('branch_id'), ('client_id'), ('document_id'), ('job_type'),
            ('source'), ('status'), ('request_key'), ('active_key'), ('payload'),
            ('payload_fingerprint'), ('progress_step'), ('attempts'),
            ('next_attempt_at'), ('heartbeat_at'), ('started_at'), ('completed_at'),
            ('last_error_code'), ('created_by_user_id'), ('created_at'), ('updated_at')
    ) AS required(column_name)
    WHERE NOT EXISTS (
        SELECT 1
        FROM information_schema.columns actual
        WHERE actual.table_schema = 'public'
          AND actual.table_name = 'eformsign_document_job'
          AND actual.column_name = required.column_name
    );

    IF missing_columns IS NOT NULL THEN
        RAISE EXCEPTION 'eformsign_document_job columns are missing: %', missing_columns;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'eformsign_document_job'
          AND column_name = 'branch_id' AND data_type = 'uuid' AND is_nullable = 'NO'
    ) THEN
        RAISE EXCEPTION 'eformsign_document_job.branch_id must be required uuid';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'eformsign_document_job'
          AND column_name = 'payload' AND data_type = 'jsonb'
    ) THEN
        RAISE EXCEPTION 'eformsign_document_job.payload must be jsonb';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_indexes
        WHERE schemaname = 'public'
          AND indexname = 'eformsign_document_job_request_key_key'
    ) THEN
        RAISE EXCEPTION 'eformsign_document_job request_key unique index is missing';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_indexes
        WHERE schemaname = 'public'
          AND indexname = 'eformsign_document_job_active_key_key'
          AND indexdef LIKE 'CREATE UNIQUE INDEX%'
    ) THEN
        RAISE EXCEPTION 'eformsign_document_job active_key unique index is missing';
    END IF;

    FOREACH missing_columns IN ARRAY ARRAY[
        'idx_eformsign_document_job_status_next_attempt_created',
        'idx_eformsign_document_job_branch_status_updated',
        'idx_eformsign_document_job_document_id',
        'idx_eformsign_document_job_client_id'
    ] LOOP
        IF to_regclass(format('public.%I', missing_columns)) IS NULL THEN
            RAISE EXCEPTION 'eformsign_document_job index % is missing', missing_columns;
        END IF;
    END LOOP;

    FOREACH missing_columns IN ARRAY ARRAY[
        'eformsign_document_job_branch_id_fkey',
        'eformsign_document_job_client_id_fkey',
        'eformsign_document_job_created_by_user_id_fkey',
        'eformsign_document_job_job_type_check',
        'eformsign_document_job_source_check',
        'eformsign_document_job_status_check',
        'eformsign_document_job_attempts_nonnegative_check',
        'eformsign_document_job_payload_fingerprint_check',
        'eformsign_document_job_last_error_code_check'
    ] LOOP
        IF NOT EXISTS (
            SELECT 1 FROM pg_constraint
            WHERE conname = missing_columns
              AND contype IN ('f', 'c')
        ) THEN
            RAISE EXCEPTION 'eformsign_document_job constraint % is missing', missing_columns;
        END IF;
    END LOOP;

    IF EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'eformsign_document_job_branch_id_fkey'
          AND pg_get_constraintdef(oid) NOT LIKE '%ON DELETE NO ACTION%'
    ) THEN
        RAISE EXCEPTION 'eformsign_document_job branch foreign key must use ON DELETE NO ACTION';
    END IF;

    IF EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname IN ('eformsign_document_job_client_id_fkey', 'eformsign_document_job_created_by_user_id_fkey')
          AND pg_get_constraintdef(oid) NOT LIKE '%ON DELETE SET NULL%'
    ) THEN
        RAISE EXCEPTION 'eformsign_document_job optional foreign keys must use ON DELETE SET NULL';
    END IF;
END $$;
