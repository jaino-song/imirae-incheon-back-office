import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import type { Employee } from "@/hooks/useEmployees";
import { api } from "@/lib/api/client";
import { EmployeeFormDialog, EmployeeFormPanel } from "../EmployeeFormDialog";

const mockRefetchQueries = jest.fn();
const employeeWithLegacyArea: Employee = {
  id: 1,
  name: "김제공",
  workArea: ["서울 강남구", "인천 연수구"],
  phone: "01012345678",
  grade: "스탠다드",
  openToNextWork: true,
  registeredDate: "2026-07-10",
  status: "available",
};

jest.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ refetchQueries: mockRefetchQueries }),
}));

jest.mock("@/hooks/useEmployees", () => ({
  employeeQueryKeys: { all: ["employees"] },
  useCreateEmployee: () => ({ isPending: false, mutateAsync: jest.fn() }),
  useUpdateEmployee: () => ({ isPending: false, mutateAsync: jest.fn() }),
}));

jest.mock("@/stores/employee-dialog-store", () => {
  const state = { prefillName: "" };

  return {
    useEmployeeDialogStore: (selector: (value: typeof state) => unknown) => selector(state),
  };
});

jest.mock("@/providers/LocaleProvider", () => ({
  useLocale: () => "ko",
}));

jest.mock("@/lib/api/client", () => ({
  api: {
    get: jest.fn(),
  },
}));

const mockApiGet = api.get as jest.MockedFunction<typeof api.get>;

jest.mock("@/components/ui/dialog", () => ({
  Dialog: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

jest.mock("@/components/app/ui/FormDialogShell", () => ({
  FormDialogShell: ({ children, footer }: { children: ReactNode; footer: ReactNode }) => (
    <div>
      {children}
      {footer}
    </div>
  ),
}));

describe("EmployeeFormPanel work area multi-select", () => {
  beforeAll(() => {
    global.ResizeObserver = class ResizeObserver {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockApiGet.mockResolvedValue({ data: { exists: false } });
  });

  it("selects multiple areas and shows an empty-selection error beside the field label", async () => {
    render(<EmployeeFormPanel open onClose={jest.fn()} />);

    await act(async () => {
      await Promise.resolve();
    });

    const trigger = screen.getByRole("combobox", { name: /근무 지역 선택/ });

    fireEvent.click(trigger);
    fireEvent.click(await screen.findByRole("checkbox", { name: "연수구" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "남동구" }));

    expect(trigger).toHaveTextContent("연수구, 남동구");
    expect(screen.getByText("2개 지역 선택")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "완료" }));
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole("button", { name: "선택 해제" }));
    fireEvent.click(screen.getByRole("button", { name: "완료" }));

    const field = document.querySelector<HTMLElement>(
      '[data-component="employees-form-panel-work-area-field"]',
    );
    const openStatusField = document.querySelector<HTMLElement>(
      '[data-component="employees-form-panel-open-status-field"]',
    );
    const openStatusSwitch = document.querySelector<HTMLElement>(
      '[data-component="employees-form-panel-open-status-switch"]',
    );
    const openStatusSwitchThumb = document.querySelector<HTMLElement>(
      '[data-component="employees-form-panel-open-status-switch-thumb"]',
    );
    expect(field).not.toBeNull();
    expect(openStatusField).not.toBeNull();
    expect(openStatusSwitch).not.toBeNull();
    expect(openStatusSwitchThumb).not.toBeNull();

    const label = within(field!).getByText(/근무 지역/, { selector: "label" });
    const error = within(field!).getByText("근무 지역을 선택해주세요");

    expect(label.parentElement).toContainElement(error);
    expect(label.parentElement).toHaveAttribute(
      "data-component",
      "employees-form-panel-work-area-field_label-row",
    );
    expect(trigger).toHaveAttribute("aria-invalid", "true");
    expect(field!.nextElementSibling).toBe(openStatusField);
    expect(openStatusField).toHaveClass(
      "self-end",
      "h-[calc(38px*var(--glint-ui-scale,1))]",
      "min-h-[calc(38px*var(--glint-ui-scale,1))]",
      "rounded-[13px]",
      "border-[1.35px]",
    );
    expect(openStatusField).not.toHaveClass("md:col-span-2");
    expect(openStatusSwitch).toHaveClass(
      "h-[calc(23.4px*var(--glint-ui-scale,1))]",
      "w-[calc(41.4px*var(--glint-ui-scale,1))]",
      "p-[calc(2.7px*var(--glint-ui-scale,1))]",
    );
    expect(openStatusSwitchThumb).toHaveClass(
      "h-[calc(18px*var(--glint-ui-scale,1))]",
      "w-[calc(18px*var(--glint-ui-scale,1))]",
    );
  });

  it("places the dialog validation message in the work-area label row", async () => {
    render(<EmployeeFormDialog open onClose={jest.fn()} />);

    await act(async () => {
      await Promise.resolve();
    });

    const trigger = screen.getByRole("combobox", { name: /근무 지역 선택/ });
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole("button", { name: "완료" }));

    const field = document.querySelector<HTMLElement>(
      '[data-component="employees-form-dialog-field-work-area"]',
    );
    expect(field).not.toBeNull();

    const label = within(field!).getByText(/근무 지역/, { selector: "label" });
    const error = within(field!).getByText("근무 지역을 선택해주세요");

    expect(label.parentElement).toContainElement(error);
    expect(label.parentElement).toHaveAttribute(
      "data-component",
      "employees-form-dialog-field-work-area_label-row",
    );
    expect(trigger).toHaveAttribute("aria-describedby", "employee-form-work-area-error");
  });

  it("preserves an existing area that is outside the configured option list", async () => {
    render(
      <EmployeeFormPanel
        open
        employee={employeeWithLegacyArea}
        onClose={jest.fn()}
      />,
    );

    await act(async () => {
      await Promise.resolve();
    });

    fireEvent.click(screen.getByRole("combobox", { name: /근무 지역 선택/ }));

    const legacyArea = await screen.findByRole("checkbox", { name: "서울 강남구" });
    expect(legacyArea).toBeChecked();

    fireEvent.click(screen.getByRole("checkbox", { name: "남동구" }));
    expect(legacyArea).toBeChecked();
  });

  it("shows duplicate employee phone status beside the field label", async () => {
    mockApiGet
      .mockResolvedValueOnce({ data: { exists: true } })
      .mockResolvedValueOnce({ data: { exists: false } });

    render(<EmployeeFormDialog open onClose={jest.fn()} />);

    await act(async () => {
      await Promise.resolve();
    });

    const phoneInput = screen.getByLabelText(/연락처/);
    fireEvent.change(screen.getByLabelText(/이름/), { target: { value: "김제공" } });
    fireEvent.click(screen.getByRole("combobox", { name: /근무 지역 선택/ }));
    fireEvent.click(await screen.findByRole("checkbox", { name: "남동구" }));
    fireEvent.click(screen.getByRole("button", { name: "완료" }));
    fireEvent.change(phoneInput, { target: { value: "01066211878" } });

    const duplicateMessage = await screen.findByText("이미 등록된 연락처입니다.");
    const phoneLabel = screen.getByText("연락처", { selector: "label" });

    expect(phoneLabel.parentElement).toContainElement(duplicateMessage);
    expect(phoneLabel.parentElement).toHaveAttribute(
      "data-component",
      "employees-form-dialog-field-phone_label-row",
    );
    expect(phoneInput).toHaveAttribute("aria-invalid", "true");
    expect(phoneInput).toHaveAttribute(
      "aria-describedby",
      "employees-form-dialog-phone-helper",
    );
    expect(
      document.querySelector('[data-component="employees-form-dialog-submit"]'),
    ).toBeDisabled();

    fireEvent.change(phoneInput, { target: { value: "01012345678" } });

    await screen.findByText("등록 가능한 번호입니다.");
    await waitFor(() => expect(phoneInput).not.toHaveAttribute("aria-invalid"));
    expect(
      document.querySelector('[data-component="employees-form-dialog-submit"]'),
    ).toBeEnabled();
  });
});
