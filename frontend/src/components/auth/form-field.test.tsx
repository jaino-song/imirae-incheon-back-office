import * as React from "react";
import { render, screen } from "@testing-library/react";
import { FormField } from "./form-field";

describe("FormField", () => {
  it("renders inline errors in the label row", () => {
    render(
      <FormField
        label="비밀번호 확인"
        value="mismatch"
        onChange={() => {}}
        error="비밀번호가 일치하지 않습니다."
        errorDisplay="inline"
      />
    );

    const inlineError = screen.getByText("비밀번호가 일치하지 않습니다.");

    expect(inlineError.tagName).toBe("SPAN");
    expect(inlineError).toHaveClass("inline-flex");
    expect(document.querySelector('[data-component="desktop_auth_form-field_label-row_trailing"]')).toBeTruthy();
    expect(document.querySelector("p#비밀번호-확인-error")).toBeNull();
  });

  it("reserves trailing space for inline errors even before they appear", () => {
    render(
      <FormField
        label="이메일"
        value=""
        onChange={() => {}}
        errorDisplay="inline"
      />
    );

    const trailingSlot = document.querySelector('[data-component="desktop_auth_form-field_label-row_trailing"]');

    expect(trailingSlot).toBeTruthy();
    expect(trailingSlot?.textContent).toContain("\u00A0");
    expect(document.querySelector("#이메일-error")).toBeNull();
  });

  it("keeps below-field errors for the default mode", () => {
    render(
      <FormField
        label="이메일"
        value=""
        onChange={() => {}}
        error="이메일은 필수입니다."
      />
    );

    const helperText = screen.getByText("이메일은 필수입니다.");

    expect(helperText.tagName).toBe("P");
    expect(helperText).toHaveClass("text-sm");
  });
});
