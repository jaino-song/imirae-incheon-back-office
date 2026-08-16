import { render, screen } from "@testing-library/react";

import { PwaLaunchScreen } from "./pwa-launch-screen";

describe("PwaLaunchScreen", () => {
  it("should keep the current brand visible with an accessible loading spinner", () => {
    const { container } = render(
      <PwaLaunchScreen data-component="mobile_test_launch" />,
    );

    const launchScreen = screen.getByRole("status", { name: "아가잼잼을 불러오는 중" });
    const logo = screen.getByRole("img", { name: "아가잼잼" });
    const spinner = container.querySelector('[data-slot="spinner"]');
    const content = container.querySelector('[data-slot="pwa-launch-content"]');

    expect(launchScreen).toBeInTheDocument();
    expect(logo).toHaveAttribute(
      "src",
      expect.stringContaining("/assets/logo.svg"),
    );
    expect(content).toHaveClass("flex", "flex-col", "items-center", "gap-4");
    expect(content).toHaveAttribute("data-component", "mobile_test_launch_content");
    expect(content).toContainElement(logo);
    expect(content).toContainElement(spinner as HTMLElement);
    expect(logo).toHaveAttribute("data-component", "mobile_test_launch_content_logo");
    expect(spinner).toHaveAttribute(
      "data-component",
      "mobile_test_launch_content_spinner",
    );
  });
});
