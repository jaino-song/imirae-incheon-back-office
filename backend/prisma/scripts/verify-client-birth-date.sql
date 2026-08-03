DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'client'
          AND column_name = 'birth_date'
    ) THEN
        RAISE EXCEPTION 'client.birth_date is missing';
    END IF;
END $$;
