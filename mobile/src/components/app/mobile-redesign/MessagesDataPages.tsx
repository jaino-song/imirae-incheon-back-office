"use client";

import { useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  Clock3,
  History,
  Loader2,
  MessageSquareText,
  XCircle,
  type LucideIcon,
} from "lucide-react";
import {
  MESSAGE_HISTORY_STATUS_LABELS,
  MESSAGE_JOB_STATUS_LABELS,
  formatMessageDateTimeCompact,
  getMessageTemplateLabel,
  isSmsHistoryRecord,
  isSmsTriggerTemplate,
  normalizeMessageHistoryPresentation,
  type MessageSectionId,
} from "@babyjamjam/shared";

import {
  useMessageHistory,
  useUpcomingMessageTriggerJobs,
} from "@/features/message-triggers/hooks/use-message-triggers";
import type {
  MessageLogRecord,
  MessageLogStatus,
  MessageTriggerJobStatus,
  UpcomingMessageTriggerJob,
} from "@/features/message-triggers/types";
import {
  ClientMessageHistoryDetail,
  type MessageHistoryDetailTone,
} from "@/components/app/clients/client-message-history-detail";
import {
  MobileDetailPage,
  MobileDetailSheet,
} from "@/components/app/mobile-redesign/detail-sheet";
import { MessageSectionNav } from "@/components/app/mobile-redesign/MessageSectionNav";
import { ListCard } from "@/components/app/mobile-redesign/primitives";
import "@/components/app/mobile-redesign/redesign.css";

interface StatusMeta {
  label: string;
  tone: string;
  icon: LucideIcon;
}

const JOB_STATUS: Record<MessageTriggerJobStatus, StatusMeta> = {
  pending: { label: MESSAGE_JOB_STATUS_LABELS.pending, tone: "pending", icon: Clock3 },
  processing: { label: MESSAGE_JOB_STATUS_LABELS.processing, tone: "processing", icon: Loader2 },
  sent: { label: MESSAGE_JOB_STATUS_LABELS.sent, tone: "sent", icon: CheckCircle2 },
  failed: { label: MESSAGE_JOB_STATUS_LABELS.failed, tone: "failed", icon: XCircle },
  canceled: { label: MESSAGE_JOB_STATUS_LABELS.canceled, tone: "canceled", icon: AlertCircle },
};

const HISTORY_STATUS: Record<MessageLogStatus, StatusMeta> = {
  pending: { label: MESSAGE_HISTORY_STATUS_LABELS.pending, tone: "pending", icon: Clock3 },
  sent: { label: MESSAGE_HISTORY_STATUS_LABELS.sent, tone: "sent", icon: CheckCircle2 },
  failed: { label: MESSAGE_HISTORY_STATUS_LABELS.failed, tone: "failed", icon: XCircle },
  canceled: { label: MESSAGE_HISTORY_STATUS_LABELS.canceled, tone: "canceled", icon: AlertCircle },
};

const HISTORY_DETAIL_TONE: Record<MessageLogStatus, MessageHistoryDetailTone> = {
  pending: "orange",
  sent: "green",
  failed: "burgundy",
  canceled: "muted",
};

function MessagePageShell({
  title,
  count,
  activeSection,
  children,
  dataComponent = "messages",
}: {
  title: string;
  count: React.ReactNode;
  activeSection: MessageSectionId;
  children: React.ReactNode;
  dataComponent?: string;
}) {
  return (
    <section data-component={dataComponent} className="messages-page message-page-shell">
      <div
        className="shell-content flex-col gap-[calc(8px*var(--glint-ui-scale,1))]"
        data-component="messages-content"
      >
        <MessageSectionNav activeId={activeSection} />
        <ListCard title={title} count={count} filters={[]}>
          {children}
        </ListCard>
      </div>
    </section>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="message-data-empty">
      <MessageSquareText size={26} aria-hidden="true" />
      <p>{message}</p>
    </div>
  );
}

function LoadingState() {
  return (
    <div className="message-data-empty" aria-label="메시지 내역 불러오는 중">
      <Loader2 className="message-data-spinner" size={25} aria-hidden="true" />
      <p>내역을 불러오고 있습니다.</p>
    </div>
  );
}

function ScheduledRow({ job }: { job: UpcomingMessageTriggerJob }) {
  const meta = JOB_STATUS[job.status];
  const StatusIcon = meta.icon;
  const recipientName = job.payload.recipientName || job.payload.clientName || job.payload.employeeName || "수신자";

  return (
    <article className="message-data-row" data-component="mobile-messages-scheduled-item">
      <span className="message-navigation-icon message-navigation-icon-orange">
        <Clock3 size={18} aria-hidden="true" />
      </span>
      <div className="message-data-row-copy message-data-row-copy-split">
        <div className="message-data-row-info">
          <strong className="message-data-row-title">{recipientName}</strong>
          <p className="message-data-row-subtitle">{getMessageTemplateLabel(job.templateKey)}</p>
        </div>
        <div className="message-data-status-group">
          <span className={`message-data-status message-data-status-${meta.tone}`}>
            <StatusIcon
              size={12}
              className={job.status === "processing" ? "message-data-spinner" : undefined}
              aria-hidden="true"
            />
            {meta.label}
          </span>
          <time className="message-data-schedule-time">{formatMessageDateTimeCompact(job.scheduledFor)}</time>
        </div>
      </div>
    </article>
  );
}

function HistoryRow({
  record,
  onSelect,
}: {
  record: MessageLogRecord;
  onSelect: (record: MessageLogRecord) => void;
}) {
  const normalized = normalizeMessageHistoryPresentation(record);
  const meta = HISTORY_STATUS[normalized.status];
  const StatusIcon = meta.icon;

  return (
    <button
      type="button"
      className="message-data-row message-data-row-button"
      data-component="mobile-messages-history-item"
      onClick={() => onSelect(record)}
    >
      <span className="message-navigation-icon message-navigation-icon-green">
        <History size={18} aria-hidden="true" />
      </span>
        <div className="message-data-row-copy">
        <div className="message-data-row-info">
          <strong className="message-data-row-title">{normalized.templateLabel}</strong>
          <p className="message-data-row-subtitle">{normalized.recipientName}</p>
          <small className="message-data-row-subtitle">{formatMessageDateTimeCompact(normalized.sentAt)}</small>
        </div>
        <span className={`message-data-status message-data-status-${meta.tone}`}>
          <StatusIcon size={12} aria-hidden="true" />
          {meta.label}
        </span>
        {normalized.failureReason ? <em>{normalized.failureReason}</em> : null}
      </div>
    </button>
  );
}

export function MessagesScheduledPage() {
  const { data = [], isLoading, isError } = useUpcomingMessageTriggerJobs();
  const jobs = data
    .filter((job) => isSmsTriggerTemplate(job.templateKey))
    .sort(
      (left, right) => new Date(left.scheduledFor).getTime() - new Date(right.scheduledFor).getTime(),
    );

  return (
    <MessagePageShell
      title="발송 예정"
      count={`${jobs.length}건`}
      activeSection="scheduled"
    >
      {isLoading ? (
        <LoadingState />
      ) : isError ? (
        <EmptyState message="발송 예정 내역을 불러오지 못했습니다." />
      ) : jobs.length === 0 ? (
        <EmptyState message="발송 예정 항목이 없습니다." />
      ) : (
        jobs.map((job) => <ScheduledRow key={job.id} job={job} />)
      )}
    </MessagePageShell>
  );
}

export function MessagesHistoryPage() {
  const [selectedRecord, setSelectedRecord] = useState<MessageLogRecord | null>(null);
  const { data = [], isLoading, isError } = useMessageHistory();
  const records = data
    .filter(isSmsHistoryRecord)
    .sort(
      (left, right) =>
        new Date(right.lastAttemptAt || right.createdAt).getTime()
        - new Date(left.lastAttemptAt || left.createdAt).getTime(),
    );

  const normalizedSelectedRecord = selectedRecord
    ? normalizeMessageHistoryPresentation(selectedRecord)
    : null;

  return (
    <MobileDetailSheet data-component="mobile_mobile-redesign_detail-sheet"
      name="messages"
      isOpen={normalizedSelectedRecord !== null}
      onClose={() => setSelectedRecord(null)}
      list={
        <MessagePageShell
          title="발송 기록"
          count={`${records.length}건`}
          activeSection="history"
          dataComponent="mobile-messages-history-list-content"
        >
          {isLoading ? (
            <LoadingState />
          ) : isError ? (
            <EmptyState message="발송 기록을 불러오지 못했습니다." />
          ) : records.length === 0 ? (
            <EmptyState message="발송 기록이 없습니다." />
          ) : (
            records.map((record) => (
              <HistoryRow key={record.id} record={record} onSelect={setSelectedRecord} />
            ))
          )}
        </MessagePageShell>
      }
      detail={
        normalizedSelectedRecord ? (
          <MobileDetailPage
            name="messages"
            data-component="mobile-messages-history-detail-content"
          >
            <ClientMessageHistoryDetail
              dataComponentPrefix="mobile-messages-history"
              showBackAction={false}
              view={{
                title: normalizedSelectedRecord.title,
                templateLabel: normalizedSelectedRecord.templateLabel,
                channelLabel: normalizedSelectedRecord.channelLabel,
                statusLabel: HISTORY_STATUS[normalizedSelectedRecord.status].label,
                statusTone: HISTORY_DETAIL_TONE[normalizedSelectedRecord.status],
                sentAtLabel: formatMessageDateTimeCompact(normalizedSelectedRecord.sentAt),
                recipientName: normalizedSelectedRecord.recipientName,
                recipientPhone: normalizedSelectedRecord.recipientPhone,
                messageBody: normalizedSelectedRecord.messagePreview.trim() || "내용이 없습니다.",
                failureReason: normalizedSelectedRecord.failureReason ?? null,
              }}
              onBack={() => setSelectedRecord(null)}
            />
          </MobileDetailPage>
        ) : null
      }
    />
  );
}
