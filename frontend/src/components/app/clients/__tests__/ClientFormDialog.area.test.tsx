import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";

import { api } from "@/lib/api/client";
import type { Client } from "@/lib/client/types";

import { ClientFormDialog } from "../ClientFormDialog";

const mockCreateClient = jest.fn();
const mockUpdateClient = jest.fn();

jest.mock("next/navigation", () => ({
  useRouter: () => ({ replace: jest.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

jest.mock("@/hooks/useClients", () => ({
  useCreateClient: () => ({ isPending: false, mutateAsync: mockCreateClient }),
  useUpdateClient: () => ({ isPending: false, mutateAsync: mockUpdateClient }),
}));

jest.mock("@/hooks/useVoucherData", () => ({
  useAreaTemplates: () => ({
    data: [
      { id: "area-template-1", areaId: "Namdonggu", templateId: "template-1", templateName: "남동구 계약서" },
      { id: "area-template-2", areaId: "Seogu", templateId: "template-2", templateName: "서구 계약서" },
    ],
    isLoading: false,
  }),
  useOutOfPocketPriceInfos: () => ({ data: [], isError: false, isLoading: false }),
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

const existingClient: Client = {
  id: 155,
  name: "자동발송 테스트",
  createdAt: "2026-08-24T00:00:00.000Z",
  birthday: "900101",
  dueDate: null,
  birthDate: null,
  address: "인천광역시 남동구",
  phone: "010-6621-1878",
  primaryEmployee: null,
  secondaryEmployee: null,
  type: null,
  duration: null,
  fullPrice: null,
  grant: "0",
  actualPrice: null,
  startDate: null,
  endDate: null,
  careCenter: false,
  voucherClient: false,
  breastPump: false,
  serviceStatus: "pre_booking",
  eDocId: null,
  areaId: "Namdonggu",
  hasSigned: false,
  documentStatus: null,
};

describe("ClientFormDialog area persistence", () => {
  beforeEach(() => {
    HTMLElement.prototype.scrollTo = jest.fn();
    mockApiGet.mockReset();
    mockApiGet.mockResolvedValue({ data: { exists: false } });
    mockCreateClient.mockReset();
    mockCreateClient.mockResolvedValue({ id: 156 });
    mockUpdateClient.mockReset();
    mockUpdateClient.mockResolvedValue(existingClient);
  });

  it("submits the selected area when creating a client", async () => {
    render(<ClientFormDialog open onClose={jest.fn()} />);

    await act(async () => {
      await Promise.resolve();
    });

    fireEvent.change(screen.getByLabelText(/이름/), { target: { value: "신규 자동발송 고객" } });
    fireEvent.change(screen.getByLabelText(/생년월일/), { target: { value: "900101" } });
    fireEvent.change(screen.getByLabelText("관할 지역"), { target: { value: "Namdonggu" } });
    fireEvent.change(screen.getByLabelText(/주소/), { target: { value: "인천광역시 남동구" } });
    fireEvent.change(screen.getByLabelText(/연락처/), { target: { value: "01012345678" } });

    await screen.findByText("등록 가능한 번호입니다.");
    fireEvent.click(screen.getByRole("button", { name: "생성" }));

    await waitFor(() => {
      expect(mockCreateClient).toHaveBeenCalledWith(expect.objectContaining({
        areaId: "Namdonggu",
      }));
    });
  });

  it("prefills and updates the selected area when editing a client", async () => {
    render(<ClientFormDialog open client={existingClient} onClose={jest.fn()} />);

    const areaSelect = await screen.findByLabelText("관할 지역");
    await waitFor(() => expect(areaSelect).toHaveValue("Namdonggu"));

    fireEvent.change(areaSelect, { target: { value: "Seogu" } });
    fireEvent.click(screen.getByRole("button", { name: "저장" }));

    await waitFor(() => {
      expect(mockUpdateClient).toHaveBeenCalledWith({
        id: existingClient.id,
        dto: expect.objectContaining({ areaId: "Seogu" }),
      });
    });
  });
});
