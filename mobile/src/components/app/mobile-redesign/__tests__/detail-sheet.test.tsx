import { render, screen } from "@testing-library/react";

import { MobileDetailActions } from "../detail-sheet";

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
