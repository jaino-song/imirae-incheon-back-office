CREATE TABLE "admin_audit_event" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "actor_user_id" UUID,
    "actor_global_role" VARCHAR(40),
    "actor_branch_role" VARCHAR(40),
    "tenant_id" UUID,
    "branch_id" UUID,
    "action" VARCHAR(100) NOT NULL,
    "target_type" VARCHAR(80) NOT NULL,
    "target_id" VARCHAR(255),
    "before_payload" JSONB,
    "after_payload" JSONB,
    "outcome" VARCHAR(40) NOT NULL,
    "reason" VARCHAR(500),
    "correlation_id" VARCHAR(255),
    "source" VARCHAR(80),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "admin_audit_event_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "idx_admin_audit_event_actor_created"
    ON "admin_audit_event"("actor_user_id", "created_at");
CREATE INDEX "idx_admin_audit_event_branch_created"
    ON "admin_audit_event"("branch_id", "created_at");
CREATE INDEX "idx_admin_audit_event_target_created"
    ON "admin_audit_event"("target_type", "target_id", "created_at");
CREATE INDEX "idx_admin_audit_event_action_created"
    ON "admin_audit_event"("action", "created_at");

-- The application exposes no update/delete operation for this ledger.  The
-- trigger also protects the append-only invariant if a privileged SQL client
-- or future repository bypasses the application boundary.
CREATE OR REPLACE FUNCTION prevent_admin_audit_event_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    RAISE EXCEPTION 'admin_audit_event is append-only';
END;
$$;

CREATE TRIGGER admin_audit_event_append_only
    BEFORE UPDATE OR DELETE ON "admin_audit_event"
    FOR EACH ROW
    EXECUTE FUNCTION prevent_admin_audit_event_mutation();
