"use client";

import { MobileDetailHeader, MobileDetailPage } from "@/components/app/mobile-redesign/detail-sheet";
import { useCallRecord } from "@/hooks/useCallInbox";
import { formatCallTime, formatPhoneNumber } from "@/lib/call-inbox/format";
import type { CallCategory } from "@/lib/call-inbox/types";
import { TranscriptView } from "./TranscriptView";

const CATEGORY_BADGE: Record<CallCategory, { label: string; tone: "green" | "orange" | "muted" }> = {
  NEW_CONSULTATION: { label: "신규 상담", tone: "green" },
  CLIENT_SERVICE: { label: "변경 요청", tone: "orange" },
  OTHER: { label: "기타", tone: "muted" },
};

const DRAFT_STATUS_LABEL: Record<string, string> = {
  PENDING: "검토 대기",
  CONFIRMED: "등록 완료",
  DISCARDED: "폐기",
};

export function CallLogSheet({ recordId }: { recordId: string | null }) {
  const { data: record, isLoading } = useCallRecord(recordId);

  if (recordId === null) return null;

  return (
    <MobileDetailPage name="call-inbox" data-component="call-inbox-log">
      {isLoading || !record ? (
        <div className="p-4 text-[0.82rem] text-v3-text-muted" data-component="call-inbox-log-loading">
          불러오는 중...
        </div>
      ) : (
        <div className="flex flex-col gap-4 px-1 pb-6" data-component="call-inbox-log-detail">
          <MobileDetailHeader data-component="mobile_call-inbox_detail-sheet_stack_detail-page_header"
            name="call-inbox"
            avatar={<span className="text-[1rem]">📞</span>}
            avatarTone={record.category === "NEW_CONSULTATION" ? "green" : record.category === "CLIENT_SERVICE" ? "orange" : "muted"}
            title={record.callerName ?? "발신자 미확인"}
            badges={record.category ? [CATEGORY_BADGE[record.category]] : []}
          />

          <div className="flex items-center justify-between px-1 text-[0.72rem] text-v3-text-muted">
            <span>
              {record.callerPhone ? `${formatPhoneNumber(record.callerPhone)} · ` : ""}
              {formatCallTime(record.recordedAt ?? record.createdAt)}
            </span>
            <a href={record.driveUrl} target="_blank" rel="noreferrer" className="text-v3-primary">
              ▶ 원본 듣기
            </a>
          </div>
          <div className="px-1 text-[0.68rem] text-v3-text-muted">{record.fileName}</div>

          {record.processingStatus === "FAILED" && (
            <div
              className="rounded-xl border border-red-300 bg-red-50 px-3 py-2 text-[0.78rem] text-red-700"
              data-component="call-inbox-log-failed-banner"
            >
              처리 실패{record.failureReason ? ` · ${record.failureReason}` : ""}
            </div>
          )}

          {record.summary && (record.summary.key_content || record.summary.result_action) && (
            <div className="flex flex-col gap-2 rounded-xl bg-gray-50 p-3" data-component="call-inbox-log-summary">
              {record.summary.key_content && (
                <div>
                  <div className="text-[0.7rem] font-bold text-v3-text-muted">핵심 내용</div>
                  <div className="text-[0.82rem] leading-relaxed text-v3-text">{record.summary.key_content}</div>
                </div>
              )}
              {record.summary.result_action && (
                <div>
                  <div className="text-[0.7rem] font-bold text-v3-text-muted">결과 / 조치</div>
                  <div className="text-[0.82rem] leading-relaxed text-v3-text">{record.summary.result_action}</div>
                </div>
              )}
            </div>
          )}

          {(record.matchedClient || record.draft) && (
            <div className="flex flex-wrap items-center gap-2" data-component="call-inbox-log-links">
              {record.matchedClient && (
                <a
                  href="/clients"
                  className="rounded-md bg-blue-50 px-2 py-1 text-[0.7rem] font-medium text-blue-700"
                >
                  고객 #{record.matchedClient.id} {record.matchedClient.name}
                </a>
              )}
              {record.draft && (
                <span className="rounded-md bg-gray-100 px-2 py-1 text-[0.7rem] text-v3-text">
                  {DRAFT_STATUS_LABEL[record.draft.status] ?? record.draft.status}
                </span>
              )}
            </div>
          )}

          <div className="flex flex-col gap-2">
            <div className="text-[0.75rem] font-bold text-v3-text-muted">통화 전문</div>
            <TranscriptView transcript={record.transcript} />
          </div>
        </div>
      )}
    </MobileDetailPage>
  );
}
