import { render, screen } from "@testing-library/react";

import { TemplateFieldGrid, TemplateFieldGridItem } from "./TemplateFieldGrid";

describe("TemplateFieldGrid", () => {
  it("renders reusable non-expanding template field tracks", () => {
    render(
      <TemplateFieldGrid>
        <TemplateFieldGridItem>
          <label htmlFor="field-one">Field one</label>
          <input id="field-one" />
        </TemplateFieldGridItem>
        <TemplateFieldGridItem>
          <label htmlFor="field-two">Field two</label>
          <input id="field-two" />
        </TemplateFieldGridItem>
      </TemplateFieldGrid>
    );

    const grid = screen.getByText("Field one").closest("[data-component='desktop_messages_sections_template-field-grid']");
    const item = screen.getByText("Field two").closest("[data-component='desktop_messages_sections_template-field-grid-item']");

    expect(grid?.getAttribute("class")).toContain("grid-cols-[repeat(auto-fill");
    expect(grid).toHaveClass("items-center");
    expect(item).toHaveClass("min-w-0", "space-y-2");
  });
});
