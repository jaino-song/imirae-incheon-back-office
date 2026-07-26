import { fireEvent, render, screen } from "@testing-library/react";

import { EmployeeAutocomplete } from "../EmployeeAutocomplete";
import type { Employee } from "@/hooks/useEmployees";

let mockEmployees: Employee[] = [];
const mockSetPrefillName = jest.fn();

jest.mock("@/hooks/useEmployees", () => ({
  useEmployees: () => ({
    data: mockEmployees,
    isLoading: false,
  }),
}));

jest.mock("@/stores/employee-dialog-store", () => ({
  useEmployeeDialogStore: (selector: (state: { setPrefillName: typeof mockSetPrefillName }) => unknown) =>
    selector({ setPrefillName: mockSetPrefillName }),
}));

jest.mock("@/components/app/employees/EmployeeFormDialog", () => ({
  EmployeeFormDialog: ({ open }: { open: boolean }) =>
    open ? <div role="dialog" aria-label="새 제공인력 등록" /> : null,
}));

const employee: Employee = {
  id: 1,
  name: "김제공",
  phone: "010-1111-2222",
  workArea: ["서울"],
  grade: "A",
  openToNextWork: true,
  registeredDate: "2026-01-01",
  status: "available",
};

describe("EmployeeAutocomplete", () => {
  beforeAll(() => {
    global.ResizeObserver = class ResizeObserver {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
    HTMLElement.prototype.scrollIntoView = jest.fn();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockEmployees = [employee];
  });

  it("shows the registration action without listing providers before search", async () => {
    render(
      <EmployeeAutocomplete
        value={null}
        onChange={jest.fn()}
        label="제공인력 1 성함"
        allowManualInput
        manualValue=""
      />
    );

    fireEvent.click(screen.getByRole("combobox", { name: "제공인력 1 성함" }));

    expect(await screen.findByText("일치하는 제공인력이 없습니다.")).toBeInTheDocument();
    expect(document.querySelector('[data-component="desktop_clients_employee-autocomplete_dropdown"]')).toHaveClass(
      "glint-ui-scale-scope",
    );
    expect(screen.queryByText("김제공")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "수동 입력으로 진행" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "새 제공인력 등록" }));
    expect(await screen.findByRole("dialog", { name: "새 제공인력 등록" })).toBeInTheDocument();
  });

  it("shows provider results after typing a search term", async () => {
    render(
      <EmployeeAutocomplete
        value={null}
        onChange={jest.fn()}
        label="제공인력 1 성함"
        allowManualInput
        manualValue=""
      />
    );

    fireEvent.click(screen.getByRole("combobox", { name: "제공인력 1 성함" }));
    expect(await screen.findByRole("combobox", { name: "제공인력 1 성함 검색" })).toBeInTheDocument();
    fireEvent.change(await screen.findByPlaceholderText("이름으로 검색..."), {
      target: { value: "김제공" },
    });

    expect(await screen.findByText("김제공")).toBeInTheDocument();
    expect(screen.getByText("서울 · 010-1111-2222")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "수동 입력으로 진행" })).not.toBeDisabled();
  });

  it("notifies parent while typing a manual provider name", async () => {
    const onChange = jest.fn();
    const onManualInputChange = jest.fn();

    render(
      <EmployeeAutocomplete
        value={null}
        onChange={onChange}
        label="제공인력 1 성함"
        allowManualInput
        manualValue=""
        onManualInputChange={onManualInputChange}
      />
    );

    fireEvent.click(screen.getByRole("combobox", { name: "제공인력 1 성함" }));
    fireEvent.change(await screen.findByPlaceholderText("이름으로 검색..."), {
      target: { value: "홍길동" },
    });

    expect(onManualInputChange).toHaveBeenLastCalledWith("홍길동");
    expect(onChange).not.toHaveBeenCalled();
  });

  it("shows a manually typed provider name in the trigger", () => {
    render(
      <EmployeeAutocomplete
        value={null}
        onChange={jest.fn()}
        label="제공인력 1 성함"
        allowManualInput
        manualValue="홍길동"
      />
    );

    const trigger = screen.getByRole("combobox", { name: "제공인력 1 성함" });
    expect(trigger).toHaveTextContent("홍길동");
    expect(trigger).toHaveClass("h-[calc(38px*var(--glint-ui-scale,1))]");
    expect(trigger).toHaveClass("rounded-[13px]");
    expect(trigger).toHaveClass("border-[1.35px]");
  });

  it("keeps manual typing disabled when an existing employee is selected", async () => {
    const onManualInputChange = jest.fn();

    render(
      <EmployeeAutocomplete
        value={employee.id}
        onChange={jest.fn()}
        label="제공인력 1 성함"
        allowManualInput
        manualValue=""
        onManualInputChange={onManualInputChange}
      />
    );

    fireEvent.click(screen.getByRole("combobox", { name: "제공인력 1 성함" }));
    fireEvent.change(await screen.findByPlaceholderText("이름으로 검색..."), {
      target: { value: "새 이름" },
    });

    expect(onManualInputChange).not.toHaveBeenCalled();
  });

  it("clears the selected provider from the overlay clear button", () => {
    const onChange = jest.fn();
    const onManualInputChange = jest.fn();

    render(
      <EmployeeAutocomplete
        value={employee.id}
        onChange={onChange}
        label="제공인력 1 성함"
        onManualInputChange={onManualInputChange}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "제공인력 선택 해제" }));

    expect(onChange).toHaveBeenCalledWith(null, null);
    expect(onManualInputChange).toHaveBeenCalledWith("");
  });

  it("displays and searches employee phone numbers in phone mode", async () => {
    const onChange = jest.fn();
    const { rerender } = render(
      <EmployeeAutocomplete
        value={null}
        onChange={onChange}
        label="관리사님 전화번호"
        placeholder="관리사님 전화번호 검색"
        displayValueMode="phone"
        searchMode="phone"
      />,
    );

    fireEvent.click(screen.getByRole("combobox", { name: "관리사님 전화번호" }));
    fireEvent.change(
      await screen.findByPlaceholderText("관리사님 전화번호 검색"),
      { target: { value: "1111" } },
    );
    fireEvent.click(await screen.findByText("김제공"));

    expect(onChange).toHaveBeenCalledWith(employee.id, employee);

    rerender(
      <EmployeeAutocomplete
        value={employee.id}
        onChange={onChange}
        label="관리사님 전화번호"
        placeholder="관리사님 전화번호 검색"
        displayValueMode="phone"
        searchMode="phone"
      />,
    );
    expect(
      screen.getByRole("combobox", { name: "관리사님 전화번호" }),
    ).toHaveTextContent("010-1111-2222");
  });
});
