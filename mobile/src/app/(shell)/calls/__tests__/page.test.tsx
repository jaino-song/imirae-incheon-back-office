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
// neither is meaningful in jsdom, so hand the page a fully-revealed list.
jest.mock("@/hooks/useListInfiniteScroll", () => ({
  useListInfiniteScroll: () => ({
    visibleCount: 100,
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

/** The hooks are infinite queries now, so the page reads rows out of `pages`. */
function infiniteResult<T>(rows: T[], overrides: Record<string, unknown> = {}) {
  const page: Paginated<T> = {
    data: rows,
    total: rows.length,
    page: 1,
    limit: 20,
    totalPages: 1,
  };
  return {
    data: { pages: [page], pageParams: [1] },
    isLoading: false,
    hasNextPage: false,
    isFetchingNextPage: false,
    fetchNextPage: jest.fn(),
    ...overrides,
  };
}

describe("CallsPage", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUsePendingDraftCount.mockReturnValue({ data: { count: 1 } });
    mockUseClientDrafts.mockReturnValue(infiniteResult([draft]));
    mockUseCallRecords.mockReturnValue(
      infiniteResult([], { data: undefined, isLoading: true }),
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
    mockUseCallRecords.mockReturnValue(infiniteResult([]));
    render(<CallsPage />);

    // FilterPills renders each tab label as a button with a trailing count span.
    // getByText with exact:false matches the button node that contains the label text.
    await user.click(screen.getByText("통화 기록", { exact: false, selector: "button" }));

    expect(screen.getByText("통화 기록이 없습니다")).toBeInTheDocument();
  });

  it("pulls the next server page once the reveal runs past the loaded rows", () => {
    const fetchNextPage = jest.fn();
    mockUseClientDrafts.mockReturnValue(
      infiniteResult([draft], { hasNextPage: true, fetchNextPage }),
    );
    render(<CallsPage />);

    // The mocked reveal exposes 100 rows while only one has arrived, which is
    // the condition the page uses to ask the server for more.
    expect(fetchNextPage).toHaveBeenCalled();
  });
});
