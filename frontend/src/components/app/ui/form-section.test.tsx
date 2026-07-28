import { render } from "@testing-library/react";

import { FormGrid } from "./form-section";

describe("FormGrid", () => {
  it("top-aligns fields with different helper-text heights", () => {
    const { getByTestId } = render(
      <FormGrid data-testid="form-grid">
        <div>Field with helper text</div>
        <div>Field without helper text</div>
      </FormGrid>,
    );

    expect(getByTestId("form-grid")).toHaveClass("items-start");
  });
});
