import { fireEvent, render, screen } from "@testing-library/react";

import type { Client } from "@/lib/client/types";
import {
  ContractClientSelector,
  hasExistingContractDocument,
} from "../ContractClientSelector";

const mockExistingClient: Client = {
  id: 55,
  name: "송진호",
  createdAt: "2026-01-01",
  birthday: "960201",
  dueDate: "2026-06-10",
  birthDate: null,
  address: "경기도 고양시",
  phone: "01066211878",
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
  eDocId: "document-55",
  hasSigned: false,
  documentStatus: "created",
};

const mockNewClient: Client = {
  ...mockExistingClient,
  id: 56,
  name: "신규 고객",
  eDocId: null,
  documentStatus: null,
};

jest.mock("@/components/app/clients/ClientAutocomplete", () => ({
  ClientAutocomplete: ({
    onChange,
  }: {
    onChange: (clientId: number | null, client: Client | null) => void;
  }) => (
    <div>
      <button
        type="button"
        onClick={() => onChange(mockExistingClient.id, mockExistingClient)}
      >
        계약 이력 고객 선택
      </button>
      <button
        type="button"
        onClick={() => onChange(mockNewClient.id, mockNewClient)}
      >
        신규 고객 선택
      </button>
    </div>
  ),
}));

const selectorProps = {
  value: null,
  label: "산모님 성함",
  manualValue: "",
};

describe("ContractClientSelector", () => {
  it("requires confirmation before applying a client with a generated contract", () => {
    const onChange = jest.fn();
    render(<ContractClientSelector {...selectorProps} onChange={onChange} />);

    fireEvent.click(screen.getByRole("button", { name: "계약 이력 고객 선택" }));

    const dialog = screen.getByRole("dialog");
    const cancelButton = screen.getByRole("button", { name: "취소" });
    const continueButton = screen.getByRole("button", { name: "계속" });

    expect(
      screen.getByRole("heading", {
        name: "이미 계약서를 전송한 기록이 있습니다. 새로 생성하시겠어요?",
      }),
    ).toBeInTheDocument();
    expect(dialog).toHaveClass("aspect-[5/3]", "sm:max-w-[300px]");
    expect(cancelButton).toHaveClass("w-1/2");
    expect(continueButton).toHaveClass("w-1/2");
    expect(onChange).not.toHaveBeenCalled();

    fireEvent.click(cancelButton);

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "계약 이력 고객 선택" }));
    fireEvent.click(screen.getByRole("button", { name: "계속" }));

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(
      mockExistingClient.id,
      mockExistingClient,
    );
  });

  it("applies a client without a contract immediately", () => {
    const onChange = jest.fn();
    render(<ContractClientSelector {...selectorProps} onChange={onChange} />);

    fireEvent.click(screen.getByRole("button", { name: "신규 고객 선택" }));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(onChange).toHaveBeenCalledWith(mockNewClient.id, mockNewClient);
  });

  it("recognizes contract history from either the document id or status", () => {
    expect(hasExistingContractDocument(mockExistingClient)).toBe(true);
    expect(
      hasExistingContractDocument({
        ...mockExistingClient,
        eDocId: null,
        documentStatus: "opened",
      }),
    ).toBe(true);
    expect(hasExistingContractDocument(mockNewClient)).toBe(false);
  });
});
