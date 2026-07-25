import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { api } from "@/lib/api/client";
import { ClientFormPanel } from "../ClientFormDialog";

jest.mock("next/navigation", () => ({
  useRouter: () => ({ replace: jest.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

jest.mock("@/hooks/useClients", () => ({
  useCreateClient: () => ({ isPending: false, mutateAsync: jest.fn() }),
  useUpdateClient: () => ({ isPending: false, mutateAsync: jest.fn() }),
}));

jest.mock("@/hooks/useVoucherData", () => ({
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

describe("ClientFormPanel phone duplicate check", () => {
  beforeEach(() => {
    mockApiGet.mockReset();
  });

  it("blocks the first step for a duplicate and releases it after a unique number is confirmed", async () => {
    mockApiGet
      .mockResolvedValueOnce({ data: { exists: true } })
      .mockResolvedValueOnce({ data: { exists: false } });

    render(<ClientFormPanel open activeStep={0} onClose={jest.fn()} />);

    await act(async () => {
      await Promise.resolve();
    });

    const nameInput = screen.getByLabelText(/이름/);
    expect(nameInput).toHaveAttribute("placeholder", "홍길동");
    fireEvent.change(nameInput, { target: { value: "홍길동" } });
    fireEvent.change(screen.getByLabelText(/생년월일/), { target: { value: "900101" } });
    fireEvent.change(screen.getByLabelText(/출산 예정일/), { target: { value: "260101" } });
    fireEvent.change(screen.getByLabelText(/주소/), { target: { value: "서울시 강남구" } });

    const phoneInput = screen.getByLabelText(/연락처/);
    const nextButton = screen.getByRole("button", { name: "다음" });

    fireEvent.change(phoneInput, { target: { value: "01066211878" } });

    expect(await screen.findByText("이미 등록된 연락처 입니다.")).toBeInTheDocument();
    expect(phoneInput).toHaveAttribute("aria-invalid", "true");
    expect(nextButton).toBeDisabled();

    fireEvent.change(phoneInput, { target: { value: "01012345678" } });

    const availableMessage = await screen.findByText("등록 가능한 번호입니다.");
    const phoneLabel = screen.getByText("연락처", { selector: "label" });

    expect(phoneLabel.parentElement).toContainElement(availableMessage);
    expect(phoneLabel.parentElement).toHaveAttribute(
      "data-component",
      "clients-form-panel-phone-input_label-row",
    );
    await waitFor(() => expect(nextButton).toBeEnabled());
    expect(phoneInput).not.toHaveAttribute("aria-invalid");
  });
});
