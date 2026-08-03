import type { AgentCapabilityMeta } from "@babyjamjam/shared";

export type CapabilityCatalogEntry = AgentCapabilityMeta;

type ReadTuple = [string, string, CapabilityCatalogEntry["renderer"], string, string?];
const reads: CapabilityCatalogEntry[] = ([
    ["clients.search", "clients", "entity-choice", "Search clients in the current branch by name or identifier"],
    ["clients.get", "clients", "text", "Get a client from the current branch by canonical client id"],
    ["employees.search", "employees", "entity-choice", "Search employees in the current branch"],
    ["employees.get", "employees", "text", "Get an employee in the current branch"],
    ["schedules.list", "schedules", "activity", "List schedules in the current branch"],
    ["dashboard.summary", "dashboard", "activity", "Summarize branch client counts without exposing personal contact data"],
    ["vouchers.prices", "vouchers", "text", "Read voucher price information"],
    ["bank.accounts", "bank", "text", "Read branch bank account references without exposing full account numbers"],
    ["contracts.status", "contracts", "activity", "Read active contract status for a client"],
    ["consultations.list", "consultations", "text", "List consultation inquiries for the current branch"],
    ["consultations.search", "consultations", "text", "Search consultation inquiries for the current branch"],
    ["consultations.unread", "consultations", "text", "List unread consultation inquiries"],
    ["calls.list", "calls", "text", "List calls for the current branch"],
    ["calls.transcriptSummary", "calls", "text", "List call transcript summaries without exposing raw transcripts"],
    ["drafts.list", "drafts", "text", "List client drafts for the current branch"],
    ["automation.list", "automation", "text", "List message automation rules for the current branch"],
    ["files.search", "files", "attachment", "Search authorized files for the current branch"],
    ["files.metadata", "files", "attachment", "Read authorized file metadata without signed URLs"],
    ["service-records.oversight", "service-records", "text", "Read service-record oversight rows for the current branch"],
    ["analytics.summary", "analytics", "text", "Read operational analytics for the current branch"],
    ["settings.read", "settings", "text", "Read explicitly approved operational policies for the current branch", "1.1.0"],
    ["website.settings", "website", "text", "Read the public ribbon configuration without exposing raw system settings", "1.1.0"],
    ["messages.previewSms", "messages", "activity", "Preview SMS content and cost category"],
    ["messages.deliveryHistory", "messages", "activity", "List SMS delivery lifecycle history for the current branch"],
    ["policy.retrieve", "policy", "text", "Retrieve versioned operational policy for explanatory answers"],
] as ReadTuple[]).map(([name, domain, renderer, description, version = "1.0.0"]) => ({
    name,
    domain,
    renderer,
    description,
    version,
    risk: "read" as const,
    requiredRoles: name === "bank.accounts" ? ["owner", "admin"] : name === "messages.deliveryHistory" ? ["owner", "admin", "manager"] : ["owner", "admin", "manager", "user"],
    flagKey: `agent.capability.${name}`,
    sideEffect: false,
}));

type WriteTuple = [string, string, string, CapabilityCatalogEntry["risk"], "structured" | "strong", "action-id" | "provider-key", string[]];
const writes: CapabilityCatalogEntry[] = ([
    ["clients.create", "clients", "Create a client after explicit approval", "reversible-write", "structured", "action-id", ["owner", "admin", "manager"]],
    ["clients.update", "clients", "Update an existing client after explicit approval", "reversible-write", "structured", "action-id", ["owner", "admin", "manager"]],
    ["employees.create", "employees", "Create an employee after explicit approval", "reversible-write", "structured", "action-id", ["owner", "admin", "manager"]],
    ["employees.update", "employees", "Update an employee after explicit approval", "reversible-write", "structured", "action-id", ["owner", "admin", "manager"]],
    ["employees.changeAvailability", "employees", "Change employee availability after explicit approval", "reversible-write", "structured", "action-id", ["owner", "admin", "manager"]],
    ["messages.createTemplate", "messages", "Create a message template after explicit approval", "reversible-write", "structured", "action-id", ["owner", "admin", "manager"]],
    ["messages.updateTemplate", "messages", "Update a message template after explicit approval", "reversible-write", "structured", "action-id", ["owner", "admin", "manager"]],
    ["consultations.markRead", "consultations", "Mark a consultation inquiry read after approval", "reversible-write", "structured", "action-id", ["owner", "admin", "manager"]],
    ["drafts.update", "drafts", "Update a pending client draft through the canonical draft use case", "reversible-write", "structured", "action-id", ["owner", "admin", "manager"]],
    ["drafts.confirm", "drafts", "Confirm a pending client draft through the canonical draft workflow", "reversible-write", "structured", "action-id", ["owner", "admin", "manager"]],
    ["files.delete", "files", "Delete an authorized file after strong approval", "irreversible-write", "strong", "action-id", ["owner", "admin", "manager"]],
    ["admin.createBranch", "admin", "Create a branch after owner-only strong approval", "privileged-administration", "strong", "action-id", ["owner"]],
    ["website.updateSettings", "website", "Update website settings after approval", "reversible-write", "structured", "action-id", ["owner"]],
    ["contracts.prepareDispatch", "contracts", "Prepare a contract dispatch for approval", "reversible-write", "strong", "action-id", ["owner", "admin", "manager"]],
    ["contracts.dispatch", "contracts", "Create and send a contract after strong approval", "external-side-effect", "strong", "provider-key", ["owner", "admin", "manager"]],
    ["messages.sendSms", "messages", "Send an SMS after strong approval", "external-side-effect", "strong", "action-id", ["owner", "admin", "manager"]],
    ["messages.scheduleSms", "messages", "Schedule an SMS after strong approval", "external-side-effect", "strong", "action-id", ["owner", "admin", "manager"]],
    ["messages.retrySms", "messages", "Retry a provider-rejected SMS after strong approval", "external-side-effect", "strong", "action-id", ["owner", "admin", "manager"]],
    ["automation.create", "automation", "Create a message automation rule after strong approval", "external-side-effect", "strong", "action-id", ["owner", "admin", "manager"]],
    ["automation.update", "automation", "Update a message automation rule after strong approval", "external-side-effect", "strong", "action-id", ["owner", "admin", "manager"]],
    ["automation.setActive", "automation", "Enable or disable a message automation rule after strong approval", "external-side-effect", "strong", "action-id", ["owner", "admin", "manager"]],
    ["automation.delete", "automation", "Delete a message automation rule and cancel pending jobs after strong approval", "irreversible-write", "strong", "action-id", ["owner", "admin", "manager"]],
    ["notifications.test", "notifications", "Persist a test notification and attempt web push after explicit approval", "external-side-effect", "strong", "action-id", ["owner", "admin"]],
] as WriteTuple[]).map(([name, domain, description, risk, approvalPolicy, idempotencyPolicy, requiredRoles]) => ({
    name,
    domain,
    version: "1.0.0",
    description,
    risk,
    requiredRoles,
    renderer: "action-proposal",
    flagKey: `agent.capability.${name}`,
    sideEffect: true,
    approvalPolicy,
    idempotencyPolicy,
}));

export const CAPABILITY_CATALOG: CapabilityCatalogEntry[] = [...reads, ...writes];
export const CAPABILITY_CATALOG_BY_NAME = new Map(CAPABILITY_CATALOG.map((entry) => [entry.name, entry]));
