import { fireEvent, render, screen } from "@testing-library/react";

import { ListCardBody } from "../ListCardBody";

describe("ListCardBody", () => {
  it("preserves the scroll body DOM contract", () => {
    const { container } = render(
      <ListCardBody data-component="mobile_tests_list-card_body">
        <p>본문 콘텐츠</p>
      </ListCardBody>,
    );

    expect(container.querySelector('[data-component="mobile_tests_list-card_body"]'))
      .toHaveClass("list-card-scroll");
    expect(screen.getByText("본문 콘텐츠")).toBeInTheDocument();
  });

  it("shows the top fade only after content has scrolled above the viewport", () => {
    const { container } = render(
      <ListCardBody data-component="mobile_tests_list-card_body">
        <p>본문 콘텐츠</p>
      </ListCardBody>,
    );
    const body = container.querySelector(
      '[data-component="mobile_tests_list-card_body"]',
    ) as HTMLDivElement;

    expect(body).not.toHaveClass("has-top-overflow");

    Object.defineProperty(body, "scrollTop", { configurable: true, value: 20 });
    fireEvent.scroll(body);

    expect(body).toHaveClass("has-top-overflow");
  });
});
