import { render, screen } from "@testing-library/react";

import { MobileDetailActions, MobileDetailSheet, MobileDetailStack } from "../detail-sheet";

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

describe("MobileDetailSheet", () => {
  it("reports the outer reusable implementation instead of exposing a caller-controlled source name", () => {
    const { container } = render(
      <MobileDetailSheet
        data-component="mobile_clients_detail-sheet"
        name="clients"
        isOpen={false}
        onClose={() => undefined}
        list={<div />}
        detail={<div />}
      />,
    );

    expect(
      container.querySelector(
        '[data-component="mobile_clients_detail-sheet"][data-source-component="MobileDetailSheet"]',
      ),
    ).toBeInTheDocument();
  });

  it("keeps the stack implementation identity fixed at its own root", () => {
    const { container } = render(
      <MobileDetailStack
        data-component="mobile_clients_detail-sheet_stack"
        name="clients"
        isOpen={false}
        onClose={() => undefined}
        list={<div />}
      >
        <div />
      </MobileDetailStack>,
    );

    expect(
      container.querySelector(
        '[data-component="mobile_clients_detail-sheet_stack"][data-source-component="MobileDetailStack"]',
      ),
    ).toBeInTheDocument();
  });
});
