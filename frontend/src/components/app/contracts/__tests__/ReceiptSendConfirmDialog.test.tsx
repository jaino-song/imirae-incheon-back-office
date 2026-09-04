import { fireEvent, render, screen } from "@testing-library/react";
import { ReceiptSendConfirmDialog } from "../ReceiptSendConfirmDialog";

describe("ReceiptSendConfirmDialog", () => {
  it("renders the customer name in the confirmation copy", () => {
    render(
      <ReceiptSendConfirmDialog
        open
        customerName="김산모"
        isPending={false}
        onConfirm={jest.fn()}
        onOpenChange={jest.fn()}
        dataComponent="desktop_contracts"
      />,
    );

    expect(screen.getByText(/김산모 산모님께/)).toBeInTheDocument();
  });

  it("calls onConfirm exactly once when the confirm button is clicked", () => {
    const onConfirm = jest.fn();
    render(
      <ReceiptSendConfirmDialog
        open
        customerName="김산모"
        isPending={false}
        onConfirm={onConfirm}
        onOpenChange={jest.fn()}
        dataComponent="desktop_contracts"
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "발송하기" }));

    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("does not call onConfirm when cancel is clicked", () => {
    const onConfirm = jest.fn();
    const onOpenChange = jest.fn();
    render(
      <ReceiptSendConfirmDialog
        open
        customerName="김산모"
        isPending={false}
        onConfirm={onConfirm}
        onOpenChange={onOpenChange}
        dataComponent="desktop_contracts"
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "취소" }));

    expect(onConfirm).not.toHaveBeenCalled();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("disables the confirm button and shows the pending label while sending", () => {
    render(
      <ReceiptSendConfirmDialog
        open
        customerName="김산모"
        isPending
        onConfirm={jest.fn()}
        onOpenChange={jest.fn()}
        dataComponent="desktop_contracts"
      />,
    );

    expect(screen.getByRole("button", { name: "발송 예약 중…" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "취소" })).toBeDisabled();
  });

  it("does not emit onOpenChange(false) for escape while a send is pending", () => {
    const onOpenChange = jest.fn();
    render(
      <ReceiptSendConfirmDialog
        open
        customerName="김산모"
        isPending
        onConfirm={jest.fn()}
        onOpenChange={onOpenChange}
        dataComponent="desktop_contracts"
      />,
    );

    fireEvent.keyDown(document, { key: "Escape", code: "Escape" });

    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it("emits onOpenChange(false) for escape when not pending", () => {
    const onOpenChange = jest.fn();
    render(
      <ReceiptSendConfirmDialog
        open
        customerName="김산모"
        isPending={false}
        onConfirm={jest.fn()}
        onOpenChange={onOpenChange}
        dataComponent="desktop_contracts"
      />,
    );

    fireEvent.keyDown(document, { key: "Escape", code: "Escape" });

    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("scopes the confirm submit button to the dialog's data-component", () => {
    render(
      <ReceiptSendConfirmDialog
        open
        customerName="김산모"
        isPending={false}
        onConfirm={jest.fn()}
        onOpenChange={jest.fn()}
        dataComponent="desktop_contracts"
      />,
    );

    expect(document.querySelector('[data-component="desktop_contracts_dialogs_receipt-send-confirm"]')).not.toBeNull();
    expect(screen.getByRole("button", { name: "발송하기" })).toHaveAttribute(
      "data-component",
      "desktop_contracts_dialogs_receipt-send-confirm_submit",
    );
  });

  it("renders the unknown-customer fallback copy when customerName is empty", () => {
    render(
      <ReceiptSendConfirmDialog
        open
        customerName=""
        isPending={false}
        onConfirm={jest.fn()}
        onOpenChange={jest.fn()}
        dataComponent="desktop_contracts"
      />,
    );

    expect(screen.queryByText(/산모님께/)).not.toBeInTheDocument();
    expect(screen.getByText(/본인부담금 영수증 링크가 담긴 문자를 1분 내 발송합니다/)).toBeInTheDocument();
  });
});
