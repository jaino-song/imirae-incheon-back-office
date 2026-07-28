DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'eformsign_doc'
          AND column_name = 'document_name'
    ) THEN
        RAISE EXCEPTION 'eformsign_doc.document_name is missing';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'eformsign_doc'
          AND column_name = 'document_number'
    ) THEN
        RAISE EXCEPTION 'eformsign_doc.document_number is missing';
    END IF;
END $$;
