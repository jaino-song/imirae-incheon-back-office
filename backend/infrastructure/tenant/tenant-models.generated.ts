// AUTO-GENERATED — do not edit; run pnpm run tenant:models:generate
// Source: prisma/schema.prisma. Regenerate whenever a model's branch_id column changes.
// See scripts/tenant/generate-tenant-models.ts for the derivation and its drift test.

export const TENANT_MODELS: ReadonlySet<string> = new Set([
    "admin_audit_event",
    "agent_action",
    "agent_feedback",
    "agent_session",
    "agent_trace",
    "area",
    "call_ingest_token",
    "call_record",
    "chat_session",
    "client",
    "client_draft",
    "consultation_inquiry",
    "document",
    "document_category",
    "eformsign_dispatch_intent",
    "eformsign_doc",
    "eformsign_document_job",
    "employee",
    "employee_schedule",
    "legacy_chat_confirmation_intent",
    "message",
    "message_log",
    "message_template",
    "message_trigger_job",
    "message_trigger_rule",
    "notification",
    "schedule_change_request",
    "service_record",
    "service_record_assignment",
    "service_record_case",
    "service_record_day",
    "service_record_snapshot_chunk",
    "service_record_token",
    "user_branch",
]);

export const TENANT_MODEL_BRANCH_FIELD = "branchId";
