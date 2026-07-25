"use client";

import { useMemo, useState } from "react";

import {
  Badge,
  ListCard,
  ListRowsSkeleton,
} from "@/components/app/mobile-redesign/primitives";
import {
  MobileDetailSheet,
  MobileSearchBar,
} from "@/components/app/mobile-redesign/detail-sheet";
import {
  useCallRecords,
  useClientDrafts,
  usePendingDraftCount,
} from "@/hooks/useCallInbox";
import { formatCallTime, formatPhoneNumber } from "@/lib/call-inbox/format";
import type {
  CallCategory,
  CallRecordListItem,
  ClientDraftListItem,
} from "@/lib/call-inbox/types";
import { CallReviewSheet } from "./CallReviewSheet";
import { CallLogSheet } from "./CallLogSheet";
import "@/components/app/mobile-redesign/redesign.css";

type InboxTab = "queue" | "log";

const TAB_QUEUE = "검토 대기";
const TAB_LOG = "통화 기록";

const ALL_CATEGORY = "전체";
const CATEGORY_FILTERS: { label: string; value: CallCategory | undefined }[] = [
  { label: ALL_CATEGORY, value: undefined },
  { label: "신규상담", value: "NEW_CONSULTATION" },
  { label: "고객 변경", value: "CLIENT_SERVICE" },
  { label: "기타", value: "OTHER" },
];

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

function DraftCard({ draft, onClick }: { draft: ClientDraftListItem; onClick: () => void }) {
  const badge =
    draft.type === "NEW_CLIENT"
      ? { label: "신규 상담", tone: "green" as const }
      : { label: "변경 요청", tone: "orange" as const };
  const needsClientLink = draft.type === "CLIENT_UPDATE" && draft.client === null;

  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full flex-col gap-1.5 rounded-xl border border-v3-border bg-white p-3 text-left transition-colors active:bg-gray-50"
      data-component="call-inbox-draft-card"
    >
      <div className="flex items-center justify-between">
        <Badge label={badge.label} tone={badge.tone} />
        <span className="text-[0.7rem] text-v3-text-muted">
          {formatCallTime(draft.recordedAt ?? draft.createdAt)}
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-1.5 text-[0.9rem] font-bold text-v3-dark">
        {callerLine(draft.callerName, draft.callerPhone)}
        {draft.client && (
          <span className="rounded-md bg-blue-50 px-1.5 py-0.5 text-[0.65rem] font-medium text-blue-700">
            고객 #{draft.client.id} 일치
          </span>
        )}
      </div>
      <div className="text-[0.78rem] leading-relaxed text-v3-text">{draft.requestSummary}</div>
      {(draft.hasLowConfidence || draft.possibleDuplicate || needsClientLink) && (
        <div className="flex flex-wrap items-center gap-2 text-[0.7rem] font-bold text-amber-600">
          {draft.hasLowConfidence && <span>⚠ 확신도 낮음</span>}
          {draft.possibleDuplicate && <span>중복 가능</span>}
          {needsClientLink && <span>고객 연결 필요</span>}
        </div>
      )}
    </button>
  );
}

function RecordRow({ record, onClick }: { record: CallRecordListItem; onClick: () => void }) {
  const badge = record.category ? CATEGORY_BADGE[record.category] : null;
  const processingSuffix =
    record.processingStatus === "RECEIVED"
      ? "처리중"
      : record.processingStatus === "FAILED"
        ? "실패"
        : null;
  const draftSuffix = record.draft ? DRAFT_STATUS_SUFFIX[record.draft.status] ?? null : null;

  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full flex-col gap-1.5 rounded-xl border border-v3-border bg-white p-3 text-left transition-colors active:bg-gray-50"
      data-component="call-inbox-record-row"
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          {badge && <Badge label={badge.label} tone={badge.tone} />}
          {processingSuffix && (
            <span
              className={
                record.processingStatus === "FAILED"
                  ? "text-[0.7rem] font-bold text-red-600"
                  : "text-[0.7rem] font-bold text-v3-text-muted"
              }
            >
              {processingSuffix}
            </span>
          )}
        </div>
        <span className="text-[0.7rem] text-v3-text-muted">
          {formatCallTime(record.recordedAt ?? record.createdAt)}
        </span>
      </div>
      <div className="text-[0.9rem] font-bold text-v3-dark">
        {callerLine(record.callerName, record.callerPhone)}
      </div>
      {record.summaryLine && (
        <div className="text-[0.78rem] leading-relaxed text-v3-text">{record.summaryLine}</div>
      )}
      {draftSuffix && (
        <div className="text-[0.7rem] text-v3-text-muted">{draftSuffix}</div>
      )}
    </button>
  );
}

export function CallInboxPage() {
  const [tab, setTab] = useState<InboxTab>("queue");
  const [categoryLabel, setCategoryLabel] = useState<string>(ALL_CATEGORY);
  const [search, setSearch] = useState("");
  const [draftPage, setDraftPage] = useState(1);
  const [recordPage, setRecordPage] = useState(1);
  const [reviewDraftId, setReviewDraftId] = useState<string | null>(null);
  const [logRecordId, setLogRecordId] = useState<string | null>(null);

  const category = useMemo(
    () => CATEGORY_FILTERS.find((c) => c.label === categoryLabel)?.value,
    [categoryLabel],
  );

  const { data: pendingCount } = usePendingDraftCount();
  const draftsQuery = useClientDrafts("PENDING", draftPage);
  const recordsQuery = useCallRecords(recordPage, category, search.trim() || undefined);

  // snapshot at click time: the live page query can drop the row (pagination,
  // post-mutation refetch) and would silently hide the duplicate-phone banner
  const [selectedDraft, setSelectedDraft] = useState<ClientDraftListItem | null>(null);

  const closeSheets = () => {
    setReviewDraftId(null);
    setLogRecordId(null);
    setSelectedDraft(null);
  };

  const tabFilters = [
    { label: TAB_QUEUE, count: pendingCount?.count ?? "" },
    { label: TAB_LOG, count: tab === "log" ? recordsQuery.data?.total ?? "" : "" },
  ];

  const drafts = draftsQuery.data?.data ?? [];
  const draftTotalPages = draftsQuery.data?.totalPages ?? 1;
  const records = recordsQuery.data?.data ?? [];
  const recordTotalPages = recordsQuery.data?.totalPages ?? 1;

  return (
    <>
      <MobileDetailSheet
        data-component="mobile_call-inbox_detail-sheet"
        name="call-inbox"
        isOpen={Boolean(reviewDraftId || logRecordId)}
        onClose={closeSheets}
        list={
          <div className="shell-content" data-component="call-inbox-content">
            <ListCard
              title="통화 인박스"
              filters={tabFilters}
              activeFilter={tab === "queue" ? TAB_QUEUE : TAB_LOG}
              onFilterChange={(label) => setTab(label === TAB_LOG ? "log" : "queue")}
              beforeScroll={
                tab === "log" ? (
                  <>
                    <div className="filter-row" data-component="call-inbox-category-filters">
                      {CATEGORY_FILTERS.map((c) => (
                        <button
                          key={c.label}
                          type="button"
                          className={`filter-pill ${c.label === categoryLabel ? "active" : ""}`}
                          aria-pressed={c.label === categoryLabel}
                          onClick={() => {
                            setCategoryLabel(c.label);
                            setRecordPage(1);
                          }}
                        >
                          {c.label}
                        </button>
                      ))}
                    </div>
                    <MobileSearchBar
                      placeholder="이름, 전화번호 검색"
                      label="call-inbox"
                      value={search}
                      onChange={(value) => {
                        setSearch(value);
                        setRecordPage(1);
                      }}
                    />
                  </>
                ) : null
              }
            >
              {tab === "queue" ? (
                draftsQuery.isLoading ? (
                  <ListRowsSkeleton dataComponentPrefix="call-inbox-queue" />
                ) : drafts.length === 0 ? (
                  <EmptyState message="검토할 통화가 없습니다" component="call-inbox-queue-empty" />
                ) : (
                  <div className="flex flex-col gap-2 px-3 pb-3" data-component="call-inbox-queue-list">
                    {drafts.map((draft) => (
                      <DraftCard
                        key={draft.id}
                        draft={draft}
                        onClick={() => {
                          setSelectedDraft(draft);
                          setReviewDraftId(draft.id);
                        }}
                      />
                    ))}
                    <Pager
                      page={draftPage}
                      totalPages={draftTotalPages}
                      onChange={setDraftPage}
                      component="call-inbox-queue-pager"
                    />
                  </div>
                )
              ) : recordsQuery.isLoading ? (
                <ListRowsSkeleton dataComponentPrefix="call-inbox-log" />
              ) : records.length === 0 ? (
                <EmptyState message="통화 기록이 없습니다" component="call-inbox-log-empty" />
              ) : (
                <div className="flex flex-col gap-2 px-3 pb-3" data-component="call-inbox-log-list">
                  {records.map((record) => (
                    <RecordRow
                      key={record.id}
                      record={record}
                      onClick={() => setLogRecordId(record.id)}
                    />
                  ))}
                  <Pager
                    page={recordPage}
                    totalPages={recordTotalPages}
                    onChange={setRecordPage}
                    component="call-inbox-log-pager"
                  />
                </div>
              )}
            </ListCard>
          </div>
        }
        detail={
          reviewDraftId ? (
            <CallReviewSheet
              draftId={reviewDraftId}
              listItem={selectedDraft}
              onClose={closeSheets}
            />
          ) : logRecordId ? (
            <CallLogSheet recordId={logRecordId} />
          ) : (
            <div className="detail-body" data-component="call-inbox-detail-empty" />
          )
        }
      />
    </>
  );
}

function EmptyState({ message, component }: { message: string; component: string }) {
  return (
    <div
      style={{
        padding: "32px 16px",
        textAlign: "center",
        fontSize: "0.82rem",
        color: "hsl(var(--v3-text-muted))",
      }}
      data-component={component}
    >
      {message}
    </div>
  );
}

function Pager({
  page,
  totalPages,
  onChange,
  component,
}: {
  page: number;
  totalPages: number;
  onChange: (page: number) => void;
  component: string;
}) {
  if (totalPages <= 1) return null;
  return (
    <div className="flex items-center justify-center gap-4 py-2 text-[0.78rem]" data-component={component}>
      <button
        type="button"
        className="text-v3-primary disabled:text-v3-text-muted disabled:opacity-50"
        onClick={() => onChange(page - 1)}
        disabled={page <= 1}
      >
        이전
      </button>
      <span className="text-v3-text-muted">
        {page} / {totalPages}
      </span>
      <button
        type="button"
        className="text-v3-primary disabled:text-v3-text-muted disabled:opacity-50"
        onClick={() => onChange(page + 1)}
        disabled={page >= totalPages}
      >
        다음
      </button>
    </div>
  );
}
