import { fireEvent, render, screen } from "@testing-library/react";

import ConsultationsPage from "./page";

const inquiry = {
  id: "inq-1",
  branchId: "branch-1",
  publicBranchSlug: "main",
  motherName: "김상담",
  phone: "010-1234-5678",
  address: "서울시 강남구",
  dueDate: "2026-08-10T00:00:00.000Z",
  birthExperience: "초산",
  voucherType: "A통합1형",
  preferredCaregiverName: null,
  referralSource: "검색",
  privacyAcceptedAt: "2026-07-20T10:00:00.000Z",
  selectedServices: null,
  additionalNotes: null,
  source: "website",
  status: "new",
  readAt: null,
  createdAt: "2026-07-21T10:00:00.000Z",
  updatedAt: "2026-07-21T10:00:00.000Z",
  branchName: "강남점",
};

jest.mock("@/hooks/use-consultation-inquiries", () => ({
  useConsultationInquiries: () => ({
    data: { data: [inquiry], total: 1, page: 1, limit: 100, totalPages: 1 },
    isLoading: false,
    isError: false,
  }),
  useMarkConsultationInquiryAsRead: () => ({ mutate: jest.fn() }),
}));

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

jest.mock("@/components/app/mobile-redesign/primitives", () => ({
  ListCard: ({ beforeFilters, children }: { beforeFilters?: React.ReactNode; children: React.ReactNode }) => (
    <div data-component="test-consultations-list-card">{beforeFilters}{children}</div>
  ),
  ListItemRow: ({ name, onClick }: { name: React.ReactNode; onClick?: () => void }) => (
    <button type="button" onClick={onClick}>{name}</button>
  ),
  ListLoadMoreButton: () => null,
  ListLoadMoreSentinel: () => null,
}));

jest.mock("@/components/app/mobile-redesign/detail-sheet", () => ({
  MobileDetailSheet: ({ list, detail }: { list: React.ReactNode; detail: React.ReactNode }) => (
    <div data-component="test-consultations-detail-sheet">{list}{detail}</div>
  ),
  MobileDetailPage: ({ children }: { children: React.ReactNode }) => <div data-component="test-consultations-detail-page">{children}</div>,
  MobileDetailHeader: () => null,
  MobileDetailActions: ({ actions }: { actions: Array<{ label: string }> }) => (
    <div data-component="test-consultations-actions">{actions.map((action) => <button key={action.label}>{action.label}</button>)}</div>
  ),
  DetailTabPills: () => null,
  MobileDetailTabPanel: ({ children }: { children: React.ReactNode }) => <div data-component="test-consultations-tab-panel">{children}</div>,
  InfoCard: ({ title, children }: { title: string; children: React.ReactNode }) => <section data-component="test-consultations-info-card"><h2>{title}</h2>{children}</section>,
  InfoRow: ({ label, value }: { label: string; value: React.ReactNode }) => <div data-component="test-consultations-info-row"><span>{label}</span><span>{value}</span></div>,
  MobileSearchBar: ({ placeholder, value, onChange }: { placeholder: string; value?: string; onChange?: (value: string) => void }) => (
    <input aria-label={placeholder} value={value} onChange={(event) => onChange?.(event.target.value)} />
  ),
}));

describe("mobile consultations page", () => {
  it("supports the desktop search behavior", () => {
    render(<ConsultationsPage />);

    const search = screen.getByRole("textbox", { name: "이름, 연락처, 주소 검색" });
    fireEvent.change(search, { target: { value: "없는 고객" } });

    expect(screen.queryByRole("button", { name: "김상담" })).not.toBeInTheDocument();
  });

  it("does not expose placeholder actions that do not perform real work", () => {
    render(<ConsultationsPage />);
    fireEvent.click(screen.getByRole("button", { name: "김상담" }));

    expect(screen.queryByRole("button", { name: "답장" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "고객 등록" })).not.toBeInTheDocument();
    expect(screen.getByText("담당 지점")).toBeInTheDocument();
    expect(screen.getByText("강남점")).toBeInTheDocument();
    expect(screen.getByText("개인정보 동의")).toBeInTheDocument();
    expect(screen.getByText("선택 서비스 없음")).toBeInTheDocument();
  });
});
