CREATE TABLE IF NOT EXISTS "message_trigger_rule_branch_override" (
  "branch_id" UUID NOT NULL,
  "rule_id" TEXT NOT NULL,
  "is_active" BOOLEAN NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "message_trigger_rule_branch_override_pkey" PRIMARY KEY ("branch_id", "rule_id"),
  CONSTRAINT "message_trigger_rule_branch_override_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branch"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "message_trigger_rule_branch_override_rule_id_fkey" FOREIGN KEY ("rule_id") REFERENCES "message_trigger_rule"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
