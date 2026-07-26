import * as React from "react";
import { render, screen } from "@testing-library/react";
import { SelectField } from "./select-field";

describe("SelectField", () => {
  it("renders inline errors in the label row", () => {
    render(
      <SelectField
        label="역할"
        value=""
        onValueChange={() => {}}
        options={[{ value: "user", label: "일반 사용자" }]}
        error="역할을 선택해주세요."
        errorDisplay="inline"
      />
    );

    const inlineError = screen.getByText("역할을 선택해주세요.");

    expect(inlineError.tagName).toBe("SPAN");
    expect(inlineError).toHaveClass("inline-flex");
    expect(document.querySelector('[data-component="desktop_auth_form-field_label-row_trailing"]')).toBeTruthy();
    expect(document.querySelector("p#역할-error")).toBeNull();
  });

  it("reserves trailing space for inline errors even before they appear", () => {
    render(
      <SelectField
        label="역할"
        value=""
        onValueChange={() => {}}
        options={[{ value: "user", label: "일반 사용자" }]}
        errorDisplay="inline"
      />
    );

    const trailingSlot = document.querySelector('[data-component="desktop_auth_form-field_label-row_trailing"]');

    expect(trailingSlot).toBeTruthy();
    expect(trailingSlot?.textContent).toContain("\u00A0");
    expect(document.querySelector("#역할-error")).toBeNull();
  });
});
