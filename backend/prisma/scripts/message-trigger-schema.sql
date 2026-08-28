ALTER TABLE "client"
ADD COLUMN IF NOT EXISTS "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT NOW();

CREATE INDEX IF NOT EXISTS "idx_client_created_at"
ON "client" ("created_at");

ALTER TABLE "message_log"
ADD COLUMN IF NOT EXISTS "trigger_job_id" TEXT;

CREATE INDEX IF NOT EXISTS "idx_message_log_trigger_job_id"
ON "message_log" ("trigger_job_id");

CREATE TABLE IF NOT EXISTS "message_trigger_rule" (
  "id" TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "branch_id" UUID,
  "name" TEXT NOT NULL,
  "is_active" BOOLEAN NOT NULL DEFAULT TRUE,
  "event_type" TEXT NOT NULL,
  "offset_type" TEXT NOT NULL,
  "offset_days" INTEGER NOT NULL DEFAULT 0,
  "recipient_type" TEXT NOT NULL,
  "template_key" TEXT NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS "idx_message_trigger_rule_branch"
ON "message_trigger_rule" ("branch_id");

CREATE INDEX IF NOT EXISTS "idx_message_trigger_rule_active"
ON "message_trigger_rule" ("branch_id", "is_active");

CREATE INDEX IF NOT EXISTS "idx_message_trigger_rule_event_type"
ON "message_trigger_rule" ("event_type");

CREATE TABLE IF NOT EXISTS "message_trigger_job" (
  "id" TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "branch_id" UUID,
  "rule_id" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "scheduled_for" TIMESTAMPTZ(6) NOT NULL,
  "claim_token" TEXT,
  "sent_at" TIMESTAMPTZ(6),
  "canceled_at" TIMESTAMPTZ(6),
  "cancel_reason" TEXT,
  "client_id" INTEGER,
  "employee_schedule_id" INTEGER,
  "recipient_type" TEXT NOT NULL,
  "recipient_phone" TEXT,
  "template_key" TEXT NOT NULL,
  "dedupe_key" TEXT NOT NULL UNIQUE,
  "payload" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS "idx_message_trigger_job_branch"
ON "message_trigger_job" ("branch_id");

CREATE INDEX IF NOT EXISTS "idx_message_trigger_job_rule_id"
ON "message_trigger_job" ("rule_id");

CREATE INDEX IF NOT EXISTS "idx_message_trigger_job_status_scheduled_for"
ON "message_trigger_job" ("status", "scheduled_for");

CREATE INDEX IF NOT EXISTS "idx_message_trigger_job_client_id"
ON "message_trigger_job" ("client_id");

CREATE INDEX IF NOT EXISTS "idx_message_trigger_job_employee_schedule_id"
ON "message_trigger_job" ("employee_schedule_id");
