import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";

import EmployeesPage from "./page";
import { useInfiniteEmployees } from "@/hooks/useInfiniteEmployees";
import type { Employee } from "@/hooks/useEmployees";

const mockRefetch = jest.fn();
const mockFetchNextPage = jest.fn();

jest.mock("@/hooks/useInfiniteEmployees", () => ({
  useInfiniteEmployees: jest.fn(),
}));

jest.mock("@/hooks/useEmployees", () => ({
  useDeleteEmployee: () => ({
    mutateAsync: jest.fn(),
    isPending: false,
  }),
}));

jest.mock("@/components/app/employees/EmployeeFormDialog", () => ({
  EmployeeFormDialog: () => null,
  EmployeeFormPanel: () => null,
}));

jest.mock("@/components/app/ui/TwoButtonModal", () => ({
  TwoButtonModal: () => null,
}));

jest.mock("@/components/app/ui/NotificationOneButtonModal", () => ({
  NotificationOneButtonModal: () => null,
}));

jest.mock("@/components/app/ui/status-badge", () => ({
  StatusPill: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));

jest.mock("@/components/ui/skeleton", () => ({
  Skeleton: () => <span />,
}));

jest.mock("@/components/ui/dropdown-menu", () => ({
  DropdownMenu: ({ children }: { children: ReactNode }) => <>{children}</>,
  DropdownMenuContent: ({ children }: { children: ReactNode }) => <>{children}</>,
  DropdownMenuItem: ({ children }: { children: ReactNode }) => <>{children}</>,
  DropdownMenuTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

jest.mock("@/components/app/v3", () => ({
  AnimatedSlotList: ({
    items,
    isLoading,
    render,
  }: {
    items: unknown[];
    isLoading: boolean;
    render: (props: { item?: unknown; isLoading: boolean }) => ReactNode;
  }) => (
    <div>
      {isLoading ? (
        <div role="status" aria-label="직원 목록 로딩 중">
          로딩 중
        </div>
      ) : (
        items.map((item, index) => (
          <div key={index}>{render({ item, isLoading: false })}</div>
        ))
      )}
    </div>
  ),
  AnimatedSlotListItemContent: ({ title }: { title: string }) => <span>{title}</span>,
  DetailPanel: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  EmptyState: ({ message }: { message: string }) => <div>{message}</div>,
  HeaderActionButton: ({ label }: { label: string }) => <span>{label}</span>,
  InfoCard: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  InfoRow: ({ label, value }: { label: string; value: ReactNode }) => (
    <div>
      {label}: {value}
    </div>
  ),
  ListEmptyState: ({ message }: { message: string }) => <div>{message}</div>,
  ListPanel: ({
    children,
    emptyState,
  }: {
    children: ReactNode;
    emptyState?: ReactNode;
  }) => (
    <section>
      {emptyState}
      {children}
    </section>
  ),
  PageSection: ({ children }: { children: ReactNode }) => <main>{children}</main>,
  SplitLayout: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  StatsBar: () => null,
}));

const mockedUseInfiniteEmployees = jest.mocked(useInfiniteEmployees);

const employee: Employee = {
  id: 1,
  name: "홍길동",
  workArea: ["gangnam"],
  phone: "01012345678",
  grade: "A",
  openToNextWork: true,
  registeredDate: "2026-08-27T00:00:00.000Z",
  status: "available",
};

function makeQueryResult(overrides: Record<string, unknown> = {}) {
  return {
    employees: [],
    allEmployees: [],
    filteredCount: 0,
    isLoading: false,
    isError: false,
    isFetchingNextPage: false,
    hasNextPage: false,
    fetchNextPage: mockFetchNextPage,
    refetch: mockRefetch,
    ...overrides,
  } as unknown as ReturnType<typeof useInfiniteEmployees>;
}

describe("EmployeesPage employee list query states", () => {
  beforeEach(() => {
    mockRefetch.mockReset();
    mockFetchNextPage.mockReset();
    mockedUseInfiniteEmployees.mockReset();
  });

  it("keeps loading distinct from a genuine empty list", () => {
    mockedUseInfiniteEmployees.mockReturnValue(makeQueryResult({ isLoading: true }));

    const { rerender } = render(<EmployeesPage />);

    expect(screen.getByRole("status", { name: "직원 목록 로딩 중" })).toBeInTheDocument();
    expect(screen.queryByText("등록된 직원이 없습니다")).not.toBeInTheDocument();

    mockedUseInfiniteEmployees.mockReturnValue(makeQueryResult());
    rerender(<EmployeesPage />);

    expect(screen.getByText("등록된 직원이 없습니다")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "직원 목록 다시 시도" })).not.toBeInTheDocument();
  });

  it("renders populated results without the empty or error state", () => {
    mockedUseInfiniteEmployees.mockReturnValue(
      makeQueryResult({ employees: [employee], allEmployees: [employee], filteredCount: 1 }),
    );

    render(<EmployeesPage />);

    expect(screen.getByText("홍길동")).toBeInTheDocument();
    expect(screen.queryByText("등록된 직원이 없습니다")).not.toBeInTheDocument();
    expect(screen.queryByText("직원 목록을 불러오지 못했습니다")).not.toBeInTheDocument();
  });

  it("shows a safe accessible retry action when the employee query fails", () => {
    mockedUseInfiniteEmployees.mockReturnValue(
      makeQueryResult({
        isError: true,
        error: new Error("database password leaked"),
      }),
    );

    render(<EmployeesPage />);

    expect(screen.getByRole("alert")).toHaveAttribute(
      "data-component",
      "desktop_employees_split-layout_list-panel_error",
    );
    expect(screen.getByText("직원 목록을 불러오지 못했습니다")).toBeInTheDocument();
    expect(screen.getByText("잠시 후 다시 시도해 주세요.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "직원 목록 다시 시도" })).toBeInTheDocument();
    expect(screen.queryByText("등록된 직원이 없습니다")).not.toBeInTheDocument();
    expect(screen.queryByText("database password leaked")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "직원 목록 다시 시도" }));

    expect(mockRefetch).toHaveBeenCalledTimes(1);
  });
});
