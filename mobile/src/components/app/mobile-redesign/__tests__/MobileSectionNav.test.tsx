import { fireEvent, render, screen } from "@testing-library/react";
import { Users, Workflow } from "lucide-react";

import { MobileSectionNav } from "../primitives";

describe("MobileSectionNav", () => {
  it("shows compact section buttons and changes the selected section", () => {
    const onSelect = jest.fn();
    const { container } = render(
      <MobileSectionNav
        data-component="mobile_tests_section-nav_primary"
        ariaLabel="고객 섹션"
        items={[
          { id: "list", label: "고객 목록", icon: Users },
          { id: "automation", label: "자동화", icon: Workflow },
        ]}
        activeId="list"
        onSelect={onSelect}
      />,
    );

    const nav = screen.getByRole("navigation", { name: "고객 섹션" });
    expect(nav).toHaveAttribute("data-component", "mobile_tests_section-nav_primary");
    expect(nav).toHaveAttribute("data-mode", "compact");
    const activeButton = screen.getByRole("button", { name: "고객 목록" });
    const inactiveButton = screen.getByRole("button", { name: "자동화" });
    expect(activeButton).toHaveAttribute("aria-pressed", "true");
    expect(activeButton).toBeEnabled();
    expect(activeButton).toHaveClass(
      "border",
      "border-[hsl(var(--v3-primary))]",
      "h-[calc(28px*var(--glint-ui-scale,1))]",
      "px-[calc(12px*var(--glint-ui-scale,1))]",
      "py-0",
      "text-[calc(0.72rem*var(--glint-ui-scale,1))]",
      "font-semibold",
    );
    expect(activeButton).not.toHaveClass("min-h-[44px]");
    expect(inactiveButton).toHaveAttribute("aria-pressed", "false");
    expect(inactiveButton).toBeEnabled();
    expect(inactiveButton).toHaveClass("border", "border-[hsl(var(--v3-border))]");
    expect(inactiveButton).not.toHaveClass("min-h-[44px]");
    expect(container.querySelector('[data-component="mobile-redesign-list-card"]')).not.toBeInTheDocument();

    fireEvent.click(inactiveButton);
    expect(onSelect).toHaveBeenCalledWith("automation");
  });

  it("keeps a disabled active item unpressed and non-interactive", () => {
    const onSelect = jest.fn();
    render(
      <MobileSectionNav
        data-component="mobile_tests_section-nav_secondary"
        ariaLabel="메시지 섹션"
        items={[
          { id: "list", label: "발송 기록", icon: Users },
          { id: "templates", label: "템플릿", icon: Workflow, disabled: true },
        ]}
        activeId="templates"
        onSelect={onSelect}
      />,
    );

    const disabledButton = screen.getByRole("button", { name: "템플릿" });
    expect(disabledButton).toHaveAttribute("aria-pressed", "false");
    expect(disabledButton).toBeDisabled();
    expect(disabledButton).toHaveClass(
      "disabled:pointer-events-none",
      "border-[hsl(var(--v3-border))]",
      "bg-[hsl(var(--v3-dim-white))]",
      "text-[hsl(var(--v3-text-muted))]",
      "opacity-40",
    );

    fireEvent.click(disabledButton);
    expect(onSelect).not.toHaveBeenCalled();
  });
});
