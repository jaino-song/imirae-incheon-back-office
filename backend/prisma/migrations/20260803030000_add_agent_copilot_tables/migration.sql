-- Release A persistence for the branch-scoped operational copilot.
-- Additive only: legacy chat_* tables remain untouched for instant rollback.

BEGIN;

CREATE TABLE IF NOT EXISTS "agent_session" (
    "id" TEXT NOT NULL DEFAULT (gen_random_uuid())::text,
    "user_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "locale" VARCHAR(10) NOT NULL DEFAULT 'ko',
    "title" TEXT,
    "summary" TEXT,
    "selected_entities" JSONB NOT NULL DEFAULT '{}'::jsonb,
    "model" TEXT NOT NULL,
    "agent_version" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "archived_at" TIMESTAMPTZ(6),
    CONSTRAINT "agent_session_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "agent_session_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "agent_session_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branch"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "agent_trace" (
    "id" TEXT NOT NULL DEFAULT (gen_random_uuid())::text,
    "session_id" TEXT NOT NULL,
    "user_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "model" TEXT NOT NULL,
    "agent_version" TEXT NOT NULL,
    "routed_domains" JSONB NOT NULL DEFAULT '[]'::jsonb,
    "step_metadata" JSONB NOT NULL DEFAULT '[]'::jsonb,
    "usage" JSONB,
    "latency_ms" INTEGER,
    "outcome" VARCHAR(20) NOT NULL DEFAULT 'running',
    "error_category" VARCHAR(30),
    "redaction_metadata" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMPTZ(6),
    CONSTRAINT "agent_trace_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "agent_trace_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "agent_session"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "agent_trace_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "agent_trace_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branch"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "agent_message" (
    "id" TEXT NOT NULL DEFAULT (gen_random_uuid())::text,
    "session_id" TEXT NOT NULL,
    "role" VARCHAR(20) NOT NULL,
    "parts" JSONB NOT NULL,
    "trace_id" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "agent_message_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "agent_message_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "agent_session"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "agent_message_trace_id_fkey" FOREIGN KEY ("trace_id") REFERENCES "agent_trace"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "agent_action" (
    "id" TEXT NOT NULL DEFAULT (gen_random_uuid())::text,
    "session_id" TEXT NOT NULL,
    "user_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "capability" TEXT NOT NULL,
    "capability_version" TEXT NOT NULL,
    "risk" VARCHAR(40) NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'proposed',
    "proposal" JSONB NOT NULL,
    "input_hash" TEXT NOT NULL,
    "target_snapshot" JSONB,
    "target_version" TEXT,
    "authorization_context" JSONB NOT NULL,
    "approved_by" UUID,
    "approved_at" TIMESTAMPTZ(6),
    "rejected_by" UUID,
    "rejected_at" TIMESTAMPTZ(6),
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "result" JSONB,
    "error" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "executed_at" TIMESTAMPTZ(6),
    CONSTRAINT "agent_action_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "agent_action_idempotency_key_key" UNIQUE ("idempotency_key"),
    CONSTRAINT "agent_action_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "agent_session"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "agent_action_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "agent_action_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branch"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "agent_feedback" (
    "id" TEXT NOT NULL DEFAULT (gen_random_uuid())::text,
    "session_id" TEXT NOT NULL,
    "message_id" TEXT NOT NULL,
    "trace_id" TEXT,
    "user_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "type" VARCHAR(20) NOT NULL,
    "comment" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "agent_feedback_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "agent_feedback_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "agent_session"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "agent_feedback_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "agent_message"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "agent_feedback_trace_id_fkey" FOREIGN KEY ("trace_id") REFERENCES "agent_trace"("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "agent_feedback_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "agent_feedback_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branch"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "idx_agent_session_owner_updated" ON "agent_session"("branch_id", "user_id", "updated_at");
CREATE INDEX IF NOT EXISTS "idx_agent_session_expires_at" ON "agent_session"("expires_at");
CREATE INDEX IF NOT EXISTS "idx_agent_session_archived_at" ON "agent_session"("archived_at");
CREATE INDEX IF NOT EXISTS "idx_agent_trace_session_created" ON "agent_trace"("session_id", "created_at");
CREATE INDEX IF NOT EXISTS "idx_agent_trace_owner_created" ON "agent_trace"("branch_id", "user_id", "created_at");
CREATE INDEX IF NOT EXISTS "idx_agent_trace_outcome_created" ON "agent_trace"("outcome", "created_at");
CREATE INDEX IF NOT EXISTS "idx_agent_message_session_created" ON "agent_message"("session_id", "created_at");
CREATE INDEX IF NOT EXISTS "idx_agent_message_trace" ON "agent_message"("trace_id");
CREATE INDEX IF NOT EXISTS "idx_agent_action_session_created" ON "agent_action"("session_id", "created_at");
CREATE INDEX IF NOT EXISTS "idx_agent_action_owner_status" ON "agent_action"("branch_id", "user_id", "status");
CREATE INDEX IF NOT EXISTS "idx_agent_action_status_expires" ON "agent_action"("status", "expires_at");
CREATE INDEX IF NOT EXISTS "idx_agent_feedback_session_created" ON "agent_feedback"("session_id", "created_at");
CREATE INDEX IF NOT EXISTS "idx_agent_feedback_message" ON "agent_feedback"("message_id");
CREATE INDEX IF NOT EXISTS "idx_agent_feedback_trace" ON "agent_feedback"("trace_id");
CREATE INDEX IF NOT EXISTS "idx_agent_feedback_owner" ON "agent_feedback"("branch_id", "user_id");

COMMIT;
