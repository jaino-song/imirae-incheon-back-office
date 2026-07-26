"use client";

import { ChevronLeft, CircleAlert, MessageCircle } from "lucide-react";

import { InfoCard, InfoRow } from "@/components/app/mobile-redesign/detail-sheet";

export type MessageHistoryDetailTone =
  | "green"
  | "primary"
  | "orange"
  | "muted"
  | "burgundy"
  | "purple";

export interface ClientMessageHistoryDetailView {
  title: string;
  templateLabel: string;
  channelLabel: string;
  statusLabel: string;
  statusTone: MessageHistoryDetailTone;
  sentAtLabel: string;
  recipientName: string;
  recipientPhone: string;
  messageBody: string;
  failureReason: string | null;
}

/**
 * Read-only detail view for a single client message-history entry.
 * Presentational only — the caller resolves the display fields from the log record.
 * Mirrors the frontend MessageHistoryDetailPanel using mobile-redesign primitives.
 */
export function ClientMessageHistoryDetail({
  "data-component": dataComponent,
  view,
  onBack,
  showBackAction = true,
}: {
  "data-component": string;
  view: ClientMessageHistoryDetailView;
  onBack: () => void;
  showBackAction?: boolean;
}) {
  const isFailed = view.statusTone === "burgundy";
  const sub = (suffix: string) => `${dataComponent}_${suffix}`;

  return (
    <div className="message-detail pop-up" data-component={dataComponent}>
      {showBackAction ? (
        <button
          type="button"
          className="message-detail-back"
          data-component={sub("back")}
          onClick={onBack}
        >
          <ChevronLeft size={16} strokeWidth={2.5} />
          목록으로
        </button>
      ) : null}

      <div className="message-detail-head" data-component={sub("head")}>
        <div
          className={`doc-icon doc-icon-${view.statusTone}`}
          data-component={sub("icon")}
        >
          {isFailed ? (
            <CircleAlert size={16} strokeWidth={2.5} />
          ) : (
            <MessageCircle size={16} strokeWidth={2.5} />
          )}
        </div>
        <div
          className="message-detail-head-text"
          data-component={sub("head-text")}
        >
          <div className="message-detail-title" data-component={sub("title")}>
            {view.title}
          </div>
          <div
            className="message-detail-subtitle"
            data-component={sub("subtitle")}
          >
            {view.channelLabel} · {view.sentAtLabel}
          </div>
        </div>
        <span
          className={`badge-mini ${view.statusTone}`}
          data-component={sub("status")}
        >
          {view.statusLabel}
        </span>
      </div>

      <InfoCard data-component={sub("info-card")} title="발송 정보">
        <InfoRow label="수신자" value={view.recipientName} />
        <InfoRow label="연락처" value={view.recipientPhone} />
        <InfoRow label="템플릿" value={view.templateLabel} />
        <InfoRow label="채널" value={view.channelLabel} />
        {view.failureReason ? (
          <InfoRow label="실패 사유" value={view.failureReason} tone="burgundy" />
        ) : null}
      </InfoCard>

      <InfoCard data-component={sub("info-card-2")} title="메시지 내용">
        <p
          className="message-detail-body"
          data-component={sub("body")}
        >
          {view.messageBody}
        </p>
      </InfoCard>
    </div>
  );
}
