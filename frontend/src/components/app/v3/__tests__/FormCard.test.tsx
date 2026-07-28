import { render, screen } from "@testing-library/react";

import { FormCard } from "../FormCard";

describe("FormCard", () => {
  it("renders form content with an outlined transparent surface", () => {
    const { container } = render(
      <FormCard data-component="desktop_v3_tests_form-card" title="기본 정보" description="지점 정보를 입력해 주세요.">
        <div>폼 내용</div>
      </FormCard>,
    );

    const card = container.querySelector('[data-component="desktop_v3_tests_form-card"]');

    expect(card).toHaveClass("border", "border-v3-border", "bg-transparent");
    expect(card).not.toHaveClass("bg-white", "bg-v3-dim-white");
    expect(container.querySelector('[data-component="desktop_v3_tests_form-card_head"]')).toBeInTheDocument();
    expect(container.querySelector('[data-component="desktop_v3_tests_form-card_body"]')).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "기본 정보" })).toBeInTheDocument();
    expect(screen.getByText("폼 내용")).toBeInTheDocument();
  });
});
