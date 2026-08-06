import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import CallsPage from "../page";
import type { Paginated } from "@/lib/call-inbox/types";

const mockUseClientDrafts = jest.fn();
const mockUseCallRecords = jest.fn();
const mockUsePendingDraftCount = jest.fn();

jest.mock("@/hooks/useCallInbox", () => ({
  useClientDrafts: (...args: unknown[]) => mockUseClientDrafts(...args),
  useCallRecords: (...args: unknown[]) => mockUseCallRecords(...args),
  usePendingDraftCount: () => mockUsePendingDraftCount(),
  useClientDraft: () => ({ data: undefined }),
  useCallRecord: () => ({ data: undefined }),
  useConfirmDraft: () => ({ mutateAsync: jest.fn(), isPending: false }),
  useDiscardDraft: () => ({ mutateAsync: jest.fn(), isPending: false }),
  usePatchDraft: () => ({ mutate: jest.fn(), mutateAsync: jest.fn(), isPending: false }),
}));

// The reveal hook measures real row heights and drives an IntersectionObserver;
// neither is meaningful in jsdom, so the tests drive visibleCount directly.
let mockVisibleCount = 100;

jest.mock("@/hooks/useListInfiniteScroll", () => ({
  LIST_INFINITE_PAGE_SIZE: 6,
  useListInfiniteScroll: () => ({
    visibleCount: mockVisibleCount,
    isInitialLoad: false,
    hasMore: false,
    sentinelRef: { current: null },
    scrollContainerRef: { current: null },
    loadMore: jest.fn(),
  }),
}));

jest.mock("@/components/app/clients/ClientAutocomplete", () => ({
  ClientAutocomplete: () => <div data-testid="client-autocomplete-stub" />,
}));

// CallLogSheet uses useCallRecord; stub the whole sheet so we don't need full
// call-record fixtures in this page-level test.
jest.mock("@/components/app/call-inbox/CallLogSheet", () => ({
  CallLogSheet: () => <div data-testid="call-log-sheet-stub" />,
}));

// CallReviewSheet needs heavy fixture data; stub it too at page level.
jest.mock("@/components/app/call-inbox/CallReviewSheet", () => ({
  CallReviewSheet: () => <div data-testid="call-review-sheet-stub" />,
}));

const draft = {
  id: "draft-1",
  type: "NEW_CLIENT",
  status: "PENDING",
  requestSummary: "산후도우미 신규 문의",
  callerName: "김서연",
  callerPhone: "01048217763",
  recordedAt: "2026-06-10T05:02:11.000Z",
  createdAt: "2026-06-10T05:10:00.000Z",
  callRecordId: "rec-1",
  client: null,
  hasLowConfidence: true,
  possibleDuplicate: false,
  phoneMatchesExistingClient: false,
};

/**
 * The hooks flatten their own pages now, so this mirrors what they return:
 * de-duplicated rows plus the newest page's total.
 */
function listResult<T extends { id: string }>(
  key: "drafts" | "records",
  rows: T[],
  overrides: Record<string, unknown> = {},
) {
  const page: Paginated<T> = {
    data: rows,
    total: rows.length,
    page: 1,
    limit: 20,
    totalPages: 1,
  };
  return {
    data: { pages: [page], pageParams: [1] },
    [key]: rows,
    total: rows.length,
    isLoading: false,
    isPending: false,
    hasNextPage: false,
    isFetchingNextPage: false,
    isLoadMoreError: false,
    fetchNextPage: jest.fn(),
    ...overrides,
  };
}

const draftsResult = (rows: unknown[], overrides?: Record<string, unknown>) =>
  listResult("drafts", rows as { id: string }[], overrides);
const recordsResult = (rows: unknown[], overrides?: Record<string, unknown>) =>
  listResult("records", rows as { id: string }[], overrides);

describe("CallsPage", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockVisibleCount = 100;
    mockUsePendingDraftCount.mockReturnValue({ data: { count: 1 } });
    mockUseClientDrafts.mockReturnValue(draftsResult([draft]));
    mockUseCallRecords.mockReturnValue(
      recordsResult([], { data: undefined, isLoading: true, isPending: true }),
    );
  });

  it("renders the queue with type badge, caller, and low-confidence flag", () => {
    render(<CallsPage />);
    expect(screen.getByText("신규 상담")).toBeInTheDocument();
    expect(screen.getByText(/김서연/)).toBeInTheDocument();
    expect(screen.getByText(/확신도 낮음/)).toBeInTheDocument();
  });

  it("switches to the call-log tab and shows its empty state", async () => {
    const user = userEvent.setup();
    mockUseCallRecords.mockReturnValue(recordsResult([]));
    render(<CallsPage />);

    // FilterPills renders each tab label as a button with a trailing count span.
    // getByText with exact:false matches the button node that contains the label text.
    await user.click(screen.getByText("통화 기록", { exact: false, selector: "button" }));

    expect(screen.getByText("통화 기록이 없습니다")).toBeInTheDocument();
  });

  describe("server-page glue", () => {
    /** Enough loaded rows that the reveal can sit well short of the end. */
    const manyDrafts = Array.from({ length: 40 }, (_, i) => ({ ...draft, id: `draft-${i}` }));

    it("pulls the next page exactly once when the reveal nears the loaded rows", () => {
      const fetchNextPage = jest.fn();
      mockVisibleCount = 38; // 38 + 6 >= 40
      mockUseClientDrafts.mockReturnValue(
        draftsResult(manyDrafts, { hasNextPage: true, fetchNextPage }),
      );
      render(<CallsPage />);

      expect(fetchNextPage).toHaveBeenCalledTimes(1);
    });

    it("leaves the server alone while the reveal is still inside the loaded rows", () => {
      const fetchNextPage = jest.fn();
      mockVisibleCount = 10; // 10 + 6 < 40
      mockUseClientDrafts.mockReturnValue(
        draftsResult(manyDrafts, { hasNextPage: true, fetchNextPage }),
      );
      render(<CallsPage />);

      expect(fetchNextPage).not.toHaveBeenCalled();
    });

    it("does not stack a second request on top of one in flight", () => {
      const fetchNextPage = jest.fn();
      mockUseClientDrafts.mockReturnValue(
        draftsResult(manyDrafts, {
          hasNextPage: true,
          isFetchingNextPage: true,
          fetchNextPage,
        }),
      );
      render(<CallsPage />);

      expect(fetchNextPage).not.toHaveBeenCalled();
    });

    it("stops asking once the server has no further page", () => {
      const fetchNextPage = jest.fn();
      mockUseClientDrafts.mockReturnValue(
        draftsResult(manyDrafts, { hasNextPage: false, fetchNextPage }),
      );
      render(<CallsPage />);

      expect(fetchNextPage).not.toHaveBeenCalled();
    });

    // A failed load-more leaves hasNextPage true and clears isFetchingNextPage,
    // so nothing else in the guard would stop the effect re-firing forever.
    it("does not retry on its own after a load-more failure", () => {
      const fetchNextPage = jest.fn();
      mockUseClientDrafts.mockReturnValue(
        draftsResult(manyDrafts, {
          hasNextPage: true,
          isLoadMoreError: true,
          fetchNextPage,
        }),
      );
      const { rerender } = render(<CallsPage />);
      rerender(<CallsPage />);

      expect(fetchNextPage).not.toHaveBeenCalled();
    });

    // The other half of the no-loop guard: refiring on the spot loops, but the
    // user revealing further rows is a fresh request and has to be able to
    // recover. isFetchNextPageError never clears itself, so keying off it alone
    // would strand pagination permanently.
    it("retries once the reveal moves past where the failure happened", () => {
      const fetchNextPage = jest.fn();
      const failed = (overrides: Record<string, unknown> = {}) =>
        mockUseClientDrafts.mockReturnValue(
          draftsResult(manyDrafts, {
            hasNextPage: true,
            isLoadMoreError: true,
            fetchNextPage,
            ...overrides,
          }),
        );

      mockVisibleCount = 100;
      failed();
      const { rerender } = render(<CallsPage />);
      rerender(<CallsPage />);
      expect(fetchNextPage).not.toHaveBeenCalled();

      // The reveal advances — the sentinel or a tap asked for more.
      mockVisibleCount = 106;
      rerender(<CallsPage />);
      expect(fetchNextPage).toHaveBeenCalledTimes(1);

      // That retry now runs and fails in turn. Toggling isFetchingNextPage is
      // what makes the effect re-run — plain rerenders leave the deps untouched
      // and would never reach the guard at all. The reveal has not moved since
      // the retry, so this must add nothing: leaving the mark where the FIRST
      // failure happened instead of moving it to each attempt is what turned
      // this into a request every retry-backoff, forever.
      failed({ isFetchingNextPage: true });
      rerender(<CallsPage />);
      failed({ isFetchingNextPage: false });
      rerender(<CallsPage />);

      expect(fetchNextPage).toHaveBeenCalledTimes(1);
    });

    it("drives the records query on the log tab, not the drafts query", async () => {
      const user = userEvent.setup();
      const fetchRecords = jest.fn();
      const fetchDrafts = jest.fn();
      mockUseClientDrafts.mockReturnValue(
        draftsResult([draft], { hasNextPage: false, fetchNextPage: fetchDrafts }),
      );
      mockUseCallRecords.mockReturnValue(
        recordsResult(
          [{ id: "rec-1", callerName: "박지훈", callerPhone: null, summaryLine: "요약" }],
          { hasNextPage: true, fetchNextPage: fetchRecords },
        ),
      );
      render(<CallsPage />);

      await user.click(screen.getByText("통화 기록", { exact: false, selector: "button" }));

      expect(fetchRecords).toHaveBeenCalled();
      expect(fetchDrafts).not.toHaveBeenCalled();
    });
  });
});
