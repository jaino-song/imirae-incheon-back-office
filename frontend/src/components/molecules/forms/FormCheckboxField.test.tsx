import { render, screen } from "@testing-library/react";

import { FormCheckboxField } from "./FormCheckboxField";

describe("FormCheckboxField", () => {
  it("should render a native checkbox at the V3 input control height", () => {
    const { container } = render(
      <FormCheckboxField
        name="isActive"
        label="운영 중인 지점"
        defaultChecked
        data-component="desktop_system-admin_sections_branch-form-active"
      />,
    );

    const field = container.querySelector('[data-component="desktop_system-admin_sections_branch-form-active"]');
    const checkbox = screen.getByRole("checkbox", { name: "운영 중인 지점" });

    expect(field).toHaveClass(
      "h-[calc(38px*var(--glint-ui-scale,1))]",
      "min-h-[calc(38px*var(--glint-ui-scale,1))]",
    );
    expect(checkbox).toHaveAttribute("name", "isActive");
    expect(checkbox).toBeChecked();
    expect(checkbox).toHaveAttribute(
      "data-component",
      "desktop_system-admin_sections_branch-form-active-input",
    );
  });
});
