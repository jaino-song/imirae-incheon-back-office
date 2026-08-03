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

export const MESSAGE_SECTION_DEFINITIONS = [
  { id: "send", label: "전송하기", mobilePath: "/messages/new" },
  { id: "scheduled", label: "발송 예정", mobilePath: "/messages/scheduled" },
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
  SERVICE_START_REMINDER: "서비스 시작 리마인드",
  SERVICE_INFO: "서비스 안내",
  SERVICE_END_REMINDER: "서비스 종료 안내",
  EMPLOYEE_ASSIGNED: "직원 배정 완료",
  SERVICE_RECORD_LINK: "제공기록지 작성 링크",
  CLIENT_GREETING: "인사 메시지",
  PRICE_INFO: "요금 안내",
  REMINDER: "리마인더",
  THANKS: "감사 메시지",
  SURVEY: "설문",
  INFO: "안내 메시지",
  GREETING: "인사 메시지",
  service_record_link_sms: "제공기록지 작성 링크",
  client_greeting_sms: "인사 메시지",
  manual_sms: "수동 메시지",
  "인사(소개)": "인사 메시지",
  "비용 안내": "요금 안내",
  "예약 완료(입금 확인)": "감사 메시지",
  "모니터링 설문": "설문",
  "정보 요청": "안내 메시지",
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
const SMS_DELIVERY_TEMPLATE_KEYS = new Set(["service_record_link_sms", "client_greeting_sms"]);
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
  const registeredClientName = record.clientName?.trim()
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
    recipientName: record.recipientName?.trim()
      || record.clientName?.trim()
      || record.employeeName?.trim()
      || fallbackRecipientName
      || "-",
    recipientPhone: record.recipientPhone?.trim() || record.receiver,
    recipientListLabel: registeredClientName || fallbackListLabel || record.receiver,
    channelLabel: getMessageChannelLabel(record.provider),
    sentAt: getMessageHistoryTimestamp(record),
    status: record.status,
    messagePreview: record.messageBody,
    failureReason: failureReason || undefined,
  };
}
