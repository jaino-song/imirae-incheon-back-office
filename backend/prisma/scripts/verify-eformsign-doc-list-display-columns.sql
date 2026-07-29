DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'eformsign_doc'
          AND column_name = 'template_name'
          AND data_type = 'text'
          AND is_nullable = 'YES'
    ) THEN
        RAISE EXCEPTION 'eformsign_doc.template_name is missing or has the wrong shape';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'eformsign_doc'
          AND column_name = 'customer_name'
          AND data_type = 'text'
          AND is_nullable = 'YES'
    ) THEN
        RAISE EXCEPTION 'eformsign_doc.customer_name is missing or has the wrong shape';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'eformsign_doc'
          AND column_name = 'creator_name'
          AND data_type = 'text'
          AND is_nullable = 'YES'
    ) THEN
        RAISE EXCEPTION 'eformsign_doc.creator_name is missing or has the wrong shape';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'eformsign_doc'
          AND column_name = 'last_editor_name'
          AND data_type = 'text'
          AND is_nullable = 'YES'
    ) THEN
        RAISE EXCEPTION 'eformsign_doc.last_editor_name is missing or has the wrong shape';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'eformsign_doc'
          AND column_name = 'step_recipient_types'
          AND data_type = 'text'
          AND is_nullable = 'YES'
    ) THEN
        RAISE EXCEPTION 'eformsign_doc.step_recipient_types is missing or has the wrong shape';
    END IF;
END $$;
