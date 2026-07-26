import { fireEvent, render, screen } from "@testing-library/react";

import { Switch } from "./switch";

describe("Switch", () => {
  it("renders the shared v3 dimensions and component hooks", () => {
    render(
      <Switch
        aria-label="근무 가능 여부"
        data-component="desktop_v3_tests_switch"
        thumbDataComponent="desktop_v3_tests_switch_thumb"
      />,
    );

    const switchControl = screen.getByRole("switch", { name: "근무 가능 여부" });
    const thumb = document.querySelector('[data-component="desktop_v3_tests_switch_thumb"]');

    expect(switchControl).toHaveAttribute("data-component", "desktop_v3_tests_switch");
    expect(switchControl).toHaveClass(
      "h-[calc(23.4px*var(--glint-ui-scale,1))]",
      "w-[calc(41.4px*var(--glint-ui-scale,1))]",
      "p-[calc(2.7px*var(--glint-ui-scale,1))]",
    );
    expect(thumb).toHaveClass(
      "h-[calc(18px*var(--glint-ui-scale,1))]",
      "w-[calc(18px*var(--glint-ui-scale,1))]",
    );
  });

  it("keeps native switch state and disabled semantics", () => {
    const handleCheckedChange = jest.fn();
    const { rerender } = render(
      <Switch aria-label="알림 사용" onCheckedChange={handleCheckedChange} />,
    );

    const switchControl = screen.getByRole("switch", { name: "알림 사용" });
    fireEvent.click(switchControl);

    expect(handleCheckedChange).toHaveBeenCalledWith(true);

    rerender(<Switch aria-label="알림 사용" disabled onCheckedChange={handleCheckedChange} />);
    fireEvent.click(switchControl);

    expect(switchControl).toBeDisabled();
    expect(handleCheckedChange).toHaveBeenCalledTimes(1);
  });
});
