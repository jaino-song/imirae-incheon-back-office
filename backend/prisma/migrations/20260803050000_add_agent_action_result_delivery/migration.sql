-- Delivery of the terminal UI part is retried independently from the action.
ALTER TABLE "agent_action"
    ADD COLUMN IF NOT EXISTS "result_part_persisted_at" TIMESTAMPTZ(6),
    ADD COLUMN IF NOT EXISTS "execution_attempt_count" INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS "idx_agent_action_result_delivery"
    ON "agent_action"("result_part_persisted_at", "updated_at")
    WHERE "status" IN ('succeeded', 'failed', 'uncertain', 'rejected', 'expired', 'cancelled');
