-- Exact action-bound receipts prevent reconciliation from attributing an
-- unrelated matching business record to an interrupted create operation.
ALTER TABLE "agent_action"
    ADD COLUMN IF NOT EXISTS "effect_receipt" JSONB,
    ADD COLUMN IF NOT EXISTS "effect_recorded_at" TIMESTAMPTZ(6);

CREATE INDEX IF NOT EXISTS "idx_agent_action_effect_recorded"
    ON "agent_action"("effect_recorded_at")
    WHERE "effect_receipt" IS NOT NULL;
