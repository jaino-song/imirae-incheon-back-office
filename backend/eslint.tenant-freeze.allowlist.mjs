// Grandfathered `application/` files that import PrismaService directly.
//
// This list only shrinks: it exists to freeze the current count of
// direct-Prisma-in-application violations, not to legitimize them.
// Do NOT add new entries to unblock new code — new application-layer
// code must go through a domain repository instead of importing
// PrismaService directly. Adding a file here requires explicit review.
//
// Generated via:
//   grep -rln "database/prisma.service" application/ | grep -v '\.spec\.'
export const prismaServiceImportAllowlist = [
    "application/agent/action-coordinator.service.ts",
    "application/agent/agent-action-effect-receipt.ts",
    "application/agent/agent-feedback.service.ts",
    "application/agent/agent-trace.service.ts",
    "application/agent/extended-read-agent-capabilities.provider.ts",
    "application/ai-chat/legacy-chat-confirmation.service.ts",
    "application/services/admin-audit-event.service.ts",
    "application/services/admin-service-record.service.ts",
    "application/services/auth-email-outbox.service.ts",
    "application/services/auth-session.service.ts",
    "application/services/auth.service.ts",
    "application/services/call-extraction-retry-scheduler.service.ts",
    "application/services/call-inbox.service.ts",
    "application/services/call-ingest-token.service.ts",
    "application/services/call-ingestion.service.ts",
    "application/services/call-processing.service.ts",
    "application/services/client-due-date-scheduler.service.ts",
    "application/services/client-message-automation-intent-fulfiller.ts",
    "application/services/client.service.ts",
    "application/services/contract-client-assignment-guard.service.ts",
    "application/services/document-category.service.ts",
    "application/services/eformsign-mirror-readiness.service.ts",
    "application/services/eformsign-webhook.service.ts",
    "application/services/employee-schedule.service.ts",
    "application/services/message-automation-intent.service.ts",
    "application/services/message-sender-approval.service.ts",
    "application/services/message-template-automation-lock.service.ts",
    "application/services/message-trigger.service.ts",
    "application/services/schedule-change.service.ts",
    "application/services/service-record-entry.service.ts",
    "application/services/service-record-finalization.service.ts",
    "application/services/service-record-lifecycle.service.ts",
    "application/services/service-record-link-reconciliation.service.ts",
    "application/services/service-record-link.service.ts",
    "application/services/service-record-token.service.ts",
    "application/services/system-admin.service.ts",
    "application/services/system-template-bootstrap.service.ts",
    "application/services/user.service.ts",
    "application/usecases/client/client-write-agent-capabilities.provider.ts",
    "application/usecases/eformsign-doc/contract-external-agent-capabilities.provider.ts",
    "application/usecases/eformsign-doc/create-and-send-service-record-snapshot.usecase.ts",
    "application/usecases/eformsign-doc/get-contract-client-candidate.usecase.ts",
    "application/usecases/eformsign-doc/link-mirrored-eformsign-doc-by-phone.usecase.ts",
    "application/usecases/employee-schedule/create-employee-schedule.usecase.ts",
    "application/usecases/employee-schedule/update-employee-schedule.usecase.ts",
    "application/usecases/employee/employee-write-agent-capabilities.provider.ts",
    "application/usecases/message-template/message-template-write-agent-capabilities.provider.ts",
    "application/usecases/message/message-external-agent-capabilities.provider.ts",
    "application/usecases/notification/notification-agent-capabilities.provider.ts",
    "application/usecases/voucher-price-info/bulk-update-voucher-price-info.usecase.ts",
];
