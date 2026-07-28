import { fireEvent, render, screen } from "@testing-library/react";

import { ApprovalTwoButtonModal } from "./ApprovalTwoButtonModal";

describe("ApprovalTwoButtonModal", () => {
  it("renders the standard mobile approval actions and closes from either action", () => {
    const handleOpenChange = jest.fn();
    const handleApprove = jest.fn();

    render(
      <ApprovalTwoButtonModal
        data-component="mobile_tests_approval-modal_default"
        open
        onOpenChange={handleOpenChange}
        title="요청을 완료하지 못했습니다."
        description="잠시 후 다시 시도해 주세요."
        isDescriptionVisuallyHidden={false}
        cancelLabel="닫기"
        approvalLabel="확인"
        onApprove={handleApprove}
      />,
    );

    const dialog = screen.getByRole("dialog", { name: "요청을 완료하지 못했습니다." });
    expect(dialog).toHaveAttribute("data-component", "mobile_tests_approval-modal_default");
    expect(dialog).toHaveClass(
      "w-[calc(min(100vw,390px)-2rem)]",
      "max-w-[358px]",
      "rounded-[24px]",
    );
    expect(screen.getByText("잠시 후 다시 시도해 주세요.")).not.toHaveClass("sr-only");
    expect(screen.getByRole("button", { name: "닫기" })).toHaveClass("h-11", "text-sm");

    fireEvent.click(screen.getByRole("button", { name: "닫기" }));
    expect(handleOpenChange).toHaveBeenCalledWith(false);

    fireEvent.click(screen.getByRole("button", { name: "확인" }));
    expect(handleApprove).toHaveBeenCalledTimes(1);
  });

  it("locks both actions while approval is pending", () => {
    render(
      <ApprovalTwoButtonModal
        data-component="mobile_tests_approval-modal_pending"
        open
        onOpenChange={jest.fn()}
        title="계약서를 생성하고 있습니다."
        description="잠시만 기다려 주세요."
        approvalLabel="확인"
        pendingLabel="처리 중..."
        isPending
        onApprove={jest.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: "취소" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "처리 중..." })).toBeDisabled();
  });

  it("uses the shared detail typography and renders modal body content", () => {
    render(
      <ApprovalTwoButtonModal
        data-component="mobile_tests_approval-modal_detail"
        open
        onOpenChange={jest.fn()}
        title="서비스 일정 변경"
        description="3회차 서비스 제공 날짜를 조정합니다."
        isDescriptionVisuallyHidden={false}
        size="detail"
        approvalLabel="일정 변경"
        onApprove={jest.fn()}
      >
        <label htmlFor="schedule-date">3회차 서비스 제공 날짜</label>
        <input id="schedule-date" type="date" />
      </ApprovalTwoButtonModal>,
    );

    expect(screen.getByText("서비스 일정 변경")).toHaveClass("text-left");
    expect(screen.getByText("서비스 일정 변경")).toHaveClass(
      "text-[calc(16px*var(--v3-ui-scale,1))]",
    );
    expect(screen.getByText("3회차 서비스 제공 날짜를 조정합니다.")).toHaveClass("mt-0");
    expect(screen.getByLabelText("3회차 서비스 제공 날짜")).toBeInTheDocument();
  });
});
