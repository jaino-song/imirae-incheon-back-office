import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";

import { api } from "@/lib/api/client";
import type { Client } from "@/lib/client/types";

import { ClientFormPanel } from "../ClientFormDialog";

const mockUpdateClient = jest.fn();
let mockOutOfPocketPriceInfos: Array<{
  id: number;
  duration: number;
  fullPrice: string;
}> = [];

jest.mock("next/navigation", () => ({
  useRouter: () => ({ replace: jest.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

jest.mock("@/hooks/useClients", () => ({
  useCreateClient: () => ({ isPending: false, mutateAsync: jest.fn() }),
  useUpdateClient: () => ({ isPending: false, mutateAsync: mockUpdateClient }),
}));

jest.mock("@/hooks/useVoucherData", () => ({
  useOutOfPocketPriceInfos: () => ({
    data: mockOutOfPocketPriceInfos,
    isError: false,
    isLoading: false,
  }),
  useVoucherPriceInfos: () => ({ data: [], isLoading: false }),
  useVoucherYears: () => ({ data: [], isLoading: false }),
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

const mockApiGet = api.get as jest.MockedFunction<typeof api.get>;

const legacyClient: Client = {
  id: 82,
  name: "레거시 고객",
  createdAt: "2026-01-01",
  birthday: "900101",
  dueDate: null,
  address: "인천시 남동구",
  phone: "010-1111-2222",
  primaryEmployee: null,
  secondaryEmployee: null,
  type: null,
  duration: null,
  fullPrice: null,
  grant: null,
  actualPrice: null,
  startDate: null,
  endDate: null,
  careCenter: false,
  voucherClient: false,
  breastPump: false,
  serviceStatus: "completed",
  eDocId: null,
  hasSigned: false,
  documentStatus: null,
};

describe("ClientForm legacy no-op relink", () => {
  beforeEach(() => {
    HTMLElement.prototype.scrollTo = jest.fn();
    mockApiGet.mockReset();
    mockApiGet.mockResolvedValue({ data: { exists: false } });
    mockUpdateClient.mockReset();
    mockUpdateClient.mockResolvedValue(legacyClient);
    mockOutOfPocketPriceInfos = [];
  });

  it("sends an empty update for an unchanged legacy client with no due date", async () => {
    const onClose = jest.fn();

    render(
      <ClientFormPanel
        open
        activeStep={3}
        client={legacyClient}
        onClose={onClose}
      />,
    );

    await act(async () => {
      await Promise.resolve();
    });

    const saveButton = screen.getByRole("button", { name: "저장" });
    await waitFor(() => expect(saveButton).toBeEnabled());
    fireEvent.click(saveButton);

    await waitFor(() => {
      expect(mockUpdateClient).toHaveBeenCalledWith({
        id: legacyClient.id,
        dto: {},
      });
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("keeps due-date validation when any legacy client field changes", async () => {
    const { rerender } = render(
      <ClientFormPanel
        open
        activeStep={0}
        client={legacyClient}
        onClose={jest.fn()}
      />,
    );

    await act(async () => {
      await Promise.resolve();
    });

    const nextButton = screen.getByRole("button", { name: "다음" });
    await waitFor(() => expect(nextButton).toBeEnabled());
    fireEvent.change(screen.getByLabelText(/이름/), {
      target: { value: "변경된 고객" },
    });

    rerender(
      <ClientFormPanel
        open
        activeStep={3}
        client={legacyClient}
        onClose={jest.fn()}
      />,
    );

    const saveButton = screen.getByRole("button", { name: "저장" });
    expect(saveButton).toBeDisabled();
    fireEvent.click(saveButton);
    expect(mockUpdateClient).not.toHaveBeenCalled();
  });

  it("does not reuse another legacy client's no-op snapshot during a client switch", async () => {
    const { rerender } = render(
      <ClientFormPanel
        open
        activeStep={3}
        client={legacyClient}
        onClose={jest.fn()}
      />,
    );

    await act(async () => {
      await Promise.resolve();
    });

    const nextLegacyClient = {
      ...legacyClient,
      id: legacyClient.id + 1,
      name: "다른 레거시 고객",
      phone: "010-3333-4444",
    };

    rerender(
      <ClientFormPanel
        open
        activeStep={3}
        client={nextLegacyClient}
        onClose={jest.fn()}
      />,
    );

    const saveButton = screen.getByRole("button", { name: "저장" });
    expect(saveButton).toBeDisabled();
    fireEvent.click(saveButton);
    expect(mockUpdateClient).not.toHaveBeenCalled();

    await act(async () => {
      await Promise.resolve();
    });
  });

  it("keeps no-op relink available after automatic price hydration", async () => {
    mockOutOfPocketPriceInfos = [
      { id: 1, duration: 5, fullPrice: "815000" },
    ];
    const clientWithAutoPrice = {
      ...legacyClient,
      duration: 5,
      fullPrice: null,
      grant: null,
      actualPrice: null,
    };
    const onClose = jest.fn();
    const { rerender } = render(
      <ClientFormPanel
        open
        activeStep={2}
        client={clientWithAutoPrice}
        onClose={onClose}
      />,
    );

    await waitFor(() => {
      expect(screen.getByLabelText("총 서비스 금액")).toHaveValue("815,000");
    });

    rerender(
      <ClientFormPanel
        open
        activeStep={3}
        client={clientWithAutoPrice}
        onClose={onClose}
      />,
    );

    const saveButton = screen.getByRole("button", { name: "저장" });
    expect(saveButton).toBeEnabled();
    fireEvent.click(saveButton);

    await waitFor(() => {
      expect(mockUpdateClient).toHaveBeenCalledWith({
        id: clientWithAutoPrice.id,
        dto: {},
      });
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("requires normal validation after a user edits an automatically hydrated price", async () => {
    mockOutOfPocketPriceInfos = [
      { id: 1, duration: 5, fullPrice: "815000" },
    ];
    const clientWithAutoPrice = {
      ...legacyClient,
      duration: 5,
      fullPrice: null,
      grant: null,
      actualPrice: null,
    };
    const { rerender } = render(
      <ClientFormPanel
        open
        activeStep={2}
        client={clientWithAutoPrice}
        onClose={jest.fn()}
      />,
    );

    const priceInput = await screen.findByLabelText("총 서비스 금액");
    await waitFor(() => expect(priceInput).toHaveValue("815,000"));
    fireEvent.change(priceInput, { target: { value: "820000" } });

    rerender(
      <ClientFormPanel
        open
        activeStep={3}
        client={clientWithAutoPrice}
        onClose={jest.fn()}
      />,
    );

    const saveButton = screen.getByRole("button", { name: "저장" });
    expect(saveButton).toBeDisabled();
    fireEvent.click(saveButton);
    expect(mockUpdateClient).not.toHaveBeenCalled();
  });

  it("allows an unchanged international-format phone to reach the backend relink", async () => {
    const internationalPhoneClient = {
      ...legacyClient,
      phone: "+82 10-1111-2222",
    };

    render(
      <ClientFormPanel
        open
        activeStep={3}
        client={internationalPhoneClient}
        onClose={jest.fn()}
      />,
    );

    await act(async () => {
      await Promise.resolve();
    });

    const saveButton = screen.getByRole("button", { name: "저장" });
    expect(saveButton).toBeEnabled();
    fireEvent.click(saveButton);

    await waitFor(() => {
      expect(mockUpdateClient).toHaveBeenCalledWith({
        id: internationalPhoneClient.id,
        dto: {},
      });
    });
  });

  it("does not treat clearing an existing due date as a no-op", async () => {
    render(
      <ClientFormPanel
        open
        activeStep={0}
        client={{ ...legacyClient, dueDate: "2026-08-01" }}
        onClose={jest.fn()}
      />,
    );

    await act(async () => {
      await Promise.resolve();
    });

    fireEvent.change(screen.getByLabelText(/출산 예정일/), {
      target: { value: "" },
    });

    expect(screen.getByRole("button", { name: "다음" })).toBeDisabled();
    expect(mockUpdateClient).not.toHaveBeenCalled();
  });
});
