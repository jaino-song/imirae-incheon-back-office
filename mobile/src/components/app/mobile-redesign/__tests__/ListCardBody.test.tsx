import { render, screen } from "@testing-library/react";

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
});
