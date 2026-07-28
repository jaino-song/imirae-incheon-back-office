import { fireEvent, render, screen } from "@testing-library/react";

import PricesPage from "./page";

jest.mock("@/hooks/useGetAuthUser", () => ({
  useGetAuthUser: () => ({ data: { role: "owner" } }),
}));

jest.mock("@/hooks/useVoucherData", () => ({
  VOUCHER_TYPES: [],
  useVoucherYears: () => ({ data: [2026], isLoading: false }),
  useAllVoucherPrices: () => ({ data: [], isLoading: false, isError: false }),
}));

jest.mock("@/components/app/mobile-redesign/primitives", () => ({
  ListCard: ({ actionLabel, onActionClick, children }: {
    actionLabel?: string;
    onActionClick?: () => void;
    children: React.ReactNode;
  }) => (
    <div data-component="test-prices-list-card">
      {actionLabel ? <button onClick={onActionClick}>{actionLabel}</button> : null}
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
  it("opens the functional voucher upload form for owners", () => {
    render(<PricesPage />);

    fireEvent.click(screen.getByRole("button", { name: "업데이트" }));

    expect(screen.getByTestId("voucher-price-upload-form")).toBeInTheDocument();
  });
});
