import { render, screen } from "@testing-library/react";

import { MobileTwoButtonModal } from "./MobileTwoButtonModal";

describe("MobileTwoButtonModal", () => {
  it("uses the shared left-aligned 16px/14px header and renders form content", () => {
    render(
      <MobileTwoButtonModal
        open
        title="서비스 일정 변경"
        description="3회차 서비스 제공 날짜를 조정합니다."
        cancelLabel="취소"
        confirmLabel="일정 변경"
        loading
        confirmDisabled
        onOpenChange={jest.fn()}
        onCancel={jest.fn()}
        onConfirm={jest.fn()}
      >
        <label htmlFor="service-date">3회차 서비스 제공 날짜</label>
        <input id="service-date" type="date" />
      </MobileTwoButtonModal>,
    );

    expect(screen.getByTestId("mobile-two-button-modal-header")).toHaveClass("gap-1", "text-left");
    expect(screen.getByText("서비스 일정 변경")).toHaveClass("text-base");
    expect(screen.getByText("3회차 서비스 제공 날짜를 조정합니다.")).toHaveClass("text-sm", "leading-5");
    expect(screen.getByLabelText("3회차 서비스 제공 날짜")).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toHaveAttribute("aria-busy", "true");
    expect(screen.getByRole("button", { name: "일정 변경" })).toBeDisabled();
  });

  it("forwards the caller context and keeps the source component identity", () => {
    render(
      <MobileTwoButtonModal
        data-component="mobile_contracts-new_confirmation_modal"
        open
        title="계약서 재생성 확인"
        description="새 계약서를 생성합니다."
        cancelLabel="취소"
        confirmLabel="생성"
        onOpenChange={jest.fn()}
        onCancel={jest.fn()}
        onConfirm={jest.fn()}
      />,
    );

    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveAttribute("data-component", "mobile_contracts-new_confirmation_modal");
    expect(dialog).toHaveAttribute("data-source-component", "MobileTwoButtonModal");
    expect(screen.getByText("계약서 재생성 확인")).toHaveAttribute(
      "data-component",
      "mobile_contracts-new_confirmation_modal_title",
    );
    expect(screen.getByRole("button", { name: "생성" })).toHaveAttribute(
      "data-component",
      "mobile_contracts-new_confirmation_modal_confirm-button",
    );
  });
});
