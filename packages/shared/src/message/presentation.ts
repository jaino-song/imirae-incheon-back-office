import {
  SMS_TRIGGER_TEMPLATE_KEYS,
  type MessageLogRecord,
  type MessageLogStatus,
  type MessageTriggerEventType,
  type MessageTriggerJobStatus,
  type MessageTriggerRecipientType,
  type MessageTriggerTemplateKey,
} from "../types/message";

export type MessageSectionId =
  | "send"
  | "scheduled"
  | "history"
  | "templates"
  | "triggers"
  | "settings";

// "scheduled" (발송 예정) is intentionally omitted here — its content is being
// folded into 발송 기록 by a follow-up task. MessageSectionId keeps the
// "scheduled" member so existing UNRELEASED_SECTION_IDS sets and route-path
// checks in both apps keep compiling; only the nav entry is gone for now.
export const MESSAGE_SECTION_DEFINITIONS = [
  { id: "send", label: "전송하기", mobilePath: "/messages/new" },
  { id: "history", label: "발송 기록", mobilePath: "/messages/history" },
  { id: "templates", label: "템플릿", mobilePath: "/messages/templates" },
  { id: "triggers", label: "자동 전송", mobilePath: "/messages/automation" },
  { id: "settings", label: "설정", mobilePath: "/messages/settings" },
] as const satisfies ReadonlyArray<{
  id: MessageSectionId;
  label: string;
  mobilePath: `/messages/${string}`;
}>;

export const MESSAGE_TEMPLATE_LABELS: Readonly<Record<string, string>> = {
  CLIENT_WELCOME: "고객 등록 안내",
  SERVICE_START_REMINDER: "서비스 시작 알림",
  SERVICE_INFO: "서비스 안내",
  SERVICE_END_REMINDER: "서비스 종료 알림",
  EMPLOYEE_ASSIGNED: "직원 배정 알림",
  SERVICE_RECORD_LINK: "제공기록지 작성 링크",
  CLIENT_GREETING: "인사 메시지",
  PRICE_INFO: "비용 안내",
  REMINDER: "리마인드",
  THANKS: "예약 완료(입금 확인)",
  SURVEY: "모니터링 설문",
  INFO: "정보 요청",
  GREETING: "인사 메시지",
  SERVICE_END_NOTICE: "서비스 종료 안내",
  service_record_link_sms: "제공기록지 작성 링크",
  client_greeting_sms: "인사 메시지",
  service_end_notice_sms: "서비스 종료 안내",
  manual_sms: "수동 메시지",
  "인사(소개)": "인사 메시지",
};

export const MESSAGE_HISTORY_STATUS_LABELS: Readonly<Record<MessageLogStatus, string>> = {
  sent: "발송 성공",
  failed: "발송 실패",
  pending: "재시도 대기",
  canceled: "발송 취소",
};

export const MESSAGE_JOB_STATUS_LABELS: Readonly<Record<MessageTriggerJobStatus, string>> = {
  pending: "발송 대기",
  processing: "발송 중",
  sent: "발송 완료",
  failed: "발송 실패",
  canceled: "발송 취소",
};

// Single source of truth for message-status -> StatusBadge variant. Both
// apps' StatusBadge already wires these variants to the shared `--status-*`
// design tokens, so consumers should read these maps instead of hand-rolling
// Tailwind palette classes (e.g. `bg-emerald-50`, `bg-slate-100`) per status.
export type MessageStatusBadgeVariant = "neutral" | "info" | "success" | "warning" | "danger";

export const MESSAGE_LOG_STATUS_BADGE_VARIANT: Readonly<Record<MessageLogStatus, MessageStatusBadgeVariant>> = {
  sent: "success",
  failed: "danger",
  pending: "warning",
  canceled: "neutral",
};

export const MESSAGE_JOB_STATUS_BADGE_VARIANT: Readonly<Record<MessageTriggerJobStatus, MessageStatusBadgeVariant>> = {
  pending: "warning",
  processing: "info",
  sent: "success",
  failed: "danger",
  canceled: "neutral",
};

// Copy for the merged 발송 기록 screen, which shows upcoming sends and past
// sends as two zones of one list. Both apps read these so the two screens
// cannot drift apart in wording — the split copy in the old separate screens
// is exactly how they diverged before.
export const MESSAGE_RECORD_ZONE_LABELS = {
  upcoming: "예정",
  past: "지난 발송",
} as const;

export type MessageRecordStatusFilter = "all" | "upcoming" | "sent" | "failed" | "canceled";

export const MESSAGE_RECORD_STATUS_FILTER_LABELS: Readonly<Record<MessageRecordStatusFilter, string>> = {
  all: "전체",
  upcoming: "예정",
  sent: "발송",
  failed: "실패",
  canceled: "취소",
};

// A user-pressed cancel is permanent: the backend marks it so the re-sync that
// runs on any client or rule edit will not put the message back on the
// schedule. The confirm copy says so, because "취소" alone reads as reversible.
export const MESSAGE_JOB_CANCEL_COPY = {
  action: "발송 취소",
  confirmTitle: "예정된 발송을 취소할까요?",
  confirmBody:
    "취소하면 이 메시지는 자동으로 발송되지 않습니다. 고객 정보를 수정해도 다시 예약되지 않습니다.",
  confirmAction: "발송 취소",
  dismiss: "닫기",
  success: "예정된 발송을 취소했습니다.",
  failure: "이미 발송되었거나 취소할 수 없는 상태입니다.",
} as const;

export const MESSAGE_RECORD_REASON_LABEL = "사유";

export const MESSAGE_EVENT_LABELS: Readonly<Record<MessageTriggerEventType, string>> = {
  CLIENT_CREATED: "고객 등록",
  SERVICE_START: "서비스 시작",
  SERVICE_END: "서비스 종료",
  EMPLOYEE_ASSIGNED: "직원 배정",
};

export const MESSAGE_RECIPIENT_LABELS: Readonly<Record<MessageTriggerRecipientType, string>> = {
  CLIENT: "고객",
  PRIMARY_EMPLOYEE: "주 담당 직원",
  SECONDARY_EMPLOYEE: "보조 직원",
};

const SMS_HISTORY_PROVIDERS = new Set(["aligo_sms", "sms"]);
const SMS_DELIVERY_TEMPLATE_KEYS = new Set(["service_record_link_sms", "client_greeting_sms", "service_end_notice_sms"]);
const INTERNAL_KEY_PATTERN = /^[a-z0-9_-]+$/i;

function getVariableValue(variables: Record<string, string> | undefined, key: string): string | null {
  const value = variables?.[key]?.trim();
  return value ? value : null;
}

function getKnownTemplateLabel(value: string | null | undefined): string | null {
  const normalized = value?.trim();
  if (!normalized) return null;

  return MESSAGE_TEMPLATE_LABELS[normalized]
    ?? MESSAGE_TEMPLATE_LABELS[normalized.toUpperCase()]
    ?? null;
}

function getHumanFacingFallback(value: string | null | undefined): string | null {
  const normalized = value?.trim();
  if (!normalized || INTERNAL_KEY_PATTERN.test(normalized)) return null;
  return normalized;
}

export function getMessageTemplateLabel(
  templateKey: string,
  variables?: Record<string, string>,
): string {
  const directLabel = getKnownTemplateLabel(templateKey);
  if (directLabel) return directLabel;

  const systemTemplateLabel = getKnownTemplateLabel(getVariableValue(variables, "systemTemplateKey"));
  if (systemTemplateLabel) return systemTemplateLabel;

  const variableTitle = getVariableValue(variables, "title");
  return getKnownTemplateLabel(variableTitle)
    ?? getHumanFacingFallback(variableTitle)
    ?? "메시지";
}

export function getMessageHistoryTitle(input: {
  templateKey: string;
  variables?: Record<string, string>;
  ruleName?: string | null;
}): string {
  const templateLabel = getMessageTemplateLabel(input.templateKey, input.variables);
  const ruleName = input.ruleName?.trim();
  const normalizedRuleLabel = getKnownTemplateLabel(ruleName);

  if (normalizedRuleLabel) return normalizedRuleLabel;

  if (ruleName && ruleName !== input.templateKey) {
    return getHumanFacingFallback(ruleName) ?? templateLabel;
  }

  return templateLabel;
}

export function isSmsTriggerTemplate(templateKey: string | null | undefined): boolean {
  if (!templateKey) return false;

  return SMS_TRIGGER_TEMPLATE_KEYS.includes(templateKey as MessageTriggerTemplateKey)
    || SMS_DELIVERY_TEMPLATE_KEYS.has(templateKey);
}

export function isSmsHistoryProvider(provider: string | null | undefined): boolean {
  return provider ? SMS_HISTORY_PROVIDERS.has(provider) : false;
}

export function isSmsHistoryRecord(record: MessageLogRecord): boolean {
  return isSmsHistoryProvider(record.provider) || isSmsTriggerTemplate(record.templateKey);
}

export type MessageChannel = "sms";

export function isHistoryRecordInChannel(
  record: MessageLogRecord,
  channel: MessageChannel,
): boolean {
  const isSmsRecord = isSmsHistoryRecord(record);
  return channel === "sms" && isSmsRecord;
}

export function getMessageChannelLabel(provider: string | null | undefined): string {
  if (isSmsHistoryProvider(provider)) return "메시지";
  return "메시지";
}

export function getMessageHistoryTimestamp(record: MessageLogRecord): string {
  return record.lastAttemptAt ?? record.updatedAt ?? record.createdAt;
}

export function formatMessageDateTimeCompact(dateString: string | null): string {
  if (!dateString) return "-";

  const date = new Date(dateString);
  if (Number.isNaN(date.getTime())) return "-";

  return date.toLocaleString("ko-KR", {
    month: "numeric",
    day: "numeric",
    weekday: "short",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function formatMessageDateTimeDetail(dateString: string | null): string {
  if (!dateString) return "-";

  const date = new Date(dateString);
  if (Number.isNaN(date.getTime())) return "-";

  return date.toLocaleString("ko-KR", {
    year: "numeric",
    month: "long",
    day: "numeric",
    weekday: "short",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function formatMessageFailureReason(reason: string | null | undefined): string {
  if (!reason) return "";

  return reason
    .replace(/[^\uAC00-\uD7A3\u3131-\u318E\s.]/g, "")
    .replace(/\s+/g, " ")
    .replace(/\s+\./g, ".")
    .trim();
}

export interface NormalizeMessageHistoryPresentationOptions {
  recipientNameFallback?: string | null;
  recipientListLabelFallback?: string | null;
}

export interface NormalizedMessageHistoryPresentation {
  id: number | string;
  title: string;
  templateLabel: string;
  recipientName: string;
  recipientPhone: string;
  recipientListLabel: string;
  channelLabel: string;
  sentAt: string;
  status: MessageLogStatus;
  messagePreview: string;
  failureReason?: string;
}

export function normalizeMessageHistoryPresentation(
  record: MessageLogRecord,
  options: NormalizeMessageHistoryPresentationOptions = {},
): NormalizedMessageHistoryPresentation {
  const templateLabel = getMessageTemplateLabel(record.templateKey, record.variables);
  const title = getMessageHistoryTitle(record);
  const fallbackRecipientName = options.recipientNameFallback?.trim() ?? "";
  const fallbackListLabel = options.recipientListLabelFallback?.trim() ?? fallbackRecipientName;
  const isEmployeeRecipient = record.recipientType === "PRIMARY_EMPLOYEE"
    || record.recipientType === "SECONDARY_EMPLOYEE";
  const resolvedRecipientName = record.recipientName?.trim()
    || (isEmployeeRecipient ? record.employeeName?.trim() : record.clientName?.trim())
    || record.employeeName?.trim()
    || fallbackRecipientName
    || "";
  const registeredClientName = isEmployeeRecipient
    ? resolvedRecipientName
    : record.clientName?.trim()
      || (record.clientId !== null ? record.recipientName?.trim() : "")
      || fallbackRecipientName
      || "";
  const failureReason = record.status === "failed"
    ? formatMessageFailureReason(record.errorMessage)
    : "";

  return {
    id: record.id,
    title,
    templateLabel,
    recipientName: resolvedRecipientName || "-",
    recipientPhone: record.recipientPhone?.trim() || record.receiver,
    recipientListLabel: registeredClientName || fallbackListLabel || record.receiver,
    channelLabel: getMessageChannelLabel(record.provider),
    sentAt: getMessageHistoryTimestamp(record),
    status: record.status,
    messagePreview: record.messageBody,
    failureReason: failureReason || undefined,
  };
}
