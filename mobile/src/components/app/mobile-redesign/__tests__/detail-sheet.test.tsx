import { render, screen } from "@testing-library/react";

import { MobileDetailActions, MobileDetailSheet } from "../detail-sheet";

describe("MobileDetailSheet", () => {
  it("keeps the selected item title in the sheet header", () => {
    render(
      <MobileDetailSheet
        data-component="mobile_tests_detail-sheet"
        name="clients"
        sheetTitle="고명순"
        isOpen
        onClose={jest.fn()}
        list={<div>목록</div>}
        detail={<div>상세</div>}
      />,
    );

    expect(screen.getByText("고명순")).toHaveClass("sheet-title");
    expect(
      screen.getAllByRole("button", { name: "상세 닫기" })
        .find((button) => button.classList.contains("sheet-close")),
    ).toBeInTheDocument();
  });
});

describe("MobileDetailActions", () => {
  it("disables button actions without a click handler or href", () => {
    const { container } = render(
      <MobileDetailActions data-component="mobile_mobile-redesign_tests_detail-sheet_stack_detail-page_actions"
        name="messages"
        actions={[{ label: "재발송", variant: "secondary" }]}
      />,
    );

    expect(screen.getByRole("button", { name: "재발송" })).toBeDisabled();
    expect(
      container.querySelector(
        '[data-component="mobile_mobile-redesign_tests_detail-sheet_stack_detail-page_actions"][data-source-component="MobileDetailActions"]',
      ),
    ).toBeInTheDocument();
    expect(
      container.querySelector(
        '[data-component="mobile_mobile-redesign_tests_detail-sheet_stack_detail-page_actions_action-1"]',
      ),
    ).toBeDisabled();
  });
});
