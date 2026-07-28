import { render } from "@testing-library/react";

import { Stepper } from "../Stepper";

describe("Stepper", () => {
  it("renders pending steps with the wizard outline convention", () => {
    const { container } = render(
      <Stepper
        activeStep={0}
        steps={[
          { label: "작성" },
          { label: "서명" },
        ]}
      />,
    );

    const circles = container.querySelectorAll(
      '[data-component="desktop_v3_stepper_circle"]',
    );

    expect(circles[1]).toHaveClass(
      "border-2",
      "border-v3-border",
      "bg-v3-dim-white",
    );
  });
});
