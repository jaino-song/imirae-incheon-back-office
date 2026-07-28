import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import { ClientAutocomplete } from "../ClientAutocomplete";
import type { Client } from "@/lib/client/types";

let mockClients: Client[] = [];
const mockSetPrefillName = jest.fn();

jest.mock("@/hooks/useClients", () => ({
  useAllClients: () => ({
    data: mockClients,
    isLoading: false,
  }),
}));

jest.mock("@/stores/client-dialog-store", () => ({
  useClientDialogStore: (selector: (state: { setPrefillName: typeof mockSetPrefillName }) => unknown) =>
    selector({ setPrefillName: mockSetPrefillName }),
}));

jest.mock("../ClientFormDialog", () => ({
  ClientFormDialog: ({ open }: { open: boolean }) =>
    open ? <div role="dialog" aria-label="새 고객 등록" /> : null,
}));

const client: Client = {
  id: 1,
  name: "송진호",
  createdAt: "2026-01-01",
  birthday: "960201",
  dueDate: "2026-06-10",
  address: "인천시 서구",
  phone: "010-6621-1878",
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
  serviceStatus: null,
  eDocId: null,
  hasSigned: false,
  documentStatus: null,
};

describe("ClientAutocomplete", () => {
  beforeAll(() => {
    class ResizeObserverMock {
      observe = jest.fn();
      unobserve = jest.fn();
      disconnect = jest.fn();
    }

    global.ResizeObserver = ResizeObserverMock;
    Element.prototype.scrollIntoView = jest.fn();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockClients = [client];
  });

  it("shows the registration action without listing clients before search", async () => {
    render(
      <ClientAutocomplete
        value={null}
        onChange={jest.fn()}
        label="고객 선택"
      />
    );

    fireEvent.click(screen.getByRole("combobox", { name: "고객 선택" }));

    expect(screen.queryByText("송진호")).not.toBeInTheDocument();
    expect(document.querySelector('[data-component="desktop_clients_autocomplete_dropdown"]')).toHaveClass(
      "glint-ui-scale-scope",
    );
    fireEvent.click(await screen.findByRole("button", { name: "새 고객 등록" }));
    expect(await screen.findByRole("dialog", { name: "새 고객 등록" })).toBeInTheDocument();
  });

  it("renders the trigger with the shared compact input shape", async () => {
    render(
      <ClientAutocomplete
        value={client.id}
        onChange={jest.fn()}
        label="고객 선택"
      />
    );

    const trigger = screen.getByRole("combobox");
    await waitFor(() => expect(trigger).toHaveTextContent("송진호"));
    expect(trigger).toHaveClass("h-[calc(38px*var(--glint-ui-scale,1))]");
    expect(trigger).toHaveClass("rounded-[13px]");
    expect(trigger).toHaveClass("border-[1.35px]");
    expect(trigger).toHaveClass("text-v3-dark");
  });

  it("clears the selected client from the overlay clear button", async () => {
    const onChange = jest.fn();

    render(
      <ClientAutocomplete
        value={client.id}
        onChange={onChange}
        label="고객 선택"
      />
    );

    await waitFor(() => expect(screen.getByRole("combobox")).toHaveTextContent("송진호"));
    fireEvent.click(screen.getByRole("button", { name: "고객 선택 해제" }));

    expect(onChange).toHaveBeenCalledWith(null, null);
  });

  it("uses typed search text as the inline manual name when enabled", () => {
    const onManualValueChange = jest.fn();

    const { rerender } = render(
      <ClientAutocomplete
        value={null}
        onChange={jest.fn()}
        label="고객 선택"
        manualValue=""
        onManualValueChange={onManualValueChange}
      />
    );

    const trigger = screen.getByRole("combobox");
    fireEvent.click(trigger);
    fireEvent.change(screen.getByPlaceholderText("이름, 연락처 또는 주소로 검색"), {
      target: { value: "김산모" },
    });

    expect(onManualValueChange).toHaveBeenCalledWith("김산모");
    rerender(
      <ClientAutocomplete
        value={null}
        onChange={jest.fn()}
        label="고객 선택"
        manualValue="김산모"
        onManualValueChange={onManualValueChange}
      />
    );
    expect(trigger).toHaveTextContent("김산모");
  });

  it("keeps typed search text out of the trigger for selection-only usage", () => {
    render(
      <ClientAutocomplete
        value={null}
        onChange={jest.fn()}
        label="고객 선택"
      />
    );

    const trigger = screen.getByRole("combobox");
    fireEvent.click(trigger);
    fireEvent.change(screen.getByPlaceholderText("이름, 연락처 또는 주소로 검색"), {
      target: { value: "김산모" },
    });

    expect(trigger).toHaveTextContent("이름, 연락처 또는 주소로 검색");
    expect(trigger).not.toHaveTextContent("김산모");
  });

  it("clears the selected client before switching to inline manual typing", async () => {
    const onChange = jest.fn();
    const onManualValueChange = jest.fn();

    render(
      <ClientAutocomplete
        value={client.id}
        onChange={onChange}
        label="고객 선택"
        manualValue=""
        onManualValueChange={onManualValueChange}
      />
    );

    const trigger = screen.getByRole("combobox");
    await waitFor(() => expect(trigger).toHaveTextContent("송진호"));
    fireEvent.click(trigger);
    fireEvent.change(screen.getByPlaceholderText("이름, 연락처 또는 주소로 검색"), {
      target: { value: "김산모" },
    });

    expect(onChange).toHaveBeenCalledWith(null, null);
    expect(onManualValueChange).toHaveBeenCalledWith("김산모");
  });

  it("commits typed text as manual input on Enter without selecting the highlighted client", async () => {
    const onChange = jest.fn();
    const onManualValueChange = jest.fn();

    const { rerender } = render(
      <ClientAutocomplete
        value={null}
        onChange={onChange}
        label="고객 선택"
        manualValue=""
        onManualValueChange={onManualValueChange}
      />
    );

    const trigger = screen.getByRole("combobox");
    fireEvent.click(trigger);
    fireEvent.change(screen.getByPlaceholderText("이름, 연락처 또는 주소로 검색"), {
      target: { value: "송진호" },
    });
    rerender(
      <ClientAutocomplete
        value={null}
        onChange={onChange}
        label="고객 선택"
        manualValue="송진호"
        onManualValueChange={onManualValueChange}
      />
    );

    fireEvent.keyDown(screen.getByPlaceholderText("이름, 연락처 또는 주소로 검색"), {
      key: "Enter",
      code: "Enter",
    });

    expect(onChange).not.toHaveBeenCalled();
    expect(onManualValueChange).toHaveBeenLastCalledWith("송진호");
    await waitFor(() => {
      expect(screen.queryByPlaceholderText("이름, 연락처 또는 주소로 검색")).not.toBeInTheDocument();
    });
  });

  it("commits typed text as manual input from the inline progress button", async () => {
    const onChange = jest.fn();
    const onManualValueChange = jest.fn();

    const { rerender } = render(
      <ClientAutocomplete
        value={null}
        onChange={onChange}
        label="고객 선택"
        manualValue=""
        onManualValueChange={onManualValueChange}
      />
    );

    const trigger = screen.getByRole("combobox");
    fireEvent.click(trigger);
    fireEvent.change(screen.getByPlaceholderText("이름, 연락처 또는 주소로 검색"), {
      target: { value: "송진호" },
    });
    rerender(
      <ClientAutocomplete
        value={null}
        onChange={onChange}
        label="고객 선택"
        manualValue="송진호"
        onManualValueChange={onManualValueChange}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "수동 입력으로 진행" }));

    expect(onChange).not.toHaveBeenCalled();
    expect(onManualValueChange).toHaveBeenLastCalledWith("송진호");
    await waitFor(() => {
      expect(screen.queryByPlaceholderText("이름, 연락처 또는 주소로 검색")).not.toBeInTheDocument();
    });
  });

  it("searches and displays by phone when configured for phone mode", async () => {
    const onChange = jest.fn();

    const { rerender } = render(
      <ClientAutocomplete
        value={null}
        onChange={onChange}
        label="휴대 전화번호"
        placeholder="연락처 검색 또는 직접 입력"
        manualValue=""
        onManualValueChange={jest.fn()}
        displayValueMode="phone"
        searchMode="phone"
      />
    );

    const trigger = screen.getByRole("combobox");
    fireEvent.click(trigger);
    fireEvent.change(screen.getByPlaceholderText("연락처 검색 또는 직접 입력"), {
      target: { value: "송진호" },
    });
    rerender(
      <ClientAutocomplete
        value={null}
        onChange={onChange}
        label="휴대 전화번호"
        placeholder="연락처 검색 또는 직접 입력"
        manualValue="송진호"
        onManualValueChange={jest.fn()}
        displayValueMode="phone"
        searchMode="phone"
      />
    );

    expect(screen.queryByText("010-6621-1878")).not.toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText("연락처 검색 또는 직접 입력"), {
      target: { value: "6621" },
    });
    rerender(
      <ClientAutocomplete
        value={null}
        onChange={onChange}
        label="휴대 전화번호"
        placeholder="연락처 검색 또는 직접 입력"
        manualValue="6621"
        onManualValueChange={jest.fn()}
        displayValueMode="phone"
        searchMode="phone"
      />
    );
    fireEvent.click(screen.getByText("송진호"));

    expect(onChange).toHaveBeenCalledWith(client.id, client);
    rerender(
      <ClientAutocomplete
        value={client.id}
        onChange={onChange}
        label="휴대 전화번호"
        placeholder="연락처 검색 또는 직접 입력"
        manualValue=""
        onManualValueChange={jest.fn()}
        displayValueMode="phone"
        searchMode="phone"
      />
    );
    expect(trigger).toHaveTextContent("010-6621-1878");
  });

  it("selects the exact phone match on Enter in phone mode", () => {
    const onChange = jest.fn();
    const onManualValueChange = jest.fn();

    const { rerender } = render(
      <ClientAutocomplete
        value={null}
        onChange={onChange}
        label="휴대 전화번호"
        placeholder="연락처 검색 또는 직접 입력"
        manualValue=""
        onManualValueChange={onManualValueChange}
        displayValueMode="phone"
        searchMode="phone"
      />
    );

    fireEvent.click(screen.getByRole("combobox"));
    fireEvent.change(screen.getByPlaceholderText("연락처 검색 또는 직접 입력"), {
      target: { value: "01066211878" },
    });
    rerender(
      <ClientAutocomplete
        value={null}
        onChange={onChange}
        label="휴대 전화번호"
        placeholder="연락처 검색 또는 직접 입력"
        manualValue="01066211878"
        onManualValueChange={onManualValueChange}
        displayValueMode="phone"
        searchMode="phone"
      />
    );

    expect(screen.getByPlaceholderText("연락처 검색 또는 직접 입력")).toHaveValue("010-6621-1878");
    expect(screen.getByText("010-6621-1878 · 인천시 서구")).toBeInTheDocument();

    fireEvent.keyDown(screen.getByPlaceholderText("연락처 검색 또는 직접 입력"), {
      key: "Enter",
      code: "Enter",
    });

    expect(onChange).toHaveBeenCalledWith(client.id, client);
  });
});
