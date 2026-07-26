import { fireEvent, render, screen } from "@testing-library/react";

import {
  MESSAGE_NAVIGATION_ITEMS,
  MessagesAutomationPage,
} from "../MessagesAutomationPage";

const mockPush = jest.fn();

jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush }),
}));

describe("MessagesAutomationPage", () => {
  beforeEach(() => {
    mockPush.mockReset();
  });

  it("exposes every message section through the compact section navigation", () => {
    const { container } = render(<MessagesAutomationPage />);

    const navigation = screen.getByRole("navigation", { name: "메시지 기능" });
    const content = container.querySelector('[data-slot="messages-content"]');

    expect(navigation).toHaveAttribute("data-component", "mobile_messages_automation_page_content_section-nav");
    expect(navigation).toHaveAttribute("data-mode", "compact");
    expect(content).toHaveClass("flex-col");
    expect(content?.firstElementChild).toBe(navigation);
    expect(container.querySelector('[data-component="mobile-messages-navigation"]')).not.toBeInTheDocument();
    expect(container.querySelector('[data-component="mobile_messages_automation_page_content_list-card"]'))
      .toContainElement(container.querySelector('[data-component="mobile_messages_automation_page_content_list-card_body"]'));
    expect(MESSAGE_NAVIGATION_ITEMS.map((item) => item.title)).toEqual([
      "전송하기",
      "발송 예정",
      "발송 기록",
      "템플릿",
      "자동 전송",
      "설정",
    ]);

    for (const item of MESSAGE_NAVIGATION_ITEMS) {
      expect(screen.getByRole("button", { name: item.title })).toBeInTheDocument();
    }

    expect(screen.getByRole("button", { name: "전송하기" }))
      .toHaveAttribute("aria-pressed", "true");
    expect(container.querySelector(".message-navigation-row")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "발송 예정" }));

    expect(mockPush).toHaveBeenCalledWith("/messages/scheduled");
  });
});
