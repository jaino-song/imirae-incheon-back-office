"use client";

import { useEffect, useMemo, useState } from "react";

import {
  FilterPills,
  ListCard,
  ListLoadMoreButton,
  ListLoadMoreSentinel,
  ListRowsSkeleton,
} from "@/components/app/mobile-redesign/primitives";
import {
  MobileDetailSheet,
  MobileSearchBar,
} from "@/components/app/mobile-redesign/detail-sheet";
import { DraftRow, RecordRow } from "@/components/app/call-inbox/CallInboxRows";
import { CallLogSheet } from "@/components/app/call-inbox/CallLogSheet";
import { CallReviewSheet } from "@/components/app/call-inbox/CallReviewSheet";
import {
  useCallRecords,
  useClientDrafts,
  usePendingDraftCount,
} from "@/hooks/useCallInbox";
import { useListInfiniteScroll } from "@/hooks/useListInfiniteScroll";
import type { CallCategory, ClientDraftListItem } from "@/lib/call-inbox/types";
import "@/components/app/mobile-redesign/redesign.css";

type InboxTab = "queue" | "log";

const TAB_QUEUE = "검토 대기";
const TAB_LOG = "통화 기록";
const SHEET_BASE = "mobile_call-inbox_detail-sheet";
const LIST_CONTENT_BASE = `${SHEET_BASE}_stack_list-page_content`;
const LIST_CARD_BASE = `${LIST_CONTENT_BASE}_list-card`;
const LIST_BODY_BASE = `${LIST_CARD_BASE}_body`;

const ALL_CATEGORY = "전체";
const CATEGORY_FILTERS: { label: string; value: CallCategory | undefined }[] = [
  { label: ALL_CATEGORY, value: undefined },
  { label: "신규상담", value: "NEW_CONSULTATION" },
  { label: "고객 변경", value: "CLIENT_SERVICE" },
  { label: "기타", value: "OTHER" },
];

export default function CallsPage() {
  const [tab, setTab] = useState<InboxTab>("queue");
  const [categoryLabel, setCategoryLabel] = useState<string>(ALL_CATEGORY);
  const [search, setSearch] = useState("");
  const [reviewDraftId, setReviewDraftId] = useState<string | null>(null);
  const [logRecordId, setLogRecordId] = useState<string | null>(null);

  const category = useMemo(
    () => CATEGORY_FILTERS.find((c) => c.label === categoryLabel)?.value,
    [categoryLabel],
  );

  const { data: pendingCount } = usePendingDraftCount();
  const draftsQuery = useClientDrafts("PENDING");
  const recordsQuery = useCallRecords(category, search.trim() || undefined);

  // snapshot at click time: the live page query can drop the row (pagination,
  // post-mutation refetch) and would silently hide the duplicate-phone banner
  const [selectedDraft, setSelectedDraft] = useState<ClientDraftListItem | null>(null);

  const closeSheets = () => {
    setReviewDraftId(null);
    setLogRecordId(null);
    setSelectedDraft(null);
  };

  const drafts = useMemo(
    () => draftsQuery.data?.pages.flatMap((page) => page.data) ?? [],
    [draftsQuery.data],
  );
  const records = useMemo(
    () => recordsQuery.data?.pages.flatMap((page) => page.data) ?? [],
    [recordsQuery.data],
  );

  const isQueue = tab === "queue";
  const loadedCount = isQueue ? drafts.length : records.length;
  // Every page carries the same total, so the first one is enough. Taking it
  // from the server rather than from the loaded rows lets the reveal know more
  // is coming before the next page has arrived.
  const activeTotal = isQueue
    ? draftsQuery.data?.pages[0]?.total ?? drafts.length
    : recordsQuery.data?.pages[0]?.total ?? records.length;
  const isLoadingActive = isQueue ? draftsQuery.isLoading : recordsQuery.isLoading;
  const hasNextPage = isQueue ? draftsQuery.hasNextPage : recordsQuery.hasNextPage;
  const isFetchingNextPage = isQueue
    ? draftsQuery.isFetchingNextPage
    : recordsQuery.isFetchingNextPage;
  const fetchDraftsNextPage = draftsQuery.fetchNextPage;
  const fetchRecordsNextPage = recordsQuery.fetchNextPage;

  const { visibleCount, isInitialLoad, hasMore, sentinelRef, scrollContainerRef, loadMore } =
    useListInfiniteScroll({
      resetKey: `${tab}:${categoryLabel}:${search}`,
      totalItems: activeTotal,
    });

  // The other list pages hold their whole list in memory and let the reveal walk
  // it. Call records only ever grow, so they arrive a page at a time: when the
  // reveal reaches the end of what has arrived, ask the server for the next one.
  useEffect(() => {
    if (visibleCount < loadedCount) return;
    if (!hasNextPage || isFetchingNextPage) return;
    void (isQueue ? fetchDraftsNextPage() : fetchRecordsNextPage());
  }, [
    isQueue,
    visibleCount,
    loadedCount,
    hasNextPage,
    isFetchingNextPage,
    fetchDraftsNextPage,
    fetchRecordsNextPage,
  ]);

  const tabFilters = [
    { label: TAB_QUEUE, count: pendingCount?.count ?? "" },
    { label: TAB_LOG, count: isQueue ? "" : activeTotal },
  ];

  return (
    <MobileDetailSheet
      data-component={SHEET_BASE}
      name="call-inbox"
      isOpen={Boolean(reviewDraftId || logRecordId)}
      onClose={closeSheets}
      list={
        <div className="shell-content" data-component={LIST_CONTENT_BASE}>
          <ListCard
            data-component={LIST_CARD_BASE}
            title="통화 인박스"
            filters={tabFilters}
            activeFilter={isQueue ? TAB_QUEUE : TAB_LOG}
            onFilterChange={(label) => setTab(label === TAB_LOG ? "log" : "queue")}
            beforeScroll={
              isQueue ? null : (
                <>
                  <FilterPills
                    data-component={`${LIST_CARD_BASE}_filters_category`}
                    items={CATEGORY_FILTERS.map((c) => ({ label: c.label, count: "" }))}
                    activeLabel={categoryLabel}
                    onChange={setCategoryLabel}
                  />
                  <MobileSearchBar
                    data-component={`${LIST_CARD_BASE}_search`}
                    placeholder="이름, 전화번호 검색"
                    label="call-inbox"
                    value={search}
                    onChange={setSearch}
                  />
                </>
              )
            }
            scrollRef={scrollContainerRef}
            loadMore={
              isInitialLoad && hasMore ? (
                <ListLoadMoreButton
                  data-component={`${LIST_CARD_BASE}_load-more_button`}
                  onLoadMore={loadMore}
                  isLoading={isFetchingNextPage}
                />
              ) : null
            }
          >
            {isLoadingActive ? (
              <ListRowsSkeleton
                data-component={`${LIST_BODY_BASE}_${isQueue ? "queue" : "log"}-skeleton`}
              />
            ) : loadedCount === 0 ? (
              <div
                className="detail-empty-state"
                data-component={`${LIST_BODY_BASE}_${isQueue ? "queue" : "log"}-empty`}
              >
                {isQueue ? "검토할 통화가 없습니다" : "통화 기록이 없습니다"}
              </div>
            ) : (
              // display:contents, so the rows stay direct children of the
              // scroll container the reveal measures against.
              <div
                className="section-block"
                data-component={`${LIST_BODY_BASE}_${isQueue ? "queue" : "log"}-list`}
              >
                {isQueue
                  ? drafts.slice(0, visibleCount).map((draft, index) => (
                      <DraftRow
                        key={draft.id}
                        data-component={`${LIST_BODY_BASE}_queue-list_row`}
                        draft={draft}
                        index={index}
                        onClick={() => {
                          setSelectedDraft(draft);
                          setReviewDraftId(draft.id);
                        }}
                      />
                    ))
                  : records.slice(0, visibleCount).map((record, index) => (
                      <RecordRow
                        key={record.id}
                        data-component={`${LIST_BODY_BASE}_log-list_row`}
                        record={record}
                        index={index}
                        onClick={() => setLogRecordId(record.id)}
                      />
                    ))}
                {!isInitialLoad && hasMore && (
                  <ListLoadMoreSentinel
                    data-component={`${LIST_BODY_BASE}_load-sentinel`}
                    sentinelRef={sentinelRef}
                    isLoading={isFetchingNextPage}
                  />
                )}
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
          <div className="detail-body" data-component={`${SHEET_BASE}_stack_detail-page_empty`} />
        )
      }
    />
  );
}
