DO $$
DECLARE
    missing_columns TEXT;
BEGIN
    SELECT string_agg(required.column_name, ', ' ORDER BY required.column_name)
    INTO missing_columns
    FROM (
        VALUES
            ('customer_phone'),
            ('detail_payload'),
            ('detail_source_updated_date'),
            ('detail_synced_at'),
            ('sync_status'),
            ('sync_error'),
            ('sync_error_at'),
            ('permanent_purge_requested_at')
    ) AS required(column_name)
    WHERE NOT EXISTS (
        SELECT 1
        FROM information_schema.columns actual
        WHERE actual.table_schema = 'public'
          AND actual.table_name = 'eformsign_doc'
          AND actual.column_name = required.column_name
    );

    IF missing_columns IS NOT NULL THEN
        RAISE EXCEPTION 'eformsign_doc local mirror columns are missing: %', missing_columns;
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_indexes
        WHERE schemaname = 'public'
          AND indexname = 'idx_eformsign_doc_branch_customer_phone'
    ) THEN
        RAISE EXCEPTION 'eformsign_doc branch/customer phone index is missing';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_indexes
        WHERE schemaname = 'public'
          AND tablename = 'eformsign_doc'
          AND indexname = 'idx_eformsign_doc_permanent_purge_requested_at'
    ) THEN
        RAISE EXCEPTION 'eformsign_doc permanent purge request index is missing';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_name = 'eformsign_doc_file'
    ) THEN
        RAISE EXCEPTION 'eformsign_doc_file table is missing';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'eformsign_doc_file'
          AND column_name = 'content'
          AND data_type = 'bytea'
    ) THEN
        RAISE EXCEPTION 'eformsign_doc_file.content bytea column is missing';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'eformsign_doc_file_eformsign_doc_id_fkey'
          AND contype = 'f'
    ) THEN
        RAISE EXCEPTION 'eformsign_doc_file foreign key is missing';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_indexes
        WHERE schemaname = 'public'
          AND indexname = 'uniq_eformsign_doc_file_type'
    ) THEN
        RAISE EXCEPTION 'eformsign_doc_file type uniqueness index is missing';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'eformsign_doc_file_size_check'
          AND contype = 'c'
    ) THEN
        RAISE EXCEPTION 'eformsign_doc_file byte-size integrity check is missing';
    END IF;
END $$;
