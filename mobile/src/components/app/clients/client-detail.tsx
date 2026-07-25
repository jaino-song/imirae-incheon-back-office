"use client";

import { useState, type KeyboardEvent, type ReactNode } from "react";
import { CalendarDays, CircleAlert, FileCheck2, MessageCircle, MoreVertical, RotateCcw, SquarePen, Trash2, User } from "lucide-react";

import { Client } from "@/lib/client/types";
import { getMobileClientBadges } from "@/lib/client/badges";
import { EformsignDocument } from "@/lib/eformsign/types";
import {
  applyServiceScheduleChange,
  fetchClientServiceRecords,
  previewServiceScheduleChange,
  resetServiceRecordLink,
  useClientServiceRecords,
} from "@/hooks/useServiceRecords";
import { approveScheduleChange, rejectScheduleChange } from "@/hooks/useClients";
import { toast } from "@/hooks/use-toast";
import { formatDateForDisplay } from "@/lib/date/format-date-for-display";
import { formatKoreanPhoneNumber } from "@/lib/phone";
import { formatBirthdayYYMMDD } from "@babyjamjam/shared/utils/birthday";
import { ApprovalTwoButtonModal } from "@/components/app/ui/ApprovalTwoButtonModal";
import {
  MESSAGE_HISTORY_STATUS_LABELS,
  formatMessageDateTimeCompact,
  formatMessageFailureReason,
  getMessageChannelLabel,
  getMessageHistoryTitle,
} from "@babyjamjam/shared";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  DetailTabPills,
  InfoCard,
  InfoRow,
  MobileDetailActions,
  MobileDetailHeader,
  MobileDetailPage,
  MobileDetailTabPanel,
} from "@/components/app/mobile-redesign/detail-sheet";
import { ClientMessageHistoryDetail } from "@/components/app/clients/client-message-history-detail";
import { ClientServiceRecords } from "@/components/app/clients/client-service-records";
import { ServiceRecordLinkResetResultModal } from "@/components/app/clients/ServiceRecordLinkResetResultModal";
import { ServiceScheduleChangeModal } from "@/components/app/clients/ServiceScheduleChangeModal";
import { getScheduleChangeErrorMessage } from "@/lib/service-records/schedule-change-error";

type UnknownRecord = Record<string, unknown>;

interface ServiceScheduleChangeTarget {
  scheduleId: number;
  sessionIndex: number;
  currentDate: string;
  minimumDate: string;
}

function getTodayIsoDate(): string {
  const today = new Date();
  const year = today.getFullYear();
  const month = String(today.getMonth() + 1).padStart(2, "0");
  const day = String(today.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatScheduleChangeMonthDay(value: string): string {
  const match = value.match(/^\d{4}-(\d{2})-(\d{2})$/);
  return match ? `${Number(match[1])}월 ${Number(match[2])}일` : value;
}

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null;
}

function stringFromUnknown(value: unknown): string | null {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }

  return null;
}

function collectRecords(value: unknown, depth = 0): UnknownRecord[] {
  if (depth > 6 || value == null) return [];
  if (Array.isArray(value)) return value.flatMap((item) => collectRecords(item, depth + 1));
  if (!isRecord(value)) return [];
  return [
    value,
    ...Object.values(value).flatMap((item) => collectRecords(item, depth + 1)),
  ];
}

function valueFromFieldRecord(record: UnknownRecord): string | null {
  const valueKeys = ["value", "field_value", "fieldValue", "data", "text"] as const;
  for (const key of valueKeys) {
    const value = stringFromUnknown(record[key]);
    if (value) return value;
  }

  for (const nested of collectRecords(record).slice(1)) {
    for (const key of valueKeys) {
      const value = stringFromUnknown(nested[key]);
      if (value) return value;
    }
  }

  return null;
}

function documentFieldValue(doc: EformsignDocument | null | undefined, fieldIds: readonly string[]): string | null {
  if (!doc) return null;

  const normalizeFieldId = (value: string) => value.replace(/[\s_\-:/.()[\]{}]+/g, "").toLowerCase();
  const canUseReverseContains = (value: string) => /^[a-z0-9]+$/.test(value) && value.length >= 5;
  const normalizedIds = fieldIds.map(normalizeFieldId);
  for (const record of collectRecords(doc.fields)) {
    const idTokens = [
      stringFromUnknown(record.id),
      stringFromUnknown(record.field_id),
      stringFromUnknown(record.fieldId),
      stringFromUnknown(record.name),
      stringFromUnknown(record.label),
      stringFromUnknown(record.field_name),
      stringFromUnknown(record.fieldName),
      stringFromUnknown(record.display_name),
      stringFromUnknown(record.displayName),
      stringFromUnknown(record.input_id),
      stringFromUnknown(record.inputId),
    ].filter((value): value is string => Boolean(value));

    if (idTokens.some((token) => {
      const normalizedToken = normalizeFieldId(token);
      return normalizedIds.some(
        (id) =>
          normalizedToken === id ||
          normalizedToken.includes(id) ||
          (canUseReverseContains(normalizedToken) && id.includes(normalizedToken)),
      );
    })) {
      const value = valueFromFieldRecord(record);
      if (value) return value;
    }
  }

  return null;
}

function numericText(value: string | null | undefined): string | null {
  const digits = (value ?? "").replace(/\D/g, "");
  return digits || null;
}

function normalizeYymmdd(value: string | null | undefined): string | null {
  if (!value) return null;
  const digits = value.replace(/\D/g, "");
  if (digits.length === 6) return digits;
  if (digits.length >= 8) return `${digits.slice(2, 4)}${digits.slice(4, 6)}${digits.slice(6, 8)}`;
  return null;
}

function yymmddToIsoDate(value: string | null | undefined): string | null {
  const yymmdd = normalizeYymmdd(value);
  if (!yymmdd) return null;

  const yy = Number(yymmdd.slice(0, 2));
  const month = yymmdd.slice(2, 4);
  const day = yymmdd.slice(4, 6);
  const year = yy >= 70 ? 1900 + yy : 2000 + yy;
  const iso = `${year}-${month}-${day}`;
  const date = new Date(`${iso}T00:00:00`);
  return Number.isNaN(date.getTime()) ? null : iso;
}

function compactDateToIsoDate(value: string | null | undefined): string | null {
  const digits = (value ?? "").replace(/\D/g, "");
  if (digits.length < 8) return null;

  const year = digits.slice(0, 4);
  const month = digits.slice(4, 6);
  const day = digits.slice(6, 8);
  const iso = `${year}-${month}-${day}`;
  const date = new Date(`${iso}T00:00:00`);
  return Number.isNaN(date.getTime()) ? null : iso;
}

function formatIsoDateParts(isoDate: string): string | null {
  const match = isoDate.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return null;
  return `${match[1]}.${match[2]}.${match[3]}`;
}

function isoDateFromTimestamp(value: string | number | null | undefined): string | null {
  if (value === null || value === undefined || value === "") return null;
  const numericValue = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numericValue) || numericValue <= 0) return null;

  const timestamp = numericValue < 10_000_000_000 ? numericValue * 1000 : numericValue;
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return null;

  const year = String(date.getFullYear());
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function twoDigitPart(value: string | null | undefined): string | null {
  const digits = numericText(value);
  if (!digits) return null;
  return digits.slice(-2).padStart(2, "0");
}

function fourDigitYear(value: string | null | undefined): string | null {
  const digits = numericText(value);
  if (!digits) return null;
  if (digits.length >= 4) return digits.slice(-4);
  const yy = Number(digits.slice(-2));
  return String(yy >= 70 ? 1900 + yy : 2000 + yy);
}

function documentDateFromParts(
  doc: EformsignDocument | null | undefined,
  parts: {
    year: readonly string[];
    month: readonly string[];
    day: readonly string[];
  },
): string | null {
  const year = fourDigitYear(documentFieldValue(doc, parts.year));
  const month = twoDigitPart(documentFieldValue(doc, parts.month));
  const day = twoDigitPart(documentFieldValue(doc, parts.day));
  if (!year || !month || !day) return null;

  const iso = `${year}-${month}-${day}`;
  const date = new Date(`${iso}T00:00:00`);
  return Number.isNaN(date.getTime()) ? null : iso;
}

function firstValue(...values: Array<string | number | null | undefined>): string | null {
  for (const value of values) {
    const normalized = typeof value === "number" ? String(value) : value?.trim();
    if (normalized) return normalized;
  }
  return null;
}

function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return "-";
  if (/^\d{6}$/.test(dateStr)) return formatBirthdayYYMMDD(dateStr);
  const normalized = compactDateToIsoDate(dateStr) ?? yymmddToIsoDate(dateStr) ?? dateStr;
  const formatted = formatIsoDateParts(normalized);
  if (formatted) return formatted;

  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) return dateStr;
  return formatDateForDisplay(date, dateStr);
}

function formatPrice(price: string | null): string {
  if (!price) return "-";
  const amount = Number(price.replace(/,/g, ""));
  if (Number.isNaN(amount)) return price;
  return `${amount.toLocaleString("ko-KR")}원`;
}

function contractDateValue(
  doc: EformsignDocument | null | undefined,
  fieldIds: readonly string[],
  parts: {
    year: readonly string[];
    month: readonly string[];
    day: readonly string[];
  },
): string | null {
  return yymmddToIsoDate(documentFieldValue(doc, fieldIds)) ?? documentDateFromParts(doc, parts);
}

function contractDurationValue(doc: EformsignDocument | null | undefined): string | null {
  return numericText(documentFieldValue(doc, [
    "바우처 기간",
    "바우처기간",
    "서비스 일수",
    "서비스일수",
    "일수",
    "days",
    "duration",
    "contractDuration",
  ]));
}

function documentServicePeriodRange(doc: EformsignDocument | null | undefined): { start: string; end: string } | null {
  const value = documentFieldValue(doc, [
    "서비스 기간",
    "서비스기간",
    "계약 기간",
    "계약기간",
    "contractPeriod",
    "servicePeriod",
  ]);
  if (!value) return null;

  const digits = value.replace(/\D/g, "");
  if (digits.length < 16) return null;

  const start = compactDateToIsoDate(digits.slice(0, 8));
  const end = compactDateToIsoDate(digits.slice(8, 16));
  if (!start || !end) return null;

  return { start, end };
}

function contractPrimaryEmployeeName(doc: EformsignDocument | null | undefined): string | null {
  return documentFieldValue(doc, [
    "제공인력 1 성명",
    "제공인력1성명",
    "제공인력 성명",
    "제공인력명",
    "제공인력",
    "관리사 성명",
    "관리사",
    "산후관리사 성명",
    "제공자 성명",
    "caretaker1Name",
    "caretakerName",
    "employeeName",
    "providerName",
  ]);
}

function documentStatusLabel(status: Client["documentStatus"]): string {
  switch (status) {
    case "completed":
      return "완료";
    case "opened":
    case "requested":
      return "검토 필요";
    case "created":
      return "발송 대기";
    case "rejected":
    case "revoked":
    case "deleted":
      return "확인 필요";
    default:
      return "미발급";
  }
}

function documentStatusTone(status: Client["documentStatus"]): "green" | "primary" | "orange" | "muted" | "burgundy" {
  switch (status) {
    case "completed":
      return "green";
    case "opened":
    case "requested":
      return "primary";
    case "created":
      return "orange";
    case "rejected":
    case "revoked":
    case "deleted":
      return "burgundy";
    default:
      return "muted";
  }
}

export interface ClientGroup {
  key: string;
  title: string;
  badge: string;
  badgeTone: "burgundy" | "primary" | "muted" | "green" | "orange";
  badgeMini: "burgundy" | "primary" | "muted" | "green" | "orange";
  match: (c: Client) => boolean;
  counter: string;
}

export const GROUPS: ClientGroup[] = [
  {
    key: "pre_booking",
    title: "예약 전",
    badge: "예약 전",
    badgeTone: "muted",
    badgeMini: "muted",
    match: (c) => c.serviceStatus === "pre_booking",
    counter: "명",
  },
  {
    key: "active",
    title: "진행중",
    badge: "진행중",
    badgeTone: "primary",
    badgeMini: "primary",
    match: (c) => c.serviceStatus === "active",
    counter: "명",
  },
  {
    key: "replacement_requested",
    title: "교체 요청",
    badge: "교체 요청",
    badgeTone: "burgundy",
    badgeMini: "burgundy",
    match: (c) => c.serviceStatus === "replacement_requested",
    counter: "명",
  },
  {
    key: "waiting",
    title: "대기",
    badge: "대기",
    badgeTone: "orange",
    badgeMini: "orange",
    match: (c) => c.serviceStatus === "waiting",
    counter: "명",
  },
  {
    key: "terminated",
    title: "중단",
    badge: "중단",
    badgeTone: "muted",
    badgeMini: "muted",
    match: (c) => c.serviceStatus === "terminated",
    counter: "명",
  },
  {
    key: "completed",
    title: "완료",
    badge: "완료",
    badgeTone: "green",
    badgeMini: "green",
    match: (c) => c.serviceStatus === "completed",
    counter: "명",
  },
];

export function shouldShowMissingContractBadge(client: Client): boolean {
  return client.serviceStatus === "active" && client.documentStatus !== "completed";
}

export type DetailTabId = "scheduleChange" | "basic" | "contracts" | "message" | "serviceRecords";

export interface ClientNotificationLogRecord {
  id: number;
  provider: string;
  templateKey: string;
  receiver: string | null;
  recipientPhone?: string | null;
  recipientName: string | null;
  clientId: number | null;
  status: "pending" | "sent" | "failed" | string;
  messageBody: string;
  errorMessage: string | null;
  createdAt: string;
  ruleName: string | null;
  variables?: Record<string, unknown> | null;
}

type DetailRowTone = "green" | "primary" | "orange" | "muted" | "burgundy" | "purple";
const CLIENT_GREETING_SMS_TEMPLATE_KEY = "client_greeting_sms";

function DetailDocRow({
  icon,
  title,
  meta,
  badge,
  tone,
  onClick,
}: {
  icon: ReactNode;
  title: string;
  meta: ReactNode;
  badge: string;
  tone: DetailRowTone;
  onClick?: () => void;
}) {
  const interactive = Boolean(onClick);
  return (
    <div
      className={interactive ? "doc-row doc-row-tappable" : "doc-row"}
      data-component="mobile-clients-doc-row"
      {...(interactive
        ? {
            role: "button" as const,
            tabIndex: 0,
            onClick,
            onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                onClick?.();
              }
            },
          }
        : {})}
    >
      <div className={`doc-icon doc-icon-${tone}`} data-component="mobile-clients-doc-icon">
        {icon}
      </div>
      <div className="doc-info" data-component="mobile-clients-doc-info">
        <div className="doc-title" data-component="mobile-clients-doc-title">
          {title}
        </div>
        <div className="doc-meta" data-component="mobile-clients-doc-meta">
          {meta}
        </div>
      </div>
      <span className={`badge-mini ${tone}`}>{badge}</span>
    </div>
  );
}

function notificationChannelLabel(log: ClientNotificationLogRecord): string {
  return getMessageChannelLabel(log.provider);
}

function notificationVariables(log: ClientNotificationLogRecord): Record<string, unknown> {
  return isRecord(log.variables) ? log.variables : {};
}

function notificationStringVariables(log: ClientNotificationLogRecord): Record<string, string> {
  return Object.fromEntries(
    Object.entries(notificationVariables(log))
      .filter((entry): entry is [string, string] => typeof entry[1] === "string"),
  );
}

function notificationTitle(log: ClientNotificationLogRecord): string {
  return getMessageHistoryTitle({
    templateKey: log.templateKey,
    variables: notificationStringVariables(log),
    ruleName: log.ruleName,
  });
}

function isClientGreetingSmsLog(log: ClientNotificationLogRecord): boolean {
  const variables = notificationVariables(log);
  return (
    log.templateKey === CLIENT_GREETING_SMS_TEMPLATE_KEY ||
    variables.automationKey === "CLIENT_GREETING_SMS" ||
    variables.systemTemplateKey === "GREETING"
  );
}

function notificationReceiverKey(receiver: string | null): string {
  return (receiver ?? "").replace(/\D/g, "");
}

function visibleNotificationLogs(logs: ClientNotificationLogRecord[]): ClientNotificationLogRecord[] {
  const sortedLogs = [...logs].sort((a, b) => {
    const bTime = new Date(b.createdAt).getTime();
    const aTime = new Date(a.createdAt).getTime();
    return (Number.isNaN(bTime) ? 0 : bTime) - (Number.isNaN(aTime) ? 0 : aTime);
  });
  const seenGreetingKeys = new Set<string>();

  return sortedLogs.filter((log) => {
    const key = `${notificationChannelLabel(log)}:${notificationReceiverKey(log.receiver)}:${notificationTitle(log)}`;
    if (seenGreetingKeys.has(key)) return false;
    if (isClientGreetingSmsLog(log)) seenGreetingKeys.add(key);
    return true;
  });
}

function notificationStatusLabel(status: string): string {
  switch (status) {
    case "failed":
      return MESSAGE_HISTORY_STATUS_LABELS.failed;
    case "pending":
      return MESSAGE_HISTORY_STATUS_LABELS.pending;
    case "sent":
      return MESSAGE_HISTORY_STATUS_LABELS.sent;
    case "canceled":
      return MESSAGE_HISTORY_STATUS_LABELS.canceled;
    default:
      return status || "-";
  }
}

function notificationStatusTone(status: string): DetailRowTone {
  switch (status) {
    case "failed":
      return "burgundy";
    case "pending":
      return "orange";
    case "sent":
      return "green";
    case "canceled":
      return "muted";
    default:
      return "muted";
  }
}

function formatNotificationTime(createdAt: string): string {
  return formatMessageDateTimeCompact(createdAt);
}

export function ClientDetailContent({
  "data-component": dataComponent,
  client,
  contractDocument,
  activeTab,
  notificationLogs = [],
  isNotificationLogsLoading = false,
  isNotificationLogsError = false,
  onRetryNotificationLogs,
  isIssuingContract = false,
  onTabChange,
  onMessage,
  onIssueContract,
  onEdit,
  onDelete,
  onClientUpdated,
}: {
  "data-component": string;
  client: Client;
  contractDocument?: EformsignDocument | null;
  activeTab: DetailTabId;
  notificationLogs?: ClientNotificationLogRecord[];
  isNotificationLogsLoading?: boolean;
  isNotificationLogsError?: boolean;
  onRetryNotificationLogs?: () => void;
  isIssuingContract?: boolean;
  onTabChange: (id: DetailTabId) => void;
  onMessage: () => void;
  onIssueContract: (client: Client) => void;
  onEdit: (client: Client) => void;
  onDelete: (id: number) => void;
  onClientUpdated: (client: Client) => void;
}) {
  // Keyed selection so the open message-detail auto-resets when the tab or client changes
  // (derive-during-render — avoids a setState-in-effect).
  const detailKey = `${activeTab}:${client.id}`;
  const [selectedEntry, setSelectedEntry] = useState<{ key: string; log: ClientNotificationLogRecord } | null>(null);
  const selectedLog = selectedEntry && selectedEntry.key === detailKey ? selectedEntry.log : null;
  const serviceRecordsQuery = useClientServiceRecords(client.id, {
    enabled: activeTab === "serviceRecords",
  });
  const [resetLinkModalOpen, setResetLinkModalOpen] = useState(false);
  const [resetServiceRecordUrl, setResetServiceRecordUrl] = useState<string | null>(null);
  const [isResettingLink, setIsResettingLink] = useState(false);
  const [scheduleChangeTarget, setScheduleChangeTarget] = useState<ServiceScheduleChangeTarget | null>(null);
  const [selectedScheduleChangeDate, setSelectedScheduleChangeDate] = useState("");
  const [isPreparingScheduleChange, setIsPreparingScheduleChange] = useState(false);
  const [isApplyingScheduleChange, setIsApplyingScheduleChange] = useState(false);
  const [isScheduleChangeDecisionPending, setIsScheduleChangeDecisionPending] = useState(false);

  const handleResetServiceRecordLink = async () => {
    setIsResettingLink(true);
    try {
      const overview = await fetchClientServiceRecords(client.id);
      const assignments = overview.assignments ?? [];
      const activeAssignment = assignments.find((assignment) => !assignment.replaced)
        ?? assignments[0]
        ?? null;
      if (!activeAssignment) {
        toast({
          description: "관리사 배정이 없어 링크를 재설정할 수 없습니다.",
          variant: "destructive",
        });
        return;
      }

      const reset = await resetServiceRecordLink(activeAssignment.scheduleId);
      setResetLinkModalOpen(false);
      setResetServiceRecordUrl(reset.serviceRecordUrl);
    } catch {
      toast({
        description: "제공기록지 링크 재설정에 실패했습니다. 잠시 후 다시 시도해 주세요.",
        variant: "destructive",
      });
    } finally {
      setIsResettingLink(false);
    }
  };

  const handleOpenServiceScheduleChange = async () => {
    setIsPreparingScheduleChange(true);
    try {
      const overview = await fetchClientServiceRecords(client.id);
      const assignments = overview.assignments ?? [];
      const activeAssignment = assignments.find((assignment) => !assignment.replaced)
        ?? assignments[0]
        ?? null;
      if (!activeAssignment) {
        toast({
          description: "관리사 배정이 없어 서비스 일정을 변경할 수 없습니다.",
          variant: "destructive",
        });
        return;
      }

      const preview = await previewServiceScheduleChange(activeAssignment.scheduleId);
      const today = getTodayIsoDate();
      const minimumDate = preview.minimumDate > today ? preview.minimumDate : today;
      setSelectedScheduleChangeDate(minimumDate);
      setScheduleChangeTarget({
        scheduleId: activeAssignment.scheduleId,
        sessionIndex: preview.sessionIndex,
        currentDate: preview.fromDate,
        minimumDate,
      });
    } catch {
      toast({
        description: "변경할 수 있는 다음 서비스 일정을 불러오지 못했습니다.",
        variant: "destructive",
      });
    } finally {
      setIsPreparingScheduleChange(false);
    }
  };

  const handleApplyServiceScheduleChange = async () => {
    if (!scheduleChangeTarget) return;

    setIsApplyingScheduleChange(true);
    try {
      const changed = await applyServiceScheduleChange(scheduleChangeTarget.scheduleId, {
        toDate: selectedScheduleChangeDate,
      });
      onClientUpdated({
        ...client,
        endDate: changed.newEndDate,
        pendingScheduleChange: null,
      });
      setScheduleChangeTarget(null);
      setSelectedScheduleChangeDate("");
      toast({ description: `서비스 일정과 종료일(${changed.newEndDate})이 변경되었습니다.` });
    } catch (error) {
      toast({
        description: getScheduleChangeErrorMessage(error),
        variant: "destructive",
      });
    } finally {
      setIsApplyingScheduleChange(false);
    }
  };

  const handleCopyResetServiceRecordLink = async (serviceRecordUrl: string) => {
    try {
      await navigator.clipboard.writeText(serviceRecordUrl);
      toast({ description: "제공기록지 링크를 복사했습니다." });
    } catch {
      toast({
        description: "링크 복사에 실패했습니다. 링크를 직접 선택해 복사해 주세요.",
        variant: "destructive",
      });
    }
  };

  const handleScheduleChangeDecision = async (decision: "approve" | "reject") => {
    const pendingScheduleChange = client.pendingScheduleChange;
    if (!pendingScheduleChange) return;

    setIsScheduleChangeDecisionPending(true);
    try {
      if (decision === "approve") {
        await approveScheduleChange(pendingScheduleChange.id);
      } else {
        await rejectScheduleChange(pendingScheduleChange.id);
      }
      onClientUpdated({
        ...client,
        endDate: decision === "approve" ? pendingScheduleChange.newEndDate : client.endDate,
        pendingScheduleChange: null,
      });
      onTabChange("basic");
      toast({
        description: decision === "approve"
          ? "일정 변경 요청을 승인했습니다."
          : "일정 변경 요청을 거부했습니다.",
      });
    } catch (error) {
      toast({
        description: getScheduleChangeErrorMessage(error),
        variant: "destructive",
      });
    } finally {
      setIsScheduleChangeDecisionPending(false);
    }
  };

  const group = GROUPS.find((g) => g.match(client)) ?? GROUPS[1];
  const clientBadges = getMobileClientBadges(client);
  const detailAvatarTone = clientBadges[0]?.tone ?? group.badgeTone;
  const docTone = documentStatusTone(client.documentStatus);
  const hasContractDocument = Boolean(client.eDocId);
  const displayNotificationLogs = visibleNotificationLogs(notificationLogs);
  const birthDate = firstValue(
    client.birthday,
    documentFieldValue(contractDocument, [
      "이용자 생년월일",
      "생년월일",
      "주민번호 앞자리",
      "customerDOB",
      "customerBirthDate",
      "birthday",
    ]),
  );
  const dueDate = firstValue(
    client.dueDate,
    yymmddToIsoDate(documentFieldValue(contractDocument, [
      "출산 예정일",
      "출산예정일",
      "dueDate",
      "expectedBirthDate",
    ])),
  );
  const phone = firstValue(
    client.phone,
    documentFieldValue(contractDocument, [
      "이용자 연락처",
      "연락처",
      "휴대폰",
      "전화번호",
      "customerContact",
      "customerPhone",
    ]),
  );
  const address = firstValue(
    client.address,
    documentFieldValue(contractDocument, ["이용자 주소", "주소", "customerAddress", "address"]),
  );
  const primaryEmployeeName = firstValue(client.primaryEmployee?.name, contractPrimaryEmployeeName(contractDocument));
  const primaryEmployeePhone = firstValue(
    client.primaryEmployee?.phone,
    documentFieldValue(contractDocument, [
      "제공인력 1 연락처",
      "제공인력1연락처",
      "제공인력 연락처",
      "관리사 연락처",
      "산후관리사 연락처",
      "caretaker1Contact",
      "caretakerContact",
      "employeePhone",
      "providerPhone",
    ]),
  );
  const secondaryEmployeeName = firstValue(
    client.secondaryEmployee?.name,
    documentFieldValue(contractDocument, [
      "제공인력 2 성명",
      "제공인력2성명",
      "보조 제공인력 성명",
      "보조관리사 성명",
      "caretaker2Name",
      "secondaryEmployeeName",
    ]),
  );
  const secondaryEmployeePhone = firstValue(
    client.secondaryEmployee?.phone,
    documentFieldValue(contractDocument, [
      "제공인력 2 연락처",
      "제공인력2연락처",
      "보조 제공인력 연락처",
      "보조관리사 연락처",
      "caretaker2Contact",
      "secondaryEmployeePhone",
    ]),
  );
  const serviceType = firstValue(
    client.type,
    documentFieldValue(contractDocument, [
      "바우처 유형",
      "바우처유형",
      "유형",
      "서비스 유형",
      "서비스유형",
      "type",
      "serviceType",
    ]),
  );
  const serviceDuration = firstValue(client.duration, contractDurationValue(contractDocument));
  const servicePeriodRange = documentServicePeriodRange(contractDocument);
  const serviceStartDate = firstValue(
    client.startDate,
    servicePeriodRange?.start,
    contractDateValue(
      contractDocument,
      ["서비스 시작일", "서비스시작일", "계약 시작일", "계약시작일", "startDate", "contractStartDate"],
      {
        year: ["계약 시작 년도", "계약시작년도", "계약 시작 연도", "계약시작연도", "시작 연도", "시작년도", "startYear"],
        month: ["계약 시작 월", "계약시작월", "시작 월", "시작월", "startMonth"],
        day: ["계약 시작 일", "계약시작일", "시작 일", "시작일", "startDay"],
      },
    ),
  );
  const serviceEndDate = firstValue(
    client.endDate,
    servicePeriodRange?.end,
    contractDateValue(
      contractDocument,
      ["서비스 종료일", "서비스종료일", "계약 종료일", "계약종료일", "endDate", "contractEndDate"],
      {
        year: ["계약 종료 년도", "계약종료년도", "계약 종료 연도", "계약종료연도", "종료 연도", "종료년도", "endYear"],
        month: ["계약 종료 월", "계약종료월", "종료 월", "종료월", "endMonth"],
        day: ["계약 종료 일", "계약종료일", "종료 일", "종료일", "endDay"],
      },
    ),
  );
  const contractSignDate = contractDateValue(
    contractDocument,
    [
      "계약 서명 날짜",
      "계약서명날짜",
      "계약 서명일",
      "계약서명일",
      "계약 날짜",
      "계약날짜",
      "계약 일자",
      "계약일자",
      "계약일",
      "게약 날짜",
      "게약날짜",
      "게약 일자",
      "게약일자",
      "게약일",
      "계약서 날짜",
      "계약서날짜",
      "계약서 일자",
      "계약서일자",
      "계약서 일",
      "계약서일",
      "contractSignDate",
      "signatureDate",
    ],
    {
      year: [
        "계약 서명 년도",
        "계약서명년도",
        "계약 서명 연도",
        "계약서명연도",
        "계약 서명 년",
        "계약서명년",
        "계약 년도",
        "계약년도",
        "계약 연도",
        "계약연도",
        "계약 년",
        "계약년",
        "게약 년도",
        "게약년도",
        "게약 연도",
        "게약연도",
        "게약 년",
        "게약년",
        "계약서 년도",
        "계약서년도",
        "계약서 연도",
        "계약서연도",
        "계약서 년",
        "계약서년",
        "서명 년도",
        "서명년도",
        "서명 연도",
        "서명연도",
        "서명 년",
        "서명년",
        "contractSignYear",
        "signatureYear",
      ],
      month: [
        "계약 서명 월",
        "계약서명월",
        "계약 월",
        "계약월",
        "게약 월",
        "게약월",
        "계약서 월",
        "계약서월",
        "서명 월",
        "서명월",
        "contractSignMonth",
        "signatureMonth",
      ],
      day: [
        "계약 서명 일",
        "계약서명일",
        "계약 일",
        "계약일",
        "게약 일",
        "게약일",
        "계약서 일",
        "계약서일",
        "서명 일",
        "서명일",
        "contractSignDay",
        "signatureDay",
      ],
    },
  );
  const isContractCompleted = client.documentStatus === "completed";
  const contractDocCompletedDate = firstValue(
    isoDateFromTimestamp(contractDocument?.updated_date),
    contractSignDate,
    serviceStartDate,
  );
  const contractDocSentDate = firstValue(
    isoDateFromTimestamp(contractDocument?.created_date),
    serviceStartDate,
  );
  const contractDocMetaDateLabel = isContractCompleted ? "완료 날짜" : "발송 날짜";
  const contractDocMetaDate = isContractCompleted ? contractDocCompletedDate : contractDocSentDate;
  const fullPrice = firstValue(
    client.fullPrice,
    numericText(documentFieldValue(contractDocument, [
      "총 서비스 금액",
      "총서비스금액",
      "서비스 비용",
      "서비스비용",
      "서비스 가격",
      "서비스가격",
      "서비스 총액",
      "서비스총액",
      "총액",
      "fullPrice",
    ])),
  );
  const grant = firstValue(
    client.grant,
    numericText(documentFieldValue(contractDocument, ["정부지원금", "지원금", "grant"])),
  );
  const actualPrice = firstValue(
    client.actualPrice,
    numericText(documentFieldValue(contractDocument, ["본인부담금", "실결제금액", "actualPrice"])),
  );
  const servicePeriodLabel = serviceDuration ? `${serviceDuration}일` : "-";

  return (
    <MobileDetailPage
      data-component={dataComponent}
      data-source-component="ClientDetailContent"
      name="clients"
    >
      <MobileDetailHeader data-component={`${dataComponent}_header`}
        name="clients"
        avatar={<User size={22} strokeWidth={2} />}
        avatarTone={detailAvatarTone}
        title={client.name}
        badges={clientBadges.map((badge) => ({ label: badge.label, tone: badge.tone }))}
        menu={
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="flex h-[44px] w-[44px] flex-shrink-0 items-center justify-center rounded-xl text-v3-text-muted transition-colors hover:bg-v3-dim-white"
                aria-label="고객 옵션"
                data-component="mobile-clients-detail-menu-trigger"
              >
                <MoreVertical size={20} strokeWidth={2} />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              sideOffset={4}
              className="z-[200] w-max min-w-[5.5rem] rounded-md p-0"
              data-component="mobile-clients-detail-menu"
            >
              <DropdownMenuItem
                onClick={() => onEdit(client)}
                className="min-h-[44px] gap-2 rounded-md px-3 py-2 text-[0.82rem] leading-none"
                data-component="mobile-clients-detail-menu-edit"
              >
                <SquarePen className="size-[15px]" strokeWidth={2} />
                수정
              </DropdownMenuItem>
              <DropdownMenuItem
                disabled={isPreparingScheduleChange}
                onClick={() => void handleOpenServiceScheduleChange()}
                className="min-h-[44px] gap-2 rounded-md px-3 py-2 text-[0.82rem] leading-none"
                data-component="mobile-clients-detail-menu-change-service-schedule"
              >
                <CalendarDays className="size-[15px]" strokeWidth={2} />
                서비스 일정 변경
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => setResetLinkModalOpen(true)}
                className="min-h-[44px] gap-2 rounded-md px-3 py-2 text-[0.82rem] leading-none"
                data-component="mobile-clients-detail-menu-reset-service-record-link"
              >
                <RotateCcw className="size-[15px]" strokeWidth={2} />
                제공기록지 링크 재설정
              </DropdownMenuItem>
              <DropdownMenuItem
                variant="destructive"
                onClick={() => onDelete(client.id)}
                className="min-h-[44px] gap-2 rounded-md px-3 py-2 text-[0.82rem] leading-none"
                data-component="mobile-clients-detail-menu-delete"
              >
                <Trash2 className="size-[15px]" strokeWidth={2} />
                삭제
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        }
      />

      <MobileDetailActions data-component={`${dataComponent}_actions`}
        name="clients"
        actions={[
          {
            label: "메시지",
            variant: "secondary",
            onClick: onMessage,
            dataComponent: "mobile-clients-message",
          },
          {
            label: isIssuingContract ? "발급 중..." : "계약서 발급",
            variant: "primary",
            onClick: () => onIssueContract(client),
            disabled: isIssuingContract,
            busy: isIssuingContract,
            dataComponent: "mobile-clients-contract-create",
          },
        ]}
      />

      <ApprovalTwoButtonModal
        open={resetLinkModalOpen}
        onOpenChange={(open) => {
          if (!open && !isResettingLink) {
            setResetLinkModalOpen(open);
          }
        }}
                dataComponent="clients-detail-reset-service-record-link-approval"
                title="제공기록지 링크를 재설정하시겠습니까?"
                description="기존 링크는 만료되고 새 링크가 생성됩니다. 메시지는 발송되지 않습니다."
                isDescriptionVisuallyHidden={false}
                approvalLabel="링크 재설정"
        pendingLabel="재설정 중..."
        isPending={isResettingLink}
        onApprove={() => void handleResetServiceRecordLink()}
      />

      <ServiceRecordLinkResetResultModal
        open={resetServiceRecordUrl !== null}
        serviceRecordUrl={resetServiceRecordUrl ?? ""}
        onClose={() => setResetServiceRecordUrl(null)}
        onCopy={(serviceRecordUrl) => void handleCopyResetServiceRecordLink(serviceRecordUrl)}
      />

      {scheduleChangeTarget ? (
        <ServiceScheduleChangeModal
          open
          sessionIndex={scheduleChangeTarget.sessionIndex}
          currentDate={scheduleChangeTarget.currentDate}
          minimumDate={scheduleChangeTarget.minimumDate}
          selectedDate={selectedScheduleChangeDate}
          isPending={isApplyingScheduleChange}
          onDateChange={setSelectedScheduleChangeDate}
          onClose={() => {
            setScheduleChangeTarget(null);
            setSelectedScheduleChangeDate("");
          }}
          onSubmit={() => void handleApplyServiceScheduleChange()}
        />
      ) : null}

      <DetailTabPills
        tabs={[
          ...(client.pendingScheduleChange ? [{ id: "scheduleChange", label: "일정 변경" }] : []),
          { id: "basic", label: "기본 정보" },
          { id: "contracts", label: "계약서 정보" },
          { id: "message", label: "알림 발송" },
          { id: "serviceRecords", label: "제공기록지" },
        ]}
        activeTab={activeTab}
        onTabChange={(id) => onTabChange(id as DetailTabId)}
      />

      {client.pendingScheduleChange ? (
        <MobileDetailTabPanel data-component={`${dataComponent}_tab-panel_schedule-change`} name="clients" tabId="scheduleChange" activeTab={activeTab}>
          <InfoCard data-component={`${dataComponent}_tab-panel_schedule-change_info-card`} title="서비스 일정 변경 요청이 있습니다.">
            <InfoRow
              label="기존 날짜"
              value={formatScheduleChangeMonthDay(client.pendingScheduleChange.fromDate)}
            />
            <InfoRow
              label="변경 날짜"
              value={formatScheduleChangeMonthDay(client.pendingScheduleChange.toDate)}
            />
            <InfoRow label="회차" value={`${client.pendingScheduleChange.sessionIndex}회차`} />
            <InfoRow
              label="종료일"
              value={`${client.pendingScheduleChange.oldEndDate} → ${client.pendingScheduleChange.newEndDate}`}
            />
            <div className="detail-actions card-actions mt-3">
              <button
                type="button"
                className="btn btn-secondary"
                disabled={isScheduleChangeDecisionPending}
                onClick={() => void handleScheduleChangeDecision("reject")}
                data-component="mobile-clients-schedule-change-reject"
              >
                거부
              </button>
              <button
                type="button"
                className="btn btn-primary"
                disabled={isScheduleChangeDecisionPending}
                onClick={() => void handleScheduleChangeDecision("approve")}
                data-component="mobile-clients-schedule-change-approve"
              >
                승인
              </button>
            </div>
          </InfoCard>
        </MobileDetailTabPanel>
      ) : null}

      <MobileDetailTabPanel data-component={`${dataComponent}_tab-panel_basic`} name="clients" tabId="basic" activeTab={activeTab}>
        <InfoCard data-component={`${dataComponent}_tab-panel_basic_client-card`} title="고객 정보">
          <InfoRow label="이름" value={client.name} />
          <InfoRow label="생년월일" value={formatDate(birthDate)} />
          <InfoRow label="출산 예정일" value={formatDate(dueDate)} />
          <InfoRow label="연락처" value={phone ? formatKoreanPhoneNumber(phone) : "-"} />
          <InfoRow label="주소" value={address ?? "-"} />
        </InfoCard>
        <InfoCard data-component={`${dataComponent}_tab-panel_basic_employee-card`} title="담당 관리사" delay={60}>
          <InfoRow label="주 담당 인력" value={primaryEmployeeName ?? "-"} />
          <InfoRow
            label="주 담당 인력 연락처"
            value={primaryEmployeePhone ? formatKoreanPhoneNumber(primaryEmployeePhone) : "-"}
          />
          <InfoRow label="보조 담당 인력" value={secondaryEmployeeName ?? "-"} />
          <InfoRow
            label="보조 담당 인력 연락처"
            value={secondaryEmployeePhone ? formatKoreanPhoneNumber(secondaryEmployeePhone) : "-"}
          />
        </InfoCard>
        <InfoCard data-component={`${dataComponent}_tab-panel_basic_service-card`} title="서비스 정보" delay={120}>
          <InfoRow label="바우처 유형" value={serviceType ?? "-"} />
          <InfoRow label="서비스 기간" value={servicePeriodLabel} />
          <InfoRow label="시작일" value={formatDate(serviceStartDate)} />
          <InfoRow label="종료일" value={formatDate(serviceEndDate)} />
          <InfoRow label="총 서비스 금액" value={formatPrice(fullPrice)} />
          <InfoRow label="정부지원금" value={formatPrice(grant)} />
          <InfoRow label="본인부담금" value={formatPrice(actualPrice)} />
        </InfoCard>
      </MobileDetailTabPanel>

      <MobileDetailTabPanel data-component={`${dataComponent}_tab-panel_contracts`} name="clients" tabId="contracts" activeTab={activeTab}>
        {hasContractDocument ? (
          <>
            <InfoCard data-component={`${dataComponent}_tab-panel_contracts_contract-card`} title="계약서">
              <DetailDocRow
                icon={<FileCheck2 size={16} strokeWidth={2.5} />}
                title="서비스 계약서"
                meta={
                  <>
                    <span className="doc-meta-line">{contractDocMetaDateLabel} {formatDate(contractDocMetaDate)}</span>
                    <span className="doc-meta-line doc-meta-id">문서 ID {client.eDocId}</span>
                  </>
                }
                badge={documentStatusLabel(client.documentStatus)}
                tone={docTone}
              />
            </InfoCard>
            <InfoCard data-component={`${dataComponent}_tab-panel_contracts_activity-card`} title="최근 진행 상황" delay={60}>
              <InfoRow label="현재 단계" value={documentStatusLabel(client.documentStatus)} tone={docTone as never} />
              <InfoRow label="서명 대기자" value={client.hasSigned ? "-" : `고객 (${client.name})`} />
              <InfoRow label="발송일" value={formatDate(serviceStartDate)} />
              {isContractCompleted && <InfoRow label="완료일" value={formatDate(contractDocCompletedDate)} />}
            </InfoCard>
          </>
        ) : (
          <InfoCard data-component={`${dataComponent}_tab-panel_contracts_contract-card`} title="계약서">
            <div className="detail-empty-state" data-component="mobile-clients-contracts-empty">
              계약서 정보가 없습니다.
            </div>
          </InfoCard>
        )}
      </MobileDetailTabPanel>

      <MobileDetailTabPanel data-component={`${dataComponent}_tab-panel_message`} name="clients" tabId="message" activeTab={activeTab}>
        {selectedLog ? (
          <ClientMessageHistoryDetail
            view={{
              title: notificationTitle(selectedLog),
              templateLabel: notificationTitle(selectedLog),
              channelLabel: notificationChannelLabel(selectedLog),
              statusLabel: notificationStatusLabel(selectedLog.status),
              statusTone: notificationStatusTone(selectedLog.status),
              sentAtLabel: formatNotificationTime(selectedLog.createdAt),
              recipientName: selectedLog.recipientName?.trim() || client.name,
              recipientPhone: selectedLog.recipientPhone?.trim() || selectedLog.receiver?.trim() || "-",
              messageBody: selectedLog.messageBody?.trim()
                ? selectedLog.messageBody
                : "내용이 없습니다.",
              failureReason: formatMessageFailureReason(selectedLog.errorMessage) || null,
            }}
            onBack={() => setSelectedEntry(null)}
          />
        ) : (
          <InfoCard data-component={`${dataComponent}_tab-panel_message_history-card`} title="발송 내역">
            {isNotificationLogsLoading ? (
              <div className="detail-empty-state" data-component="mobile-clients-message-loading">
                발송 내역을 불러오는 중입니다.
              </div>
            ) : isNotificationLogsError ? (
              <div className="detail-empty-state" data-component="mobile-clients-message-error">
                <p>발송 내역을 불러오지 못했습니다.</p>
                {onRetryNotificationLogs ? (
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={onRetryNotificationLogs}
                    data-component="mobile-clients-message-retry"
                  >
                    다시 시도
                  </button>
                ) : null}
              </div>
            ) : displayNotificationLogs.length > 0 ? (
              displayNotificationLogs.map((log) => {
                const tone = notificationStatusTone(log.status);
                const channel = notificationChannelLabel(log);
                return (
                  <DetailDocRow
                    key={`${channel}-${log.id}`}
                    icon={
                      tone === "burgundy" ? (
                        <CircleAlert size={16} strokeWidth={2.5} />
                      ) : (
                        <MessageCircle size={16} strokeWidth={2.5} />
                      )
                    }
                    title={`${channel} · ${notificationTitle(log)}`}
                    meta={formatNotificationTime(log.createdAt)}
                    badge={notificationStatusLabel(log.status)}
                    tone={tone}
                    onClick={() => setSelectedEntry({ key: detailKey, log })}
                  />
                );
              })
            ) : (
              <div className="detail-empty-state" data-component="mobile-clients-message-empty">
                발송 내역이 없습니다.
              </div>
            )}
          </InfoCard>
        )}
      </MobileDetailTabPanel>

      <MobileDetailTabPanel
        name="clients"
        tabId="serviceRecords"
        activeTab={activeTab}
        data-component={`${dataComponent}_tab-panel_service-records`}
      >
        <ClientServiceRecords
          data-component={`${dataComponent}_tab-panel_service-records_content`}
          client={client}
          activeTab={activeTab}
          overview={serviceRecordsQuery.data}
          isLoading={serviceRecordsQuery.isLoading}
          isError={serviceRecordsQuery.isError}
          isRefreshing={serviceRecordsQuery.isFetching && !serviceRecordsQuery.isLoading}
          onRefresh={() => void serviceRecordsQuery.refetch()}
        />
      </MobileDetailTabPanel>
    </MobileDetailPage>
  );
}
