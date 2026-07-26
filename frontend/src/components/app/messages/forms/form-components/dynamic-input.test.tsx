import { render, screen } from "@testing-library/react";

import type { TemplateVariable } from "@/lib/template/types";

import { DynamicInput } from "./dynamic-input";

function variable(overrides: Partial<TemplateVariable> & Pick<TemplateVariable, "type">): TemplateVariable {
  return { key: "field", label: "필드", required: false, ...overrides };
}

describe("DynamicInput", () => {
  it("renders the resolved field directly, without an extra pass-through wrapper", () => {
    const { container } = render(
      <DynamicInput variable={variable({ type: "date", label: "시작일" })} value="" onChange={() => {}} />,
    );

    // The field's own annotated element renders…
    const field = container.querySelector('[data-component="desktop_messages_sections_form-date-input"]');
    expect(field).toBeInTheDocument();
    expect(screen.getByText("시작일")).toBeInTheDocument();

    // …and is the rendered root: the removed `messages-form-dynamic-input` wrapper is gone.
    expect(container.querySelector('[data-component="desktop_messages_sections_form-dynamic-input"]')).not.toBeInTheDocument();
    expect(container.firstChild).toBe(field);
  });

  it("returns the field child directly across field-type branches", () => {
    const number = render(
      <DynamicInput variable={variable({ type: "number" })} value="" onChange={() => {}} />,
    );
    expect(number.container.querySelector('[data-component="desktop_messages_sections_form-number-input"]')).toBeInTheDocument();
    expect(number.container.querySelector('[data-component="desktop_messages_sections_form-dynamic-input"]')).not.toBeInTheDocument();

    const textarea = render(
      <DynamicInput variable={variable({ type: "textarea" })} value="" onChange={() => {}} />,
    );
    expect(textarea.container.querySelector('[data-component="desktop_messages_sections_form-textarea"]')).toBeInTheDocument();
    expect(textarea.container.querySelector('[data-component="desktop_messages_sections_form-dynamic-input"]')).not.toBeInTheDocument();
  });
});
