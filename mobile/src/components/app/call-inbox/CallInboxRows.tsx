"use client";

import type { ReactNode } from "react";
import { PhoneIncoming, UserPen, UserPlus } from "lucide-react";

import { Badge, ListItemRow } from "@/components/app/mobile-redesign/primitives";
import { formatCallTime, formatPhoneNumber } from "@/lib/call-inbox/format";
import type { CallCategory, CallRecordListItem, ClientDraftListItem } from "@/lib/call-inbox/types";

const CATEGORY_BADGE: Record<CallCategory, { label: string; tone: "green" | "orange" | "muted" }> = {
  NEW_CONSULTATION: { label: "신규 상담", tone: "green" },
  CLIENT_SERVICE: { label: "변경 요청", tone: "orange" },
  OTHER: { label: "기타", tone: "muted" },
};

const DRAFT_STATUS_SUFFIX: Record<string, string> = {
  PENDING: "검토 대기",
  CONFIRMED: "등록 완료",
  DISCARDED: "폐기",
};

function callerLine(name: string | null, phone: string | null): string {
  if (!name && !phone) return "발신자 미확인";
  const formattedPhone = phone ? formatPhoneNumber(phone) : null;
  if (name && formattedPhone) return `${name} · ${formattedPhone}`;
  return name ?? formattedPhone ?? "발신자 미확인";
}

/**
 * The row avatar. Every other list page leads with one, so a call gets a tinted
 * tile too — the icon carries what a client's initial carries there.
 */
function CallRowIcon({
  tone,
  children,
}: {
  tone: "primary" | "green" | "orange";
  children: ReactNode;
}) {
  const toneClass =
    tone === "green" ? "bg-v3-green" : tone === "orange" ? "bg-v3-orange" : "bg-v3-primary";
  return <div className={`list-avatar ${toneClass}`}>{children}</div>;
}

/** A short marker in the row title; the full reasoning lives in the review sheet. */
function RowFlag({ label, tone = "warning" }: { label: string; tone?: "warning" | "danger" | "muted" }) {
  const toneClass =
    tone === "danger" ? "text-red-600" : tone === "muted" ? "text-v3-text-muted" : "text-amber-600";
  return <span className={`text-[0.62rem] font-bold ${toneClass}`}>{label}</span>;
}

export function DraftRow({
  draft,
  index,
  onClick,
  "data-component": dataComponent,
}: {
  draft: ClientDraftListItem;
  /** Position in the visible list; only used to stagger the entry animation. */
  index: number;
  onClick: () => void;
  "data-component": string;
}) {
  const isNewClient = draft.type === "NEW_CLIENT";
  const badge = isNewClient
    ? { label: "신규 상담", tone: "green" as const }
    : { label: "변경 요청", tone: "orange" as const };
  const needsClientLink = draft.type === "CLIENT_UPDATE" && draft.client === null;

  return (
    <ListItemRow
      data-component={dataComponent}
      style={{ animationDelay: `${Math.min(index, 4) * 40}ms` }}
      left={
        <CallRowIcon tone={isNewClient ? "green" : "orange"}>
          {isNewClient ? (
            <UserPlus size={17} strokeWidth={2.5} />
          ) : (
            <UserPen size={17} strokeWidth={2.5} />
          )}
        </CallRowIcon>
      }
      name={
        <>
          {callerLine(draft.callerName, draft.callerPhone)}
          {draft.client && <RowFlag label={`고객 #${draft.client.id} 일치`} tone="muted" />}
          {draft.hasLowConfidence && <RowFlag label="⚠ 확신도 낮음" />}
          {draft.possibleDuplicate && <RowFlag label="중복 가능" />}
          {needsClientLink && <RowFlag label="고객 연결 필요" />}
        </>
      }
      meta={draft.requestSummary}
      right={
        <>
          <Badge data-component={`${dataComponent}_badge`} label={badge.label} tone={badge.tone} />
          <span className="dday-sub">{formatCallTime(draft.recordedAt ?? draft.createdAt)}</span>
        </>
      }
      onClick={onClick}
    />
  );
}

export function RecordRow({
  record,
  index,
  onClick,
  "data-component": dataComponent,
}: {
  record: CallRecordListItem;
  /** Position in the visible list; only used to stagger the entry animation. */
  index: number;
  onClick: () => void;
  "data-component": string;
}) {
  const badge = record.category ? CATEGORY_BADGE[record.category] : null;
  const processingSuffix =
    record.processingStatus === "RECEIVED"
      ? "처리중"
      : record.processingStatus === "FAILED"
        ? "실패"
        : null;
  const draftSuffix = record.draft ? DRAFT_STATUS_SUFFIX[record.draft.status] ?? null : null;

  return (
    <ListItemRow
      data-component={dataComponent}
      style={{ animationDelay: `${Math.min(index, 4) * 40}ms` }}
      left={
        <CallRowIcon tone="primary">
          <PhoneIncoming size={17} strokeWidth={2.5} />
        </CallRowIcon>
      }
      name={
        <>
          {callerLine(record.callerName, record.callerPhone)}
          {processingSuffix && (
            <RowFlag
              label={processingSuffix}
              tone={record.processingStatus === "FAILED" ? "danger" : "muted"}
            />
          )}
        </>
      }
      meta={
        <>
          {record.summaryLine}
          {record.summaryLine && draftSuffix ? " · " : null}
          {draftSuffix}
        </>
      }
      right={
        <>
          {badge && (
            <Badge data-component={`${dataComponent}_badge`} label={badge.label} tone={badge.tone} />
          )}
          <span className="dday-sub">{formatCallTime(record.recordedAt ?? record.createdAt)}</span>
        </>
      }
      onClick={onClick}
    />
  );
}
