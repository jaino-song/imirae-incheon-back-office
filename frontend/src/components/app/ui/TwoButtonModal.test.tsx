import { fireEvent, render, screen } from "@testing-library/react";

import { TwoButtonModal } from "./TwoButtonModal";

describe("TwoButtonModal", () => {
  it("renders the standard compact approval design and actions", () => {
    const handleOpenChange = jest.fn();
    const handleApprove = jest.fn();

    render(
      <TwoButtonModal
        open
        onOpenChange={handleOpenChange}
        title="직원을 삭제하시겠습니까?"
        description="삭제한 직원 정보는 복구할 수 없습니다."
        approvalLabel="삭제"
        approvalVariant="destructive"
        onApprove={handleApprove}
        dataComponent="desktop_employees_delete-approval"
      />,
    );

    const dialog = screen.getByRole("dialog");
    const header = dialog.querySelector('[data-slot="dialog-header"]');
    const title = screen.getByText("직원을 삭제하시겠습니까?");
    const description = screen.getByText("삭제한 직원 정보는 복구할 수 없습니다.");
    const cancelButton = screen.getByRole("button", { name: "취소" });
    const approvalButton = screen.getByRole("button", { name: "삭제" });

    expect(dialog).toHaveAttribute("data-component", "desktop_employees_delete-approval");
    expect(dialog).toHaveClass("aspect-[5/3]", "sm:max-w-[300px]");
    expect(header).toHaveClass("gap-1");
    expect(header).not.toHaveClass("gap-2");
    expect(header).toHaveClass("text-left", "sm:text-left");
    expect(header).not.toHaveClass("text-center", "sm:text-center");
    expect(title).toHaveClass(
      "text-center",
      "text-[calc(16px*var(--v3-ui-scale,1))]",
      "leading-[calc(24px*var(--v3-ui-scale,1))]",
    );
    expect(description).toHaveClass("sr-only");
    expect(description).toHaveClass(
      "text-[calc(14px*var(--v3-ui-scale,1))]",
      "leading-[calc(20px*var(--v3-ui-scale,1))]",
    );
    expect(description).toHaveClass("mt-0");
    expect(description).not.toHaveClass("mt-[calc(6px*var(--glint-ui-scale,1))]");
    expect(cancelButton).toHaveClass("w-1/2");
    expect(cancelButton).toHaveAttribute("data-variant", "neutral");
    expect(approvalButton).toHaveClass("w-1/2");
    expect(approvalButton).toHaveAttribute("data-variant", "destructive");

    fireEvent.click(cancelButton);
    expect(handleOpenChange).toHaveBeenCalledWith(false);

    fireEvent.click(approvalButton);
    expect(handleApprove).toHaveBeenCalledTimes(1);
  });

  it("locks both actions and shows the pending label while approving", () => {
    const handleOpenChange = jest.fn();
    const handleApprove = jest.fn();

    render(
      <TwoButtonModal
        open
        onOpenChange={handleOpenChange}
        title="문서를 삭제하시겠습니까?"
        description="삭제 중에는 창을 닫을 수 없습니다."
        approvalLabel="삭제"
        pendingLabel="삭제 중..."
        isPending
        onApprove={handleApprove}
      />,
    );

    expect(screen.getByRole("button", { name: "취소" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "삭제 중..." })).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "삭제 중..." }));
    expect(handleApprove).not.toHaveBeenCalled();
    expect(handleOpenChange).not.toHaveBeenCalled();
  });

  it("supports a review body without changing the shared action layout", () => {
    render(
      <TwoButtonModal
        open
        size="detail"
        onOpenChange={jest.fn()}
        title="중복 전송 확인"
        description="최근 같은 메시지를 보낸 기록이 있습니다."
        isDescriptionVisuallyHidden={false}
        approvalLabel="전송"
        onApprove={jest.fn()}
      >
        <div data-testid="review-body">최근 전송 내역</div>
      </TwoButtonModal>,
    );

    expect(screen.getByRole("dialog")).toHaveClass("sm:max-w-[420px]");
    expect(screen.getByText("최근 같은 메시지를 보낸 기록이 있습니다.")).not.toHaveClass("sr-only");
    expect(screen.getByTestId("review-body")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "전송" })).toHaveClass("w-1/2");
  });
});
