DO $$
BEGIN
    IF to_regclass('public.out_of_pocket_price_info') IS NULL THEN
        RAISE EXCEPTION 'out_of_pocket_price_info table is missing';
    END IF;

    IF to_regclass('public.out_of_pocket_price_info_duration_key') IS NULL THEN
        RAISE EXCEPTION 'out_of_pocket_price_info duration index is missing';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'out_of_pocket_price_info_duration_check'
          AND conrelid = 'public.out_of_pocket_price_info'::regclass
    ) THEN
        RAISE EXCEPTION 'out_of_pocket_price_info duration constraint is missing';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'out_of_pocket_price_info_full_price_check'
          AND conrelid = 'public.out_of_pocket_price_info'::regclass
    ) THEN
        RAISE EXCEPTION 'out_of_pocket_price_info price constraint is missing';
    END IF;

    IF (
        SELECT COUNT(*)
        FROM "out_of_pocket_price_info"
        WHERE "duration" IN (5, 10, 15, 20)
    ) <> 4 THEN
        RAISE EXCEPTION 'out_of_pocket_price_info seed rows are incomplete';
    END IF;
END
$$;
