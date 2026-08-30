DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'employee'
          AND column_name = 'deleted_at'
          AND data_type = 'timestamp with time zone'
          AND datetime_precision = 6
          AND is_nullable = 'YES'
    ) THEN
        RAISE EXCEPTION 'employee.deleted_at is missing or has the wrong definition';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'client'
          AND column_name = 'suppress_greeting_sms'
          AND data_type = 'boolean'
          AND is_nullable = 'NO'
          AND replace(column_default, '::boolean', '') = 'false'
    ) THEN
        RAISE EXCEPTION 'client.suppress_greeting_sms is missing or has the wrong definition';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'client'
          AND column_name = 'phone_normalized'
          AND data_type = 'text'
          AND is_nullable = 'YES'
    ) THEN
        RAISE EXCEPTION 'client.phone_normalized is missing or has the wrong definition';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'employee'
          AND column_name = 'phone_normalized'
          AND data_type = 'text'
          AND is_nullable = 'YES'
    ) THEN
        RAISE EXCEPTION 'employee.phone_normalized is missing or has the wrong definition';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'employee_schedule'
          AND column_name = 'secondary_employee_id'
          AND is_nullable = 'YES'
    ) THEN
        RAISE EXCEPTION 'employee_schedule.secondary_employee_id is not nullable';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'employee_schedule_primary_employee_id_fkey'
          AND conrelid = 'public.employee_schedule'::regclass
          AND confrelid = 'public.employee'::regclass
          AND contype = 'f'
          AND conkey = ARRAY[(
              SELECT attnum
              FROM pg_attribute
              WHERE attrelid = 'public.employee_schedule'::regclass
                AND attname = 'primary_employee_id'
          )]
          AND confkey = ARRAY[(
              SELECT attnum
              FROM pg_attribute
              WHERE attrelid = 'public.employee'::regclass
                AND attname = 'id'
          )]
          AND confdeltype = 'r'
          AND confupdtype = 'a'
    ) THEN
        RAISE EXCEPTION 'primary employee FK is missing or not ON DELETE RESTRICT';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'employee_schedule_secondary_employee_id_fkey'
          AND conrelid = 'public.employee_schedule'::regclass
          AND confrelid = 'public.employee'::regclass
          AND contype = 'f'
          AND conkey = ARRAY[(
              SELECT attnum
              FROM pg_attribute
              WHERE attrelid = 'public.employee_schedule'::regclass
                AND attname = 'secondary_employee_id'
          )]
          AND confkey = ARRAY[(
              SELECT attnum
              FROM pg_attribute
              WHERE attrelid = 'public.employee'::regclass
                AND attname = 'id'
          )]
          AND confdeltype = 'n'
          AND confupdtype = 'a'
    ) THEN
        RAISE EXCEPTION 'secondary employee FK is missing or not ON DELETE SET NULL';
    END IF;

    IF to_regclass('public.employee_phone_key') IS NOT NULL
       OR EXISTS (
           SELECT 1
           FROM pg_constraint
           WHERE conname = 'employee_phone_key'
             AND conrelid = 'public.employee'::regclass
       ) THEN
        RAISE EXCEPTION 'legacy global employee phone uniqueness still exists';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_indexes
        WHERE schemaname = 'public'
          AND tablename = 'employee'
          AND indexname = 'employee_branch_id_phone_normalized_key'
          AND indexdef LIKE 'CREATE UNIQUE INDEX%'
          AND replace(indexdef, '"', '') LIKE '%(branch_id, phone_normalized)%'
    ) THEN
        RAISE EXCEPTION 'employee branch/phone_normalized unique index is missing or malformed';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM "public"."employee"
        WHERE "branch_id" IS NOT NULL
          AND "phone_normalized" IS NOT NULL
        GROUP BY "branch_id", "phone_normalized"
        HAVING COUNT(*) > 1
    ) THEN
        RAISE EXCEPTION 'employee has duplicate (branch_id, phone_normalized) groups';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_indexes
        WHERE schemaname = 'public'
          AND tablename = 'client'
          AND indexname = 'client_branch_phone_normalized_key'
          AND indexdef LIKE 'CREATE UNIQUE INDEX%'
          AND replace(indexdef, '"', '') LIKE '%(branch_id, phone_normalized)%'
    ) THEN
        RAISE EXCEPTION 'client branch/phone_normalized unique index is missing or malformed';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM "public"."client"
        WHERE "branch_id" IS NOT NULL
          AND "phone_normalized" IS NOT NULL
        GROUP BY "branch_id", "phone_normalized"
        HAVING COUNT(*) > 1
    ) THEN
        RAISE EXCEPTION 'client has duplicate (branch_id, phone_normalized) groups';
    END IF;

    IF to_regclass('public.employee_id_seq') IS NULL THEN
        RAISE EXCEPTION 'employee_id_seq is missing';
    END IF;

    IF pg_get_serial_sequence('public.employee', 'id') IS DISTINCT FROM 'public.employee_id_seq' THEN
        RAISE EXCEPTION 'employee.id is not owned by employee_id_seq';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'employee'
          AND column_name = 'id'
          AND column_default LIKE 'nextval(%employee_id_seq%'
    ) THEN
        RAISE EXCEPTION 'employee.id does not default to employee_id_seq';
    END IF;
END $$;
