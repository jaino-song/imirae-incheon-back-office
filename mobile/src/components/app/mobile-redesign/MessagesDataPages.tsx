"use client";

import { useMemo, useState } from "react";
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
  MESSAGE_JOB_CANCEL_COPY,
  MESSAGE_JOB_STATUS_BADGE_VARIANT,
  MESSAGE_JOB_STATUS_LABELS,
  MESSAGE_LOG_STATUS_BADGE_VARIANT,
  MESSAGE_RECORD_REASON_LABEL,
  MESSAGE_RECORD_STATUS_FILTER_LABELS,
  MESSAGE_RECORD_ZONE_LABELS,
  formatMessageDateTimeCompact,
  formatMessageFailureReason,
  getMessageTemplateLabel,
  isSmsHistoryRecord,
  isSmsTriggerTemplate,
  normalizeMessageHistoryPresentation,
  type MessageRecordStatusFilter,
  type MessageSectionId,
} from "@babyjamjam/shared";

import {
  useCancelMessageTriggerJob,
  useMessageHistory,
  useUpcomingMessageTriggerJobs,
} from "@/features/message-triggers/hooks/use-message-triggers";
import type {
  MessageLogRecord,
  MessageLogStatus,
  MessageTriggerJobStatus,
  UpcomingMessageTriggerJob,
} from "@/features/message-triggers/types";
import { toast } from "@/hooks/use-toast";
import {
  ClientMessageHistoryDetail,
  type MessageHistoryDetailTone,
} from "@/components/app/clients/client-message-history-detail";
import { ApprovalTwoButtonModal } from "@/components/app/ui/ApprovalTwoButtonModal";
import { StatusBadge } from "@/components/app/ui/status-badge";
import {
  InfoCard,
  InfoRow,
  MobileDetailPage,
  MobileDetailSheet,
} from "@/components/app/mobile-redesign/detail-sheet";
import { MessageSectionNav } from "@/components/app/mobile-redesign/MessageSectionNav";
import { ListCard } from "@/components/app/mobile-redesign/primitives";
import "@/components/app/mobile-redesign/redesign.css";

interface StatusMeta {
  label: string;
  icon: LucideIcon;
}

type MessageFilterItem = { label: string; count: React.ReactNode; active?: boolean };

const STATUS_FILTER_ORDER: MessageRecordStatusFilter[] = ["all", "upcoming", "sent", "failed", "canceled"];

const JOB_STATUS: Record<MessageTriggerJobStatus, StatusMeta> = {
  pending: { label: MESSAGE_JOB_STATUS_LABELS.pending, icon: Clock3 },
  processing: { label: MESSAGE_JOB_STATUS_LABELS.processing, icon: Loader2 },
  sent: { label: MESSAGE_JOB_STATUS_LABELS.sent, icon: CheckCircle2 },
  failed: { label: MESSAGE_JOB_STATUS_LABELS.failed, icon: XCircle },
  canceled: { label: MESSAGE_JOB_STATUS_LABELS.canceled, icon: AlertCircle },
};

const HISTORY_STATUS: Record<MessageLogStatus, StatusMeta> = {
  pending: { label: MESSAGE_HISTORY_STATUS_LABELS.pending, icon: Clock3 },
  sent: { label: MESSAGE_HISTORY_STATUS_LABELS.sent, icon: CheckCircle2 },
  failed: { label: MESSAGE_HISTORY_STATUS_LABELS.failed, icon: XCircle },
  canceled: { label: MESSAGE_HISTORY_STATUS_LABELS.canceled, icon: AlertCircle },
};

const HISTORY_DETAIL_TONE: Record<MessageLogStatus, MessageHistoryDetailTone> = {
  pending: "orange",
  sent: "green",
  failed: "burgundy",
  canceled: "muted",
};

/**
 * Canonical data-component bases for the merged /messages/history route
 * (발송 예정 + 발송 기록 as two zones of one list). `data-slot` carries the
 * CSS/route hooks so the stylesheet never keys off `data-component`.
 * The "history" naming survives the merge because /messages/history is the
 * route that survives it; /messages/scheduled is now a redirect only.
 */
const HISTORY_SHEET_BASE = "mobile_messages_history_detail-sheet";
const HISTORY_LIST_BASE = `${HISTORY_SHEET_BASE}_stack_list-page_shell`;
const HISTORY_ROW_BASE = `${HISTORY_LIST_BASE}_content_list-card_body_item`;
const UPCOMING_ROW_BASE = `${HISTORY_LIST_BASE}_content_list-card_body_item-upcoming`;
const HISTORY_DETAIL_BASE = `${HISTORY_SHEET_BASE}_stack_detail-page_body`;

// UpcomingMessageTriggerJob has no separate "failure reason" field — cancelReason
// is the only reason-shaped field it carries, so it doubles for both statuses.
function getJobReasonText(job: UpcomingMessageTriggerJob): string {
  if (job.status !== "failed" && job.status !== "canceled") return "";
  return formatMessageFailureReason(job.cancelReason);
}

// normalizeMessageHistoryPresentation's failureReason is deliberately
// failed-only (it feeds ClientMessageHistoryDetail's existing "실패 사유" row).
// Canceled records need their own reason lookup straight off errorMessage.
function getRecordReasonText(record: MessageLogRecord): string {
  if (record.status !== "failed" && record.status !== "canceled") return "";
  return formatMessageFailureReason(record.errorMessage);
}

const MANUAL_SCHEDULED_RULE_ID_PREFIX = "manual-sms:";

// Manual scheduled sends ride along in the /upcoming response as message_log
// rows coerced into the UpcomingMessageTriggerJob shape (see backend
// MessageTriggerService.listManualScheduledSmsLogs). They carry a synthetic
// `manual-sms:<logId>` ruleId instead of a real message_trigger_rule id —
// the only signal that distinguishes them from a real trigger job. Only real
// trigger jobs can be canceled through /message-trigger-jobs/:id/cancel.
// Mirrors desktop's isManualScheduledJob (frontend/src/app/(protected)/messages/page.tsx).
function isManualScheduledJob(job: UpcomingMessageTriggerJob): boolean {
  return job.ruleId.startsWith(MANUAL_SCHEDULED_RULE_ID_PREFIX);
}

function MessagePageShell({
  title,
  count,
  activeSection,
  children,
  dataComponent,
  dataSlot = "messages-page",
  filters = [],
  activeFilter,
  onFilterChange,
}: {
  title: string;
  count: React.ReactNode;
  activeSection: MessageSectionId;
  children: React.ReactNode;
  dataComponent: string;
  dataSlot?: string;
  filters?: MessageFilterItem[];
  activeFilter?: string;
  onFilterChange?: (label: string) => void;
}) {
  return (
    <section
      data-component={dataComponent}
      data-slot={dataSlot}
      className="messages-page message-page-shell"
    >
      <div
        className="shell-content flex-col gap-[calc(8px*var(--glint-ui-scale,1))]"
        data-component={`${dataComponent}_content`}
        data-slot="messages-content"
      >
        <div data-component={`${dataComponent}_content_section-nav-wrapper`} className="shrink-0">
          <MessageSectionNav
            data-component={`${dataComponent}_content_section-nav`}
            activeId={activeSection}
          />
        </div>
        <ListCard
          data-component={`${dataComponent}_content_list-card`}
          title={title}
          count={count}
          filters={filters}
          activeFilter={activeFilter}
          onFilterChange={onFilterChange}
        >
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

function UpcomingRow({
  job,
  onCancel,
}: {
  job: UpcomingMessageTriggerJob;
  onCancel: (job: UpcomingMessageTriggerJob) => void;
}) {
  const meta = JOB_STATUS[job.status];
  const StatusIcon = meta.icon;
  const variant = MESSAGE_JOB_STATUS_BADGE_VARIANT[job.status];
  const recipientName = job.payload.recipientName || job.payload.clientName || job.payload.employeeName || "수신자";
  const reasonText = getJobReasonText(job);
  // Only trigger-rule-backed jobs are cancellable, and only while still
  // pending — manual scheduled entries carry a synthetic manual-sms: ruleId
  // (see isManualScheduledJob) and get no cancel action; a non-pending job
  // would just fail server-side anyway.
  const isCancelable = job.status === "pending" && !isManualScheduledJob(job);

  return (
    <article className="message-data-row" data-component={UPCOMING_ROW_BASE}>
      <span className="message-navigation-icon message-navigation-icon-orange">
        <Clock3 size={18} aria-hidden="true" />
      </span>
      <div className="message-data-row-copy message-data-row-copy-split">
        <div className="message-data-row-info">
          <strong className="message-data-row-title">{recipientName}</strong>
          <p className="message-data-row-subtitle">{getMessageTemplateLabel(job.templateKey)}</p>
          {reasonText ? (
            <em data-component={`${UPCOMING_ROW_BASE}_reason`}>{`${MESSAGE_RECORD_REASON_LABEL}: ${reasonText}`}</em>
          ) : null}
        </div>
        <div className="message-data-status-group">
          <StatusBadge variant={variant} data-component={`${UPCOMING_ROW_BASE}_status`}>
            <StatusIcon
              aria-hidden="true"
              className={job.status === "processing" ? "message-data-spinner" : undefined}
            />
            {meta.label}
          </StatusBadge>
          <time className="message-data-schedule-time">{formatMessageDateTimeCompact(job.scheduledFor)}</time>
          {isCancelable ? (
            <button
              type="button"
              className="text-[0.68rem] font-bold text-v3-burgundy"
              data-component={`${UPCOMING_ROW_BASE}_cancel-action`}
              onClick={() => onCancel(job)}
            >
              {MESSAGE_JOB_CANCEL_COPY.action}
            </button>
          ) : null}
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
  const variant = MESSAGE_LOG_STATUS_BADGE_VARIANT[normalized.status];
  const reasonText = getRecordReasonText(record);

  return (
    <button
      type="button"
      className="message-data-row message-data-row-button"
      data-component={HISTORY_ROW_BASE}
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
          {reasonText ? (
            <em data-component={`${HISTORY_ROW_BASE}_reason`}>{`${MESSAGE_RECORD_REASON_LABEL}: ${reasonText}`}</em>
          ) : null}
        </div>
        <StatusBadge variant={variant} data-component={`${HISTORY_ROW_BASE}_status`}>
          <StatusIcon aria-hidden="true" />
          {meta.label}
        </StatusBadge>
      </div>
    </button>
  );
}

export function MessagesHistoryPage() {
  const [selectedRecord, setSelectedRecord] = useState<MessageLogRecord | null>(null);
  const [statusFilter, setStatusFilter] = useState<MessageRecordStatusFilter>("all");
  const [jobPendingCancel, setJobPendingCancel] = useState<UpcomingMessageTriggerJob | null>(null);

  const {
    data: upcomingData = [],
    isLoading: isUpcomingLoading,
    isError: isUpcomingError,
  } = useUpcomingMessageTriggerJobs();
  const {
    data: historyData = [],
    isLoading: isHistoryLoading,
    isError: isHistoryError,
  } = useMessageHistory();
  const cancelMutation = useCancelMessageTriggerJob();

  const upcomingJobs = useMemo(
    () => upcomingData
      .filter((job) => isSmsTriggerTemplate(job.templateKey))
      .sort(
        (left, right) => new Date(left.scheduledFor).getTime() - new Date(right.scheduledFor).getTime(),
      ),
    [upcomingData],
  );

  const historyRecords = useMemo(
    () => historyData
      .filter(isSmsHistoryRecord)
      .sort(
        (left, right) =>
          new Date(right.lastAttemptAt || right.createdAt).getTime()
          - new Date(left.lastAttemptAt || left.createdAt).getTime(),
      ),
    [historyData],
  );

  // all = both zones; upcoming = zone 1 only; sent/failed/canceled = matching
  // zone 2 rows only. Same semantics as desktop's merged screen.
  const showUpcomingZone = statusFilter === "all" || statusFilter === "upcoming";
  const showHistoryZone = statusFilter !== "upcoming";
  const visibleUpcomingJobs = showUpcomingZone ? upcomingJobs : [];
  const visibleHistoryRecords = showHistoryZone
    ? (statusFilter === "all" ? historyRecords : historyRecords.filter((record) => record.status === statusFilter))
    : [];

  const filterCounts: Record<MessageRecordStatusFilter, number> = {
    all: upcomingJobs.length + historyRecords.length,
    upcoming: upcomingJobs.length,
    sent: historyRecords.filter((record) => record.status === "sent").length,
    failed: historyRecords.filter((record) => record.status === "failed").length,
    canceled: historyRecords.filter((record) => record.status === "canceled").length,
  };

  const filterItems: MessageFilterItem[] = STATUS_FILTER_ORDER.map((filter) => ({
    label: MESSAGE_RECORD_STATUS_FILTER_LABELS[filter],
    count: filter === "failed"
      ? <span className="messages-filter-count-danger">{filterCounts[filter]}</span>
      : filterCounts[filter],
    active: filter === statusFilter,
  }));

  const handleFilterChange = (label: string) => {
    const nextFilter = STATUS_FILTER_ORDER.find((filter) => MESSAGE_RECORD_STATUS_FILTER_LABELS[filter] === label);
    if (nextFilter) setStatusFilter(nextFilter);
  };

  const handleConfirmCancel = async () => {
    if (!jobPendingCancel) return;

    try {
      await cancelMutation.mutateAsync(jobPendingCancel.id);
      setJobPendingCancel(null);
      toast({
        title: MESSAGE_JOB_CANCEL_COPY.action,
        description: MESSAGE_JOB_CANCEL_COPY.success,
        variant: "success",
      });
    } catch {
      setJobPendingCancel(null);
      toast({
        title: MESSAGE_JOB_CANCEL_COPY.action,
        description: MESSAGE_JOB_CANCEL_COPY.failure,
        variant: "destructive",
      });
    }
  };

  const isLoading = isUpcomingLoading || isHistoryLoading;
  const upcomingZoneVisible = showUpcomingZone && (visibleUpcomingJobs.length > 0 || isUpcomingError);
  const historyZoneVisible = showHistoryZone && (visibleHistoryRecords.length > 0 || isHistoryError);

  const normalizedSelectedRecord = selectedRecord
    ? normalizeMessageHistoryPresentation(selectedRecord)
    : null;
  const selectedCancelReason = selectedRecord && normalizedSelectedRecord?.status === "canceled"
    ? getRecordReasonText(selectedRecord)
    : "";

  return (
    <>
      <MobileDetailSheet
        data-component={HISTORY_SHEET_BASE}
        name="messages"
        isOpen={normalizedSelectedRecord !== null}
        onClose={() => setSelectedRecord(null)}
        list={
          <MessagePageShell
            title="발송 기록"
            count={`${visibleUpcomingJobs.length + visibleHistoryRecords.length}건`}
            activeSection="history"
            dataComponent={HISTORY_LIST_BASE}
            filters={filterItems}
            activeFilter={MESSAGE_RECORD_STATUS_FILTER_LABELS[statusFilter]}
            onFilterChange={handleFilterChange}
          >
            {isLoading ? (
              <LoadingState />
            ) : (
              <>
                {upcomingZoneVisible ? (
                  <div
                    className="section-block"
                    data-component={`${HISTORY_LIST_BASE}_content_list-card_body_zone-upcoming`}
                  >
                    <div
                      className="section-header"
                      data-component={`${HISTORY_LIST_BASE}_content_list-card_body_zone-upcoming_header`}
                    >
                      {isUpcomingError
                        ? MESSAGE_RECORD_ZONE_LABELS.upcoming
                        : `${MESSAGE_RECORD_ZONE_LABELS.upcoming} ${visibleUpcomingJobs.length}건`}
                    </div>
                    {isUpcomingError ? (
                      <EmptyState message="발송 예정 내역을 불러오지 못했습니다." />
                    ) : (
                      visibleUpcomingJobs.map((job) => (
                        <UpcomingRow key={job.id} job={job} onCancel={setJobPendingCancel} />
                      ))
                    )}
                  </div>
                ) : null}
                {historyZoneVisible ? (
                  <div
                    className="section-block"
                    data-component={`${HISTORY_LIST_BASE}_content_list-card_body_zone-past`}
                  >
                    <div
                      className="section-header"
                      data-component={`${HISTORY_LIST_BASE}_content_list-card_body_zone-past_header`}
                    >
                      {isHistoryError
                        ? MESSAGE_RECORD_ZONE_LABELS.past
                        : `${MESSAGE_RECORD_ZONE_LABELS.past} ${visibleHistoryRecords.length}건`}
                    </div>
                    {isHistoryError ? (
                      <EmptyState message="발송 기록을 불러오지 못했습니다." />
                    ) : (
                      visibleHistoryRecords.map((record) => (
                        <HistoryRow key={record.id} record={record} onSelect={setSelectedRecord} />
                      ))
                    )}
                  </div>
                ) : null}
                {!upcomingZoneVisible && !historyZoneVisible ? (
                  <EmptyState message="표시할 메시지가 없습니다." />
                ) : null}
              </>
            )}
          </MessagePageShell>
        }
        detail={
          normalizedSelectedRecord ? (
            <MobileDetailPage
              name="messages"
              data-component={HISTORY_DETAIL_BASE}
            >
              <ClientMessageHistoryDetail
                data-component={`${HISTORY_DETAIL_BASE}_content`}
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
              {selectedCancelReason ? (
                <InfoCard
                  data-component={`${HISTORY_DETAIL_BASE}_content_cancel-reason`}
                  title="취소 정보"
                >
                  <InfoRow label={MESSAGE_RECORD_REASON_LABEL} value={selectedCancelReason} tone="muted" />
                </InfoCard>
              ) : null}
            </MobileDetailPage>
          ) : null
        }
      />
      <ApprovalTwoButtonModal
        data-component={`${HISTORY_LIST_BASE}_cancel-modal`}
        open={jobPendingCancel !== null}
        onOpenChange={(open) => {
          if (!open) setJobPendingCancel(null);
        }}
        title={MESSAGE_JOB_CANCEL_COPY.confirmTitle}
        description={MESSAGE_JOB_CANCEL_COPY.confirmBody}
        isDescriptionVisuallyHidden={false}
        cancelLabel={MESSAGE_JOB_CANCEL_COPY.dismiss}
        approvalLabel={MESSAGE_JOB_CANCEL_COPY.confirmAction}
        approvalVariant="destructive"
        isPending={cancelMutation.isPending}
        onApprove={handleConfirmCancel}
      />
    </>
  );
}
