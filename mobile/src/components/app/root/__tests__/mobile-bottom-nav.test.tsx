import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { MobileBottomNav } from "../mobile-bottom-nav";

const mockUsePathname = jest.fn();
const mockUseReducedMotion = jest.fn();

jest.mock("next/navigation", () => ({
  usePathname: () => mockUsePathname(),
}));

jest.mock("framer-motion", () => ({
  useReducedMotion: () => mockUseReducedMotion(),
}));

describe("MobileBottomNav", () => {
  beforeEach(() => {
    mockUsePathname.mockReset();
    mockUseReducedMotion.mockReset();
    mockUseReducedMotion.mockReturnValue(false);
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ count: 0 }),
    }) as unknown as typeof fetch;
  });

  it("marks All active on the All route", () => {
    mockUsePathname.mockReturnValue("/all");

    render(<MobileBottomNav />);

    expect(screen.getByRole("link", { name: "전체" })).toHaveAttribute("aria-current", "page");
  });

  it("does not mark All active on notification settings", () => {
    mockUsePathname.mockReturnValue("/notification");

    render(<MobileBottomNav />);

    expect(screen.getByRole("link", { name: "전체" })).not.toHaveAttribute("aria-current");
  });

  it("keeps the All indicator position when fading out on child pages", () => {
    mockUsePathname.mockReturnValue("/all");
    const { container, rerender } = render(<MobileBottomNav />);
    const indicator = container.querySelector('[data-slot="mobile-bottom-indicator"]');

    expect(indicator).toHaveStyle({
      opacity: "1",
      transform: "translate3d(calc(400% + 8px), 0, 0)",
    });

    mockUsePathname.mockReturnValue("/notification");
    rerender(<MobileBottomNav />);

    expect(screen.getByRole("link", { name: "전체" })).not.toHaveAttribute("aria-current");
    expect(indicator).toHaveStyle({
      opacity: "0",
      transform: "translate3d(calc(400% + 8px), 0, 0)",
      transition: "opacity 140ms ease-out",
    });
  });

  it("renders 통화요약 as disabled", () => {
    mockUsePathname.mockReturnValue("/calls");

    const { container } = render(<MobileBottomNav />);
    const callsItem = container.querySelector('[data-slot="mobile-bottom-nav-chat"]');

    expect(callsItem).toHaveTextContent("통화요약");
    expect(callsItem).toHaveAttribute("aria-disabled", "true");
    expect(callsItem).toHaveAttribute("data-disabled", "true");
    expect(callsItem).toHaveClass("text-gray-300");
    expect(callsItem).not.toHaveClass("opacity-60");
    expect(screen.queryByRole("link", { name: /통화요약/ })).not.toBeInTheDocument();
  });

  it("does not fetch the calls pending count while 통화요약 is disabled", () => {
    mockUsePathname.mockReturnValue("/dashboard");

    render(<MobileBottomNav />);

    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("keeps every navigation item at the compact 40px height", () => {
    mockUsePathname.mockReturnValue("/dashboard");

    const { container } = render(<MobileBottomNav />);
    const items = container.querySelectorAll('[data-slot^="mobile-bottom-nav-"]');

    expect(items).toHaveLength(5);
    items.forEach((item) => {
      expect(item).toHaveClass("h-10", "py-[5px]");
      expect(item).not.toHaveClass("h-[44px]", "py-[7px]");
    });
  });

  it("moves nav foreground colors with the pressed indicator before route change", async () => {
    mockUsePathname.mockReturnValue("/dashboard");
    const user = userEvent.setup();

    render(<MobileBottomNav />);

    const homeLink = screen.getByRole("link", { name: "홈" });
    const contractsLink = screen.getByRole("link", { name: "계약" });

    expect(homeLink).toHaveClass("text-white");
    expect(homeLink).toHaveAttribute("data-visual-active", "true");
    expect(contractsLink).toHaveClass("text-gray-500");
    expect(contractsLink).not.toHaveAttribute("data-visual-active");

    contractsLink.addEventListener("click", (event) => event.preventDefault());

    await user.click(contractsLink);

    expect(homeLink).toHaveClass("text-gray-500");
    expect(homeLink).not.toHaveAttribute("data-visual-active");
    expect(contractsLink).toHaveClass("text-white");
    expect(contractsLink).toHaveAttribute("data-visual-active", "true");
    expect(homeLink).toHaveAttribute("aria-current", "page");
  });
});
