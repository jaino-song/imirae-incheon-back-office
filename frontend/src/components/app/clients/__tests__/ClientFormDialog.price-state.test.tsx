import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";

import type { Client } from "@/lib/client/types";

import { ClientFormPanel } from "../ClientFormDialog";

let mockVoucherPriceInfos = [
  {
    id: 1,
    type: "A가1형",
    duration: "10",
    fullPrice: "1,464,000",
    grant: "1,002,000",
    actualPrice: "462,000",
  },
];

const mockOutOfPocketPriceInfos = [
  { id: 1, duration: 5, fullPrice: "815000" },
  { id: 2, duration: 10, fullPrice: "1620000" },
  { id: 3, duration: 15, fullPrice: "2425000" },
  { id: 4, duration: 20, fullPrice: "3240000" },
];

jest.mock("next/navigation", () => ({
  useRouter: () => ({ replace: jest.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

jest.mock("@/hooks/useClients", () => ({
  useCreateClient: () => ({ isPending: false, mutateAsync: jest.fn() }),
  useUpdateClient: () => ({ isPending: false, mutateAsync: jest.fn() }),
}));

jest.mock("@/hooks/useVoucherData", () => ({
  useAvailableClientAreas: () => ({ data: [], isLoading: false }),
  useAreaTemplates: () => ({ data: [], isLoading: false }),
  useVoucherPriceInfos: (type: string) => ({
    data: type ? mockVoucherPriceInfos : [],
    isLoading: false,
  }),
  useVoucherYears: () => ({ data: [2025, 2026], isLoading: false }),
  useOutOfPocketPriceInfos: () => ({
    data: mockOutOfPocketPriceInfos,
    isLoading: false,
    isError: false,
  }),
}));

jest.mock("@/stores/client-dialog-store", () => {
  const state = { prefillName: "", clearPrefillName: jest.fn() };

  return {
    useClientDialogStore: (selector: (value: typeof state) => unknown) => selector(state),
  };
});

jest.mock("@/providers/LocaleProvider", () => ({
  useLocale: () => "ko",
}));

jest.mock("../EmployeeAutocomplete", () => ({
  EmployeeAutocomplete: () => <div data-testid="employee-autocomplete" />,
}));

jest.mock("@/components/app/employees/EmployeeFormDialog", () => ({
  EmployeeFormDialog: () => null,
}));

jest.mock("@/lib/api/client", () => ({
  api: {
    get: jest.fn(),
  },
}));

describe("ClientFormPanel voucher pricing", () => {
  beforeEach(() => {
    mockVoucherPriceInfos = [
      {
        id: 1,
        type: "A가1형",
        duration: "10",
        fullPrice: "1,464,000",
        grant: "1,002,000",
        actualPrice: "462,000",
      },
    ];
  });

  it("keeps prices blank and disabled until type and duration are selected", async () => {
    render(<ClientFormPanel open activeStep={2} onClose={jest.fn()} />);

    await act(async () => {
      await Promise.resolve();
    });

    fireEvent.click(screen.getByRole("tab", { name: "바우처 고객" }));

    const voucherType = screen.getByLabelText("바우처 유형");
    const duration = screen.getByLabelText("서비스 기간");
    const fullPrice = screen.getByLabelText("총 서비스 금액");
    const grant = screen.getByLabelText("정부지원금");
    const actualPrice = screen.getByLabelText("본인부담금");

    expect(screen.getByRole("option", { name: "A통합1형" })).toHaveValue("A통합1형");
    expect(screen.queryByRole("option", { name: "A통합-1형" })).not.toBeInTheDocument();

    for (const input of [fullPrice, grant, actualPrice]) {
      expect(input).toBeDisabled();
      expect(input).toHaveValue("");
      expect(input).not.toHaveAttribute("placeholder");
    }

    fireEvent.change(voucherType, { target: { value: "A가1형" } });

    await waitFor(() => expect(duration).toBeEnabled());
    for (const input of [fullPrice, grant, actualPrice]) {
      expect(input).toBeDisabled();
      expect(input).toHaveValue("");
    }

    fireEvent.change(duration, { target: { value: "10" } });

    await waitFor(() => {
      expect(fullPrice).toBeEnabled();
      expect(fullPrice).toHaveValue("1,464,000");
      expect(grant).toBeEnabled();
      expect(grant).toHaveValue("1,002,000");
      expect(actualPrice).toBeEnabled();
      expect(actualPrice).toHaveValue("462,000");
    });

    fireEvent.change(fullPrice, { target: { value: "1500000" } });
    expect(fullPrice).toHaveValue("1,500,000");

    fireEvent.change(voucherType, { target: { value: "A통합1형" } });

    await waitFor(() => {
      for (const input of [fullPrice, grant, actualPrice]) {
        expect(input).toBeDisabled();
        expect(input).toHaveValue("");
      }
    });
  });

  it("keeps saved prices editable when an existing client already has type and duration", async () => {
    const client: Client = {
      id: 1,
      name: "김산모",
      createdAt: "2026-01-01",
      birthday: "900101",
      dueDate: "2026-08-01",
      birthDate: null,
      address: "인천시 서구",
      phone: "010-1111-2222",
      primaryEmployee: null,
      secondaryEmployee: null,
      type: "A가1형",
      duration: 10,
      fullPrice: "1,500,000",
      grant: "1,000,000",
      actualPrice: "500,000",
      startDate: null,
      endDate: null,
      careCenter: false,
      voucherClient: true,
      breastPump: false,
      serviceStatus: "waiting",
      eDocId: null,
      hasSigned: false,
      documentStatus: null,
    };
    mockVoucherPriceInfos = [];

    render(
      <ClientFormPanel
        open
        activeStep={2}
        client={client}
        onClose={jest.fn()}
      />,
    );

    await act(async () => {
      await Promise.resolve();
    });

    expect(screen.getByLabelText("총 서비스 금액")).toBeEnabled();
    expect(screen.getByLabelText("총 서비스 금액")).toHaveValue("1,500,000");
    expect(screen.getByLabelText("정부지원금")).toBeEnabled();
    expect(screen.getByLabelText("정부지원금")).toHaveValue("1,000,000");
    expect(screen.getByLabelText("본인부담금")).toBeEnabled();
    expect(screen.getByLabelText("본인부담금")).toHaveValue("500,000");
  });

  it("shows only duration and editable total price for an out-of-pocket client", async () => {
    render(<ClientFormPanel open activeStep={2} onClose={jest.fn()} />);

    await act(async () => {
      await Promise.resolve();
    });

    fireEvent.click(screen.getByRole("tab", { name: "자부담 고객" }));

    expect(screen.queryByLabelText("바우처 연도")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("바우처 유형")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("정부지원금")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("본인부담금")).not.toBeInTheDocument();

    const duration = screen.getByLabelText("서비스 기간");
    expect(duration).toBeEnabled();
    expect(screen.getByRole("option", { name: "1주 (5일)" })).toBeInTheDocument();

    fireEvent.change(duration, { target: { value: "5" } });

    const fullPrice = screen.getByLabelText("총 서비스 금액");
    await waitFor(() => expect(fullPrice).toHaveValue("815,000"));
    expect(fullPrice).toBeEnabled();

    fireEvent.change(fullPrice, { target: { value: "820000" } });
    expect(fullPrice).toHaveValue("820,000");
  });

  it("preserves a saved out-of-pocket override until the duration changes", async () => {
    const client: Client = {
      id: 2,
      name: "자부담 고객",
      createdAt: "2026-01-01",
      birthday: "900101",
      dueDate: "2026-08-01",
      birthDate: null,
      address: "인천시 서구",
      phone: "010-1111-3333",
      primaryEmployee: null,
      secondaryEmployee: null,
      type: null,
      duration: 5,
      fullPrice: "900000",
      grant: "0",
      actualPrice: "900000",
      startDate: null,
      endDate: null,
      careCenter: false,
      voucherClient: false,
      breastPump: false,
      serviceStatus: "waiting",
      eDocId: null,
      hasSigned: false,
      documentStatus: null,
    };

    render(
      <ClientFormPanel
        open
        activeStep={2}
        client={client}
        onClose={jest.fn()}
      />,
    );

    await act(async () => {
      await Promise.resolve();
    });

    const fullPrice = screen.getByLabelText("총 서비스 금액");
    expect(fullPrice).toHaveValue("900,000");

    fireEvent.change(screen.getByLabelText("서비스 기간"), { target: { value: "10" } });
    await waitFor(() => expect(fullPrice).toHaveValue("1,620,000"));
  });

  it("hydrates existing ISO dates as YYYY-MM-DD exactly once", async () => {
    const client: Client = {
      id: 3,
      name: "날짜 검수 고객",
      createdAt: "2026-01-01",
      birthday: "900101",
      dueDate: "2026-09-01",
      birthDate: null,
      address: "인천시 남동구",
      phone: "010-1111-4444",
      primaryEmployee: null,
      secondaryEmployee: null,
      type: "A가1형",
      duration: 5,
      fullPrice: "732000",
      grant: "659000",
      actualPrice: "73000",
      startDate: "2026-08-01",
      endDate: "2026-08-05",
      careCenter: false,
      voucherClient: true,
      breastPump: false,
      serviceStatus: "waiting",
      eDocId: null,
      hasSigned: false,
      documentStatus: null,
    };

    const { rerender } = render(
      <ClientFormPanel open activeStep={0} client={client} onClose={jest.fn()} />,
    );

    await waitFor(() => expect(screen.getByLabelText("출산 예정일")).toHaveValue("2026-09-01"));

    rerender(<ClientFormPanel open activeStep={3} client={client} onClose={jest.fn()} />);

    const startDateInput = screen.getByLabelText("시작일");
    const endDateInput = screen.getByLabelText("종료일");
    expect(startDateInput).toHaveAttribute("placeholder", "YYYY-MM-DD");
    expect(startDateInput).toHaveAttribute("maxLength", "10");
    expect(startDateInput).toHaveValue("2026-08-01");
    expect(endDateInput).toHaveAttribute("placeholder", "YYYY-MM-DD");
    expect(endDateInput).toHaveAttribute("maxLength", "10");
    expect(endDateInput).toHaveValue("2026-08-05");
    expect(endDateInput).not.toHaveAttribute("readonly");

    await act(async () => {
      fireEvent.change(startDateInput, { target: { value: "20260802" } });
      await Promise.resolve();
    });
    expect(startDateInput).toHaveValue("2026-08-02");

    await act(async () => {
      fireEvent.change(endDateInput, { target: { value: "20260812" } });
      await Promise.resolve();
    });
    expect(endDateInput).toHaveValue("2026-08-12");
  });
});
