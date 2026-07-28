import { fireEvent, render, screen } from "@testing-library/react";

import { NotificationOneButtonModal } from "./NotificationOneButtonModal";

describe("NotificationOneButtonModal", () => {
  it("renders one full-width acknowledgement action", () => {
    const handleOpenChange = jest.fn();
    const handleAcknowledge = jest.fn();

    render(
      <NotificationOneButtonModal
        open
        onOpenChange={handleOpenChange}
        title="메시지가 복사되었습니다."
        description="복사한 내용을 붙여넣을 수 있습니다."
        isDescriptionVisuallyHidden={false}
        onAcknowledge={handleAcknowledge}
      />,
    );

    const dialog = screen.getByRole("dialog", { name: "메시지가 복사되었습니다." });
    const button = screen.getByRole("button", { name: "확인" });

    expect(dialog).toHaveAttribute("data-component", "desktop_v3_notification-one-button-modal");
    expect(dialog).toHaveClass("aspect-[5/3]", "sm:max-w-[300px]");
    expect(screen.getAllByRole("button")).toHaveLength(1);
    expect(button).toHaveClass("w-full");

    fireEvent.click(button);
    expect(handleAcknowledge).toHaveBeenCalledTimes(1);
    expect(handleOpenChange).not.toHaveBeenCalled();
  });
});
