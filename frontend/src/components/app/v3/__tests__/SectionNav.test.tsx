import { fireEvent, render, screen } from "@testing-library/react";
import { Clock3, Send } from "lucide-react";

import { SectionNav } from "../SectionNav";

describe("SectionNav", () => {
  it("labels the navigation and exposes the selected section state", () => {
    render(
      <SectionNav
        data-component="desktop_v3_tests_section-nav"
        ariaLabel="메시지 기능"
        items={[
          { id: "send", label: "전송하기", icon: Send },
          { id: "scheduled", label: "발송 예정", icon: Clock3 },
        ]}
        activeId="send"
        onSelect={jest.fn()}
      />,
    );

    expect(screen.getByRole("navigation", { name: "메시지 기능" })).toBeInTheDocument();
    screen.getAllByRole("button", { name: "전송하기" }).forEach((button) => {
      expect(button).toHaveAttribute("type", "button");
      expect(button).toHaveAttribute("aria-pressed", "true");
    });
    screen.getAllByRole("button", { name: "발송 예정" }).forEach((button) => {
      expect(button).toHaveAttribute("aria-pressed", "false");
    });
  });

  it("keeps compact section controls explicit and stable", () => {
    const onSelect = jest.fn();
    const { container } = render(
      <SectionNav
        data-component="desktop_v3_tests_section-nav"
        items={[
          { id: "send", label: "전송하기", icon: Send },
          { id: "scheduled", label: "발송 예정", icon: Clock3, disabled: true },
        ]}
        activeId="send"
        onSelect={onSelect}
      />,
    );

    const mobileNav = container.querySelector('[data-component="desktop_v3_tests_section-nav_mobile"]');
    const mobileSendButton = mobileNav?.querySelector("button");
    const disabledButton = mobileNav?.querySelector("button:disabled");

    expect(mobileSendButton).toHaveClass("transition-colors");
    expect(mobileNav).toHaveAttribute("data-slot", "section-nav-mobile");
    fireEvent.click(mobileSendButton as HTMLButtonElement);
    fireEvent.click(disabledButton as HTMLButtonElement);
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith("send");
  });
});
