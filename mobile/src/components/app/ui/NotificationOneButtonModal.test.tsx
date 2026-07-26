import { fireEvent, render, screen } from "@testing-library/react";

import { NotificationOneButtonModal } from "./NotificationOneButtonModal";

describe("NotificationOneButtonModal", () => {
  it("renders one full-width acknowledgement action", () => {
    const handleAcknowledge = jest.fn();

    render(
      <NotificationOneButtonModal
        data-component="mobile_tests_notification-modal_default"
        open
        onOpenChange={jest.fn()}
        title="요청을 완료하지 못했습니다."
        description="잠시 후 다시 시도해 주세요."
        isDescriptionVisuallyHidden={false}
        onAcknowledge={handleAcknowledge}
      />,
    );

    const dialog = screen.getByRole("dialog", { name: "요청을 완료하지 못했습니다." });
    const button = screen.getByRole("button", { name: "확인" });

    expect(dialog).toHaveAttribute("data-component", "mobile_tests_notification-modal_default");
    expect(screen.getAllByRole("button")).toHaveLength(1);
    expect(button).toHaveClass("w-full");

    fireEvent.click(button);
    expect(handleAcknowledge).toHaveBeenCalledTimes(1);
  });
});
