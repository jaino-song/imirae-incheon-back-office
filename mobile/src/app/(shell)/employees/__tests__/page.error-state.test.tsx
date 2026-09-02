import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";

import EmployeesPage from "../page";
import {
  useDeleteEmployee,
  useEmployeeActiveClients,
  useEmployeeWorkHistory,
  type Employee,
  type EmployeeWorkHistoryEntry,
} from "@/hooks/useEmployees";
import { useInfiniteEmployees } from "@/hooks/useInfiniteEmployees";

const mockRefetchWorkHistory = jest.fn();
const mockFetchNextPage = jest.fn();

jest.mock("@/hooks/useInfiniteEmployees", () => ({
  useInfiniteEmployees: jest.fn(),
}));

jest.mock("@/hooks/useEmployees", () => ({
  useDeleteEmployee: jest.fn(),
  useEmployeeActiveClients: jest.fn(),
  useEmployeeWorkHistory: jest.fn(),
}));

jest.mock("@/components/app/employees/EmployeeFormDialog", () => ({
  EmployeeFormDialog: () => null,
}));

jest.mock("@/components/app/ui/MobileTwoButtonModal", () => ({
  MobileTwoButtonModal: () => null,
}));

jest.mock("@/components/ui/dropdown-menu", () => ({
  DropdownMenu: ({ children }: { children: ReactNode }) => <>{children}</>,
  DropdownMenuContent: ({ children }: { children: ReactNode }) => <>{children}</>,
  DropdownMenuItem: ({ children }: { children: ReactNode }) => <>{children}</>,
  DropdownMenuTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

jest.mock("@/components/app/v3", () => ({
  ListEmptyState: ({ message }: { message: string }) => <div>{message}</div>,
}));

jest.mock("@/components/app/mobile-redesign/primitives", () => ({
  Badge: ({ label }: { label: string }) => <span>{label}</span>,
  ListCard: ({ children }: { children: ReactNode }) => <section>{children}</section>,
  ListCountSkeleton: () => <span>로딩 중</span>,
  ListItemRow: ({ name, onClick }: { name: string; onClick: () => void }) => (
    <button type="button" onClick={onClick}>{name}</button>
  ),
  ListLoadMoreButton: () => null,
  ListLoadMoreSentinel: () => null,
  ListRowsSkeleton: () => <div>로딩 중</div>,
}));

jest.mock("@/components/app/mobile-redesign/detail-sheet", () => ({
  DetailTabPills: ({
    tabs,
    onTabChange,
  }: {
    tabs: Array<{ id: string; label: string }>;
    onTabChange: (id: string) => void;
  }) => (
    <div>
      {tabs.map((tab) => (
        <button key={tab.id} type="button" onClick={() => onTabChange(tab.id)}>
          {tab.label}
        </button>
      ))}
    </div>
  ),
  DocRow: ({ title, meta, badge }: { title: string; meta: string; badge: string }) => (
    <div>
      <span>{title}</span>
      <span>{meta}</span>
      <span>{badge}</span>
    </div>
  ),
  InfoCard: ({ children, title }: { children: ReactNode; title: string }) => (
    <section>
      <h2>{title}</h2>
      {children}
    </section>
  ),
  InfoRow: ({ label, value }: { label: string; value: ReactNode }) => (
    <div>{label}: {value}</div>
  ),
  MobileDetailHeader: ({ title }: { title: string }) => <h1>{title}</h1>,
  MobileDetailPage: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  MobileDetailSheet: ({ list, detail }: { list: ReactNode; detail: ReactNode }) => (
    <div>{list}{detail}</div>
  ),
  MobileSearchBar: () => null,
  MobileDetailTabPanel: ({
    activeTab,
    tabId,
    children,
  }: {
    activeTab: string;
    tabId: string;
    children: ReactNode;
  }) => activeTab === tabId ? <section>{children}</section> : null,
}));

jest.mock("@/components/ui/skeleton", () => ({
  Skeleton: () => <span>로딩 중</span>,
}));

jest.mock("@/providers/LocaleProvider", () => ({
  useLocale: () => "ko",
}));

jest.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: jest.fn() }),
}));

jest.mock("@/hooks/useListInfiniteScroll", () => ({
  useListInfiniteScroll: () => ({
    visibleCount: 10,
    isInitialLoad: false,
    hasMore: false,
    sentinelRef: jest.fn(),
    scrollContainerRef: { current: null },
    loadMore: jest.fn(),
  }),
}));

jest.mock("@/lib/i18n/translations", () => ({
  t: () => "알 수 없음",
}));

const mockedUseInfiniteEmployees = jest.mocked(useInfiniteEmployees);
const mockedUseDeleteEmployee = jest.mocked(useDeleteEmployee);
const mockedUseEmployeeActiveClients = jest.mocked(useEmployeeActiveClients);
const mockedUseEmployeeWorkHistory = jest.mocked(useEmployeeWorkHistory);

const employee: Employee = {
  id: 7,
  name: "홍길동",
  workArea: ["gangnam"],
  phone: "01012345678",
  grade: "A",
  openToNextWork: true,
  registeredDate: "2026-08-27T00:00:00.000Z",
  status: "available",
};

const historyEntry: EmployeeWorkHistoryEntry = {
  scheduleId: 22,
  clientId: 11,
  clientName: "박서연",
  role: "secondary",
  startDate: "2025-01-01",
  endDate: "2025-06-30",
  status: "replaced",
};

function makeWorkHistoryResult(overrides: Record<string, unknown> = {}) {
  return {
    history: [],
    isLoading: false,
    isError: false,
    refetch: mockRefetchWorkHistory,
    hasNextPage: false,
    fetchNextPage: mockFetchNextPage,
    isFetchingNextPage: false,
    ...overrides,
  } as unknown as ReturnType<typeof useEmployeeWorkHistory>;
}

function renderPage() {
  mockedUseInfiniteEmployees.mockReturnValue({
    allEmployees: [employee],
    isLoading: false,
  } as unknown as ReturnType<typeof useInfiniteEmployees>);
  mockedUseEmployeeActiveClients.mockReturnValue({
    data: [],
    isLoading: false,
  } as unknown as ReturnType<typeof useEmployeeActiveClients>);
  mockedUseDeleteEmployee.mockReturnValue({
    mutateAsync: jest.fn(),
    isPending: false,
  } as unknown as ReturnType<typeof useDeleteEmployee>);

  render(<EmployeesPage />);
  fireEvent.click(screen.getByRole("button", { name: employee.name }));
  fireEvent.click(screen.getByRole("button", { name: "근무 내역" }));
}

describe("EmployeesPage work history query states", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedUseEmployeeWorkHistory.mockReturnValue(makeWorkHistoryResult());
  });

  it("keeps cached history rows visible and offers a polite retry after refetch failure", () => {
    mockedUseEmployeeWorkHistory.mockReturnValue(
      makeWorkHistoryResult({
        history: [historyEntry],
        isError: true,
      }),
    );

    renderPage();

    expect(screen.getByText(historyEntry.clientName)).toBeInTheDocument();
    expect(screen.queryByText("근무 내역을 불러오지 못했어요")).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveAttribute(
      "data-component",
      "mobile_employees_detail-panel_info-card-4_cached-data-error",
    );
    expect(screen.getByRole("status")).toHaveAttribute("aria-live", "polite");

    fireEvent.click(screen.getByRole("button", { name: "근무 내역 다시 시도" }));

    expect(mockRefetchWorkHistory).toHaveBeenCalledTimes(1);
  });

  it("keeps the blocking error fallback for an empty initial failure", () => {
    mockedUseEmployeeWorkHistory.mockReturnValue(
      makeWorkHistoryResult({ isError: true }),
    );

    renderPage();

    expect(screen.getByText("근무 내역을 불러오지 못했어요")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });
});
