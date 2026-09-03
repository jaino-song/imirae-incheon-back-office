import type { SystemTemplateKey } from "./system-template";

// Shared message contracts used by both frontend and mobile.
//
// The source of truth for these shapes is the backend contract surface:
// - backend/interface/dto/message.dto.ts
// - backend/interface/dto/message-template.dto.ts
// - backend/interface/dto/message-delivery.dto.ts
// - backend/interface/dto/message-sender-approval.dto.ts
// - backend/interface/dto/message-trigger.dto.ts
// - backend/interface/dto/system-admin.dto.ts
// - backend/domain/entities/message.entity.ts
// - backend/domain/entities/message-template.entity.ts
// - backend/domain/entities/message-log.entity.ts
// - backend/domain/entities/message-trigger-rule.entity.ts
// - backend/domain/constants/message-trigger-catalog.ts
// - backend/interface/controllers/message-delivery.controller.ts
// - backend/interface/controllers/system-setting.controller.ts
// - backend/application/services/message-trigger.service.ts
// - backend/application/services/system-admin.service.ts
//
// Message, message-template, message-trigger, and message-log controllers
// currently return Date-backed entities/views directly. Those dates serialize to
// ISO strings on the wire, so the client-facing response types below use string
// while Raw* variants retain Date for backend-reference parity.

export type MessageTriggerEventType =
  | "CLIENT_CREATED"
  | "SERVICE_START"
  | "SERVICE_END"
  | "EMPLOYEE_ASSIGNED";

export type MessageTriggerOffsetType =
  | "IMMEDIATE"
  | "SAME_DAY"
  | "BEFORE_DAYS"
  | "AFTER_DAYS";

export type MessageTriggerRecipientType =
  | "CLIENT"
  | "PRIMARY_EMPLOYEE"
  | "SECONDARY_EMPLOYEE";

export type MessageTriggerTemplateKey =
  | "CLIENT_WELCOME"
  | "SERVICE_START_REMINDER"
  | "SERVICE_INFO"
  | "SERVICE_END_REMINDER"
  | "EMPLOYEE_ASSIGNED"
  | "SERVICE_RECORD_LINK"
  | "CLIENT_GREETING"
  | "PRICE_INFO"
  | "REMINDER"
  | "THANKS"
  | "SURVEY"
  | "INFO";

/**
 * Variables each scheduler can derive without operator input.
 * Backend parity is enforced by message-trigger-template-consistency.spec.ts.
 */
export const MESSAGE_TRIGGER_AUTOMATIC_VARIABLE_KEYS: Readonly<
  Record<MessageTriggerTemplateKey, readonly string[]>
> = {
  CLIENT_WELCOME: ["name", "clientName", "registrationDate", "serviceType"],
  SERVICE_START_REMINDER: ["name", "clientName", "serviceStartDate", "timingText"],
  SERVICE_INFO: ["name", "clientName", "phone"],
  SERVICE_END_REMINDER: ["name", "clientName", "serviceEndDate", "timingText"],
  EMPLOYEE_ASSIGNED: ["name", "employeeName", "clientName", "serviceStartDate"],
  SERVICE_RECORD_LINK: [
    "name",
    "employeeName",
    "clientName",
    "serviceStartDate",
    "serviceEndDate",
    "buttonUrl",
    "serviceRecordUrl",
  ],
  CLIENT_GREETING: ["name", "clientName", "phone"],
  PRICE_INFO: [
    "name",
    "clientName",
    "phone",
    "weeks",
    "duration",
    "type",
    "fullPrice",
    "grant",
    "actualPrice",
    "bankName",
    "accNum",
  ],
  REMINDER: ["name", "clientName", "phone"],
  THANKS: ["name", "clientName", "phone"],
  SURVEY: ["name", "clientName", "phone"],
  INFO: ["name", "clientName", "phone"],
};

// Which system template's body each SMS trigger template renders. One source of
// truth for both the backend SMS delivery and the form preview.
export const SMS_TRIGGER_TO_SYSTEM_TEMPLATE: Partial<
  Record<MessageTriggerTemplateKey, SystemTemplateKey>
> = {
  SERVICE_INFO: "SERVICE_INFO",
  SERVICE_RECORD_LINK: "SERVICE_RECORD_LINK",
  CLIENT_GREETING: "GREETING",
  PRICE_INFO: "PRICE_INFO",
  REMINDER: "REMINDER",
  THANKS: "THANKS",
  SURVEY: "SURVEY",
  INFO: "INFO",
};

// Canonical source of truth for trigger templates delivered over SMS.
// Adding a new SMS template here flows it through the SMS form's
// data-driven dropdowns, the channel filters, and the backend delivery drift
// guard without hardcoded per-surface lists.
export const SMS_TRIGGER_TEMPLATE_KEYS: MessageTriggerTemplateKey[] = [
  "SERVICE_INFO",
  "SERVICE_RECORD_LINK",
  "CLIENT_GREETING",
  "PRICE_INFO",
  "REMINDER",
  "THANKS",
  "SURVEY",
  "INFO",
];

// SERVICE_RECORD_LINK is scheduled by the dedicated service-record lifecycle
// (it needs a signed URL and an assigned employee). Exposing it in the generic
// rule builder would create a rule that cannot supply those values safely.
export const CONFIGURABLE_SMS_TRIGGER_TEMPLATE_KEYS: MessageTriggerTemplateKey[] =
  SMS_TRIGGER_TEMPLATE_KEYS.filter((key) => key !== "SERVICE_RECORD_LINK");

export function getTriggerTemplateChannel(
  key: MessageTriggerTemplateKey,
): "sms" | "unsupported" {
  return SMS_TRIGGER_TEMPLATE_KEYS.includes(key) ? "sms" : "unsupported";
}

export type SupportedTriggerProvider = "sms";

export interface MessageTriggerTemplateVariable {
  key: string;
  label: string;
}

export interface MessageTriggerTemplateProviderConfig {
  templateKey: string;
}

export interface MessageTriggerTemplateCatalogItem {
  key: MessageTriggerTemplateKey;
  name: string;
  description: string;
  allowedEventTypes: MessageTriggerEventType[];
  allowedRecipientTypes: MessageTriggerRecipientType[];
  requiredVariables: MessageTriggerTemplateVariable[];
  providers: Partial<
    Record<SupportedTriggerProvider, MessageTriggerTemplateProviderConfig>
  >;
}

export interface MessageTriggerRule {
  id: string;
  branchId: string | null;
  name: string;
  /**
   * Effective activation for the requesting branch.
   *
   * For a branch-owned rule this is the rule's own flag. For a global rule
   * (`branchId === null`) it is `rule.isActive && (override?.isActive ?? true)` —
   * a branch may only opt OUT of a global rule, never opt in.
   */
  isActive: boolean;
  /**
   * True when a global rule is switched off globally, so no branch can turn it
   * back on. Absent/false for branch-owned rules. Drives the disabled state of
   * the activation toggle.
   */
  isLockedByGlobal?: boolean;
  eventType: MessageTriggerEventType;
  offsetType: MessageTriggerOffsetType;
  offsetDays: number;
  recipientType: MessageTriggerRecipientType;
  templateKey: MessageTriggerTemplateKey;
  createdAt: string;
  updatedAt: string;
}

export interface CreateMessageTriggerRuleDto {
  name: string;
  isActive?: boolean;
  eventType: MessageTriggerEventType;
  offsetType: MessageTriggerOffsetType;
  offsetDays?: number;
  recipientType: MessageTriggerRecipientType;
  templateKey: MessageTriggerTemplateKey;
}

export type UpdateMessageTriggerRuleDto =
  Partial<CreateMessageTriggerRuleDto>;

/**
 * Body of `PUT /message-trigger-rules/:id/branch-activation`, the only way a
 * branch may change a global rule. Content fields stay read-only.
 */
export interface UpdateMessageTriggerRuleBranchActivationDto {
  isActive: boolean;
}

export type MessageTriggerJobStatus =
  | "pending"
  | "processing"
  | "sent"
  | "failed"
  | "canceled";

export interface UpcomingMessageTriggerJobPayload {
  clientId?: number | null;
  clientName?: string | null;
  employeeId?: number | null;
  employeeName?: string | null;
  memberId: string;
  recipientName: string;
  recipientPhone: string;
  templateVariables: Record<string, string>;
  buttonUrl?: string | null;
}

export interface UpcomingMessageTriggerJob {
  id: string;
  ruleId: string;
  ruleName: string;
  eventType: MessageTriggerEventType | null;
  offsetType: MessageTriggerOffsetType | null;
  offsetDays: number;
  recipientType: MessageTriggerRecipientType;
  recipientPhone: string | null;
  templateKey: MessageTriggerTemplateKey;
  status: MessageTriggerJobStatus;
  scheduledFor: string;
  sentAt: string | null;
  canceledAt: string | null;
  cancelReason: string | null;
  clientId: number | null;
  employeeScheduleId: number | null;
  payload: UpcomingMessageTriggerJobPayload;
  createdAt: string;
  updatedAt: string;
}

export type MessageLogStatus = "pending" | "sent" | "failed" | "canceled";

export interface MessageLogRecord {
  id: number | string;
  provider: string;
  templateKey: string;
  triggerJobId: string | null;
  receiver: string;
  clientId: number | null;
  recipientPhone: string | null;
  messageBody: string;
  variables: Record<string, string>;
  status: MessageLogStatus;
  aligoMid: string | null;
  errorMessage: string | null;
  attempts: number;
  lastAttemptAt: string | null;
  nextRetryAt: string | null;
  createdAt: string;
  updatedAt: string;
  ruleId: string | null;
  ruleName: string | null;
  eventType: MessageTriggerEventType | null;
  offsetType: MessageTriggerOffsetType | null;
  offsetDays: number;
  scheduledFor: string | null;
  recipientType: MessageTriggerRecipientType | null;
  recipientName: string | null;
  clientName: string | null;
  employeeName: string | null;
}

export type MessageTemplateVariableType =
  | "text"
  | "phone"
  | "select"
  | "date"
  | "number"
  | "textarea";

export type MessageTemplateVariableOptionType = "custom" | "dataSource";

export interface MessageTemplateVariable {
  key: string;
  type: MessageTemplateVariableType;
  label: string;
  placeholder?: string;
  required: boolean;
  optionType?: MessageTemplateVariableOptionType;
  options?: string[];
  dataSource?: string;
  fallback?: string;
  min?: number;
  max?: number;
}

export interface RawMessageRecord {
  id: number;
  title: string;
  text: string;
  createdAt: Date;
  editedAt: Date | null;
}

export interface MessageRecord {
  id: number;
  title: string;
  text: string;
  createdAt: string;
  editedAt: string | null;
}

export interface CreateMessageRequest {
  title: string;
  text: string;
}

export interface UpdateMessageRequest {
  title: string;
  text: string;
}

export interface RawMessageTemplate {
  id: string;
  name: string;
  content: string;
  variables: MessageTemplateVariable[];
  createdAt: Date;
  updatedAt: Date;
}

export interface MessageTemplate {
  id: string;
  name: string;
  content: string;
  variables: MessageTemplateVariable[];
  createdAt: string;
  updatedAt: string;
}

export type MessageTemplateListResponse = MessageTemplate[];

export interface CreateMessageTemplateRequest {
  name: string;
  content: string;
  variables: MessageTemplateVariable[];
}

export interface UpdateMessageTemplateRequest {
  name?: string;
  content?: string;
  variables?: MessageTemplateVariable[];
}

export type MessageDeliverySmsType = "AUTO" | "SMS" | "LMS";
export type MessageDeliveryTriggerType = "immediate" | "scheduled";
export type MessageDeliveryResolvedSmsType = "SMS" | "LMS";
export type MessageDeliveryProviderSmsType = "SMS" | "LMS" | "MMS";

export interface SendMessageDeliverySmsRequest {
  receiver: string;
  message: string;
  title?: string;
  recipientName?: string;
  /** Optional client association; the backend resolves and verifies the branch-owned recipient. */
  clientId?: number | null;
  /** Optional employee association; the employee must be active in the selected branch. */
  employeeId?: number | null;
  msgType?: MessageDeliverySmsType;
  triggerType?: MessageDeliveryTriggerType;
  scheduledDate?: string;
  scheduledTime?: string;
  testMode?: boolean;
}

export interface SendMessageDeliverySmsResponse {
  provider: "aligo_sms";
  triggerType: MessageDeliveryTriggerType;
  request: {
    senderPhone?: string;
    receiver: string;
    msgType: MessageDeliveryResolvedSmsType;
    scheduledAt?: string;
    testMode: boolean;
  };
  result: {
    resultCode: number;
    message: string;
    msgId?: number;
    successCount?: number;
    errorCount?: number;
    msgType?: MessageDeliveryProviderSmsType;
  };
}

export const MESSAGE_SENDER_APPROVAL_STATUSES = [
  "not_requested",
  "pending",
  "approved",
] as const;

export type MessageSenderApprovalStatus =
  (typeof MESSAGE_SENDER_APPROVAL_STATUSES)[number];

export interface MessageSenderApprovalResponse {
  approvalStatus: MessageSenderApprovalStatus;
  isApproved: boolean;
  canRequest: boolean;
  requestedAt: string | null;
  approvedAt: string | null;
}

export interface MessageAutomationPolicyRow {
  id: string;
  label: string;
  value: string;
}

export interface MessageAutomationPolicy {
  id: string;
  title: string;
  description: string;
  active: boolean;
  requiresApproval: boolean;
  rows: MessageAutomationPolicyRow[];
}

export interface MessageAutomationPastTriggerConfig {
  sendIntervalMinutes: number;
  ruleOrder: string[];
}

export interface MessageAutomationPoliciesResponse {
  policies: MessageAutomationPolicy[];
  pastTriggerConfig: MessageAutomationPastTriggerConfig;
}

export interface SystemAdminBranchUser {
  id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  role: string | null;
}

export interface SystemAdminBranchMessageSenderApproval {
  approvalStatus: MessageSenderApprovalStatus;
  requestedAt: string | null;
  approvedAt: string | null;
  requestedBy: SystemAdminBranchUser | null;
}

export interface SystemAdminBranchRequest {
  id: string;
  name: string;
  slug: string;
  region: string | null;
  district: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
  isActive: boolean;
  createdAt: string | null;
  updatedAt: string | null;
  owner: SystemAdminBranchUser | null;
  messageSenderApproval: SystemAdminBranchMessageSenderApproval;
}
