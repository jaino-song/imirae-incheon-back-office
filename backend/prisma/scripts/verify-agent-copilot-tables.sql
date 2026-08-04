DO $$
DECLARE
    required_table TEXT;
    required_index TEXT;
BEGIN
    FOREACH required_table IN ARRAY ARRAY[
        'agent_session',
        'agent_message',
        'agent_action',
        'agent_trace',
        'agent_feedback'
    ] LOOP
        IF to_regclass(format('public.%I', required_table)) IS NULL THEN
            RAISE EXCEPTION 'required agent table % is missing', required_table;
        END IF;
    END LOOP;

    FOREACH required_index IN ARRAY ARRAY[
        'idx_agent_session_owner_updated',
        'idx_agent_message_session_created',
        'agent_action_idempotency_key_key',
        'agent_action_request_dedupe_key_key',
        'idx_agent_action_owner_status',
        'idx_agent_action_dedupe_expires',
        'idx_agent_action_result_delivery',
        'idx_agent_action_effect_recorded',
        'idx_agent_trace_owner_created',
        'idx_agent_feedback_owner',
        'agent_feedback_message_user_key'
    ] LOOP
        IF to_regclass(format('public.%I', required_index)) IS NULL THEN
            RAISE EXCEPTION 'required agent index % is missing', required_index;
        END IF;
    END LOOP;

    IF NOT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'agent_session'
          AND column_name = 'branch_id'
          AND is_nullable = 'NO'
    ) THEN
        RAISE EXCEPTION 'agent_session.branch_id must be required';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'agent_message'
          AND column_name = 'parts'
          AND data_type = 'jsonb'
    ) THEN
        RAISE EXCEPTION 'agent_message.parts must be jsonb';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'agent_action'
          AND column_name IN ('proposal_revision', 'request_dedupe_key', 'dedupe_expires_at')
          AND is_nullable = 'YES'
    ) OR (
        SELECT count(*)
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'agent_action'
          AND column_name IN ('proposal_revision', 'request_dedupe_key', 'dedupe_expires_at')
    ) <> 3 THEN
        RAISE EXCEPTION 'agent_action revision and bounded dedupe columns must be present and required';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'agent_action'
          AND column_name = 'execution_attempt_count'
          AND is_nullable = 'NO'
    ) OR NOT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'agent_action'
          AND column_name = 'result_part_persisted_at'
    ) THEN
        RAISE EXCEPTION 'agent_action execution and result-delivery columns must be present';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'agent_action'
          AND column_name = 'effect_receipt'
          AND data_type = 'jsonb'
    ) OR NOT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'agent_action'
          AND column_name = 'effect_recorded_at'
    ) THEN
        RAISE EXCEPTION 'agent_action effect receipt columns must be present';
    END IF;
END $$;
