import { render, screen } from "@testing-library/react";

import { PwaLaunchScreen } from "./pwa-launch-screen";

describe("PwaLaunchScreen", () => {
  it("should keep the current brand visible with an accessible loading spinner", () => {
    const { container } = render(
      <PwaLaunchScreen data-component="mobile_test_launch" />,
    );

    expect(screen.getByRole("status", { name: "아가잼잼을 불러오는 중" })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "아가잼잼" })).toHaveAttribute(
      "src",
      expect.stringContaining("/assets/logo.svg"),
    );
    expect(container.querySelector('[data-slot="spinner"]')).toHaveAttribute(
      "data-component",
      "mobile_test_launch_spinner",
    );
  });
});
