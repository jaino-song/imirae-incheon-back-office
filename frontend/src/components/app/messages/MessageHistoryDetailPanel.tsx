"use client";

import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import {
  AlertCircle,
  CalendarClock,
  CalendarRange,
  CheckCircle2,
  Clock3,
  History,
  MessageCircle,
  RotateCcw,
  UserPlus,
  Users,
} from "lucide-react";
import {
  MESSAGE_HISTORY_STATUS_LABELS,
  formatMessageDateTimeCompact,
  formatMessageFailureReason,
  getMessageHistoryTimestamp as getSharedMessageHistoryTimestamp,
  getMessageTemplateLabel,
  normalizeMessageHistoryPresentation,
} from "@babyjamjam/shared";

import type {
  MessageLogRecord as ApiMessageLogRecord,
  TriggerEventType,
} from "@/features/message-triggers/types";
import { StatusBadge } from "@/components/app/ui/status-badge";
import { DetailPanel, InfoCard, InfoRow, ListEmptyState } from "@/components/app/v3";
import { Button } from "@/components/ui/button";
import { matchesSearchQuery } from "@/lib/search/korean-search";
import { cn } from "@/lib/utils";

export type MessageHistoryStatus = "sent" | "failed" | "pending" | "canceled";
export type MessageHistoryFilter = "all" | MessageHistoryStatus;

export interface MessageHistoryRecord {
  id: number | string;
  title: string;
  templateLabel: string;
  recipientName: string;
  recipientPhone: string;
  recipientListLabel: string;
  channelLabel: string;
  sentAt: string;
  status: MessageHistoryStatus;
  messagePreview: string;
  failureReason?: string;
  icon: LucideIcon;
}

interface NormalizeMessageHistoryRecordOptions {
  recipientNameFallback?: string | null;
  recipientListLabelFallback?: string | null;
}

interface MessageHistoryDetailPanelProps {
  selectedRecord: MessageHistoryRecord | null;
  canRetry?: boolean;
  isRetrying?: boolean;
  onRetry?: () => void;
  backAction?: {
    label: ReactNode;
    onClick: () => void;
  };
  emptyMessage?: string;
  emptyIcon?: LucideIcon;
  dataComponentPrefix?: string;
}

export const MESSAGE_HISTORY_STATUS_META: Record<
  MessageHistoryStatus,
  { label: string; icon: LucideIcon; tone: string; avatarClass: string }
> = {
  sent: {
    label: MESSAGE_HISTORY_STATUS_LABELS.sent,
    icon: CheckCircle2,
    tone: "bg-emerald-50 text-emerald-600",
    avatarClass: "border border-[hsl(137,34%,84%)] bg-[hsl(137,60%,94%)] text-v3-green",
  },
  failed: {
    label: MESSAGE_HISTORY_STATUS_LABELS.failed,
    icon: AlertCircle,
    tone: "bg-red-50 text-red-600",
    avatarClass: "border border-[hsla(355,36%,45%,0.20)] bg-[hsl(355,40%,94%)] text-[hsl(355,36%,45%)]",
  },
  pending: {
    label: MESSAGE_HISTORY_STATUS_LABELS.pending,
    icon: Clock3,
    tone: "bg-amber-50 text-amber-600",
    avatarClass: "border border-[hsla(38,92%,35%,0.18)] bg-[hsl(47,100%,92%)] text-[hsl(38,92%,35%)]",
  },
  canceled: {
    label: MESSAGE_HISTORY_STATUS_LABELS.canceled,
    icon: AlertCircle,
    tone: "bg-slate-100 text-slate-600",
    avatarClass: "border border-slate-200 bg-slate-100 text-slate-600",
  },
};

export const MESSAGE_HISTORY_FILTER_META: Record<
  MessageHistoryFilter,
  {
    label: string;
    icon: LucideIcon;
    badgeTone: string;
    activeClassName: string;
    indicatorClassName: string;
  }
> = {
  all: {
    label: "전체",
    icon: History,
    badgeTone: "bg-v3-primary-light text-v3-primary",
    activeClassName: "text-v3-primary",
    indicatorClassName: "bg-v3-primary",
  },
  sent: {
    label: MESSAGE_HISTORY_STATUS_LABELS.sent,
    icon: CheckCircle2,
    badgeTone: "bg-emerald-50 text-emerald-600",
    activeClassName: "text-emerald-600",
    indicatorClassName: "bg-emerald-500",
  },
  pending: {
    label: MESSAGE_HISTORY_STATUS_LABELS.pending,
    icon: Clock3,
    badgeTone: "bg-amber-50 text-amber-600",
    activeClassName: "text-amber-600",
    indicatorClassName: "bg-amber-500",
  },
  failed: {
    label: MESSAGE_HISTORY_STATUS_LABELS.failed,
    icon: AlertCircle,
    badgeTone: "bg-red-50 text-red-600",
    activeClassName: "text-red-600",
    indicatorClassName: "bg-red-500",
  },
  canceled: {
    label: MESSAGE_HISTORY_STATUS_LABELS.canceled,
    icon: AlertCircle,
    badgeTone: "bg-slate-100 text-slate-600",
    activeClassName: "text-slate-600",
    indicatorClassName: "bg-slate-500",
  },
};

export const MESSAGE_HISTORY_TABS: {
  value: MessageHistoryFilter;
  label: string;
  activeClassName: string;
  indicatorClassName: string;
}[] = (
  ["all", "sent", "pending", "failed", "canceled"] as const
).map((value) => {
  const meta = MESSAGE_HISTORY_FILTER_META[value];

  return {
    value,
    label: meta.label,
    activeClassName: meta.activeClassName,
    indicatorClassName: meta.indicatorClassName,
  };
});

const HISTORY_EVENT_ICON_BY_TYPE: Record<TriggerEventType, LucideIcon> = {
  CLIENT_CREATED: UserPlus,
  SERVICE_START: CalendarClock,
  SERVICE_END: CalendarRange,
  EMPLOYEE_ASSIGNED: Users,
};

export function getMessageHistoryEmptyStateCopy(filter: MessageHistoryFilter, hasSearchQuery: boolean) {
  const copyByFilter: Record<MessageHistoryFilter, { title: string; description: string }> = {
    all: {
      title: "발송 기록이 없습니다.",
      description: hasSearchQuery
        ? "검색어를 바꾸거나 필터를 초기화해 주세요."
        : "아직 확인할 발송 기록이 없습니다.",
    },
    sent: {
      title: "성공 발송 기록이 없습니다.",
      description: hasSearchQuery
        ? "검색어를 바꾸거나 다른 탭을 선택해 주세요."
        : "정상 발송된 메시지가 아직 없습니다.",
    },
    pending: {
      title: "재시도 대기 기록이 없습니다.",
      description: hasSearchQuery
        ? "검색어를 바꾸거나 다른 탭을 선택해 주세요."
        : "실패 후 재시도 대기 중인 메시지가 없습니다.",
    },
    failed: {
      title: "실패 발송 기록이 없습니다.",
      description: hasSearchQuery
        ? "검색어를 바꾸거나 다른 탭을 선택해 주세요."
        : "발송 실패로 남아 있는 메시지가 없습니다.",
    },
    canceled: {
      title: "취소된 발송 기록이 없습니다.",
      description: hasSearchQuery
        ? "검색어를 바꾸거나 다른 탭을 선택해 주세요."
        : "취소된 메시지가 아직 없습니다.",
    },
  };

  return copyByFilter[filter];
}

export const getMessageHistoryTemplateLabel = getMessageTemplateLabel;
export const getMessageHistoryTimestamp = getSharedMessageHistoryTimestamp;
export const formatMessageHistoryDate = formatMessageDateTimeCompact;
export const formatMessageHistoryFailureReason = formatMessageFailureReason;

export function normalizeMessageHistoryRecord(
  record: ApiMessageLogRecord,
  options: NormalizeMessageHistoryRecordOptions = {}
): MessageHistoryRecord {
  const normalized = normalizeMessageHistoryPresentation(record, options);

  return {
    ...normalized,
    icon: record.eventType ? HISTORY_EVENT_ICON_BY_TYPE[record.eventType] : MessageCircle,
  };
}

export function matchesMessageHistoryQuery(record: MessageHistoryRecord, query: string) {
  return matchesSearchQuery(query, [
    record.title,
    record.recipientName,
    record.recipientPhone,
    record.templateLabel,
    record.channelLabel,
    record.messagePreview,
    record.failureReason ?? "",
    MESSAGE_HISTORY_STATUS_META[record.status].label,
  ]);
}

export function MessageHistoryDetailPanel({
  selectedRecord,
  canRetry = false,
  isRetrying = false,
  onRetry,
  backAction,
  emptyMessage = "발송 기록을 선택하면 상세 정보가 표시됩니다.",
  emptyIcon = Users,
  dataComponentPrefix = "messages-history",
}: MessageHistoryDetailPanelProps) {
  const showRetry = !!selectedRecord && canRetry && !!onRetry;
  const displayFailureReason = formatMessageHistoryFailureReason(selectedRecord?.failureReason);

  return (
    <DetailPanel data-component="desktop_messages_split-layout_detail-panel"
      backAction={backAction}
      overlay={
        !selectedRecord ? (
          <ListEmptyState
            name={`${dataComponentPrefix}-detail-empty`}
            icon={emptyIcon}
            message={emptyMessage}
            className="flex-none min-h-0"
          />
        ) : null
      }
      avatar={
        <div
          data-component={`${dataComponentPrefix}-detail-avatar`}
          className={cn(
            "flex h-12 w-12 shrink-0 items-center justify-center rounded-[16px]",
            selectedRecord ? MESSAGE_HISTORY_STATUS_META[selectedRecord.status].avatarClass : "bg-v3-primary-light text-v3-primary"
          )}
        >
          <History className="h-5 w-5" />
        </div>
      }
      title={selectedRecord?.title ?? "발송 상세"}
      subtitle={
        selectedRecord
          ? `${selectedRecord.channelLabel} · ${formatMessageHistoryDate(selectedRecord.sentAt)}`
          : "왼쪽 목록에서 발송 기록을 선택해 주세요."
      }
      badges={
        selectedRecord?.status === "sent" ? (
          <StatusBadge
            data-component={`${dataComponentPrefix}-detail-status`}
            variant="success"
            size="sm"
          >
            {MESSAGE_HISTORY_STATUS_META[selectedRecord.status].label}
          </StatusBadge>
        ) : selectedRecord ? (
          <span
            data-component={`${dataComponentPrefix}-detail-status`}
            className={cn(
              "inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[0.68rem] font-semibold",
              MESSAGE_HISTORY_STATUS_META[selectedRecord.status].tone
            )}
          >
            {(() => {
              const StatusIcon = MESSAGE_HISTORY_STATUS_META[selectedRecord.status].icon;
              return <StatusIcon className="h-3.5 w-3.5" />;
            })()}
            {MESSAGE_HISTORY_STATUS_META[selectedRecord.status].label}
          </span>
        ) : null
      }
      trailing={
        showRetry ? (
          <Button
            data-component={`${dataComponentPrefix}-detail-retry`}
            type="button"
            size="sm"
            variant="outline"
            onClick={onRetry}
            disabled={isRetrying}
            className="rounded-full"
          >
            <RotateCcw className={cn("h-3.5 w-3.5", isRetrying && "animate-spin")} />
            {isRetrying ? "재시도 중" : "재발송"}
          </Button>
        ) : null
      }
    >
      {!selectedRecord ? null : (
        <div data-component={`${dataComponentPrefix}-detail-content`} className="space-y-4">
          <InfoCard title="발송 정보" data-component={`${dataComponentPrefix}-detail-info-card`}>
            <InfoRow
              data-component={`${dataComponentPrefix}-detail-info-recipient`}
              label="수신자"
              value={selectedRecord.recipientName}
            />
            <InfoRow
              data-component={`${dataComponentPrefix}-detail-info-phone`}
              label="연락처"
              value={selectedRecord.recipientPhone}
            />
            <InfoRow
              data-component={`${dataComponentPrefix}-detail-info-template`}
              label="템플릿"
              value={selectedRecord.templateLabel}
            />
            <InfoRow
              data-component={`${dataComponentPrefix}-detail-info-channel`}
              label="채널"
              value={selectedRecord.channelLabel}
            />
            {displayFailureReason ? (
              <InfoRow
                data-component={`${dataComponentPrefix}-detail-info-error`}
                label="실패 사유"
                value={<span className="text-red-700">{displayFailureReason}</span>}
              />
            ) : null}
          </InfoCard>

          <div
            data-component={`${dataComponentPrefix}-detail-preview-card`}
            className="rounded-[18px] bg-v3-dim-white p-4"
          >
            <p className="text-[0.75rem] font-semibold text-v3-text-muted">메시지 내용</p>
            <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-v3-dark">{selectedRecord.messagePreview}</p>
          </div>
        </div>
      )}
    </DetailPanel>
  );
}
