import { fireEvent, render, screen } from "@testing-library/react";

import PricesPage from "./page";

const mockUseGetAuthUser = jest.fn();

jest.mock("@/hooks/useGetAuthUser", () => ({
  useGetAuthUser: () => mockUseGetAuthUser(),
}));

jest.mock("@/hooks/useVoucherData", () => ({
  VOUCHER_TYPES: [],
  useVoucherYears: () => ({ data: [2026], isLoading: false }),
  useAllVoucherPrices: () => ({ data: [], isLoading: false, isError: false }),
}));

jest.mock("@/components/app/mobile-redesign/primitives", () => ({
  ListCard: ({ actionLabel, actionLoading, onActionClick, children }: {
    actionLabel?: string;
    actionLoading?: boolean;
    onActionClick?: () => void;
    children: React.ReactNode;
  }) => (
    <div data-component="test-prices-list-card">
      {actionLoading ? <div data-testid="test-prices-action-skeleton" /> : null}
      {!actionLoading && actionLabel ? <button onClick={onActionClick}>{actionLabel}</button> : null}
      {children}
    </div>
  ),
  ListCountSkeleton: () => null,
  ListItemRow: () => null,
  ListRowsSkeleton: () => null,
}));

jest.mock("@/components/app/mobile-redesign/detail-sheet", () => ({
  MobileDetailSheet: ({ list, detail }: { list: React.ReactNode; detail: React.ReactNode }) => (
    <div data-component="test-prices-detail-sheet">{list}{detail}</div>
  ),
  MobileDetailPage: ({ children }: { children: React.ReactNode }) => <div data-component="test-prices-detail-page">{children}</div>,
  MobileDetailHeader: () => null,
}));

jest.mock("@/components/app/settings/VoucherPriceUploadForm", () => ({
  VoucherPriceUploadForm: () => <div data-component="test-voucher-price-upload-form" data-testid="voucher-price-upload-form">실제 요금표 업로드</div>,
}));

describe("mobile prices page", () => {
  beforeEach(() => {
    mockUseGetAuthUser.mockReturnValue({ data: { role: "owner" }, isLoading: false });
  });

  it("shows the owner action skeleton while the user role is loading", () => {
    mockUseGetAuthUser.mockReturnValue({ data: undefined, isLoading: true });

    const view = render(<PricesPage />);

    expect(screen.getByTestId("test-prices-action-skeleton")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "업데이트" })).not.toBeInTheDocument();

    mockUseGetAuthUser.mockReturnValue({ data: { role: "owner" }, isLoading: false });
    view.rerender(<PricesPage />);

    expect(screen.queryByTestId("test-prices-action-skeleton")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "업데이트" })).toBeInTheDocument();
  });

  it("opens the functional voucher upload form for owners", () => {
    render(<PricesPage />);

    fireEvent.click(screen.getByRole("button", { name: "업데이트" }));

    expect(screen.getByTestId("voucher-price-upload-form")).toBeInTheDocument();
  });
});
