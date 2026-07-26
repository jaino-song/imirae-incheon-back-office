import { render, screen } from "@testing-library/react";

import TemplatesPage from "../page";

jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: jest.fn() }),
}));

jest.mock("@/features/system-templates/hooks", () => ({
  useSystemTemplates: () => ({ data: [], isLoading: false }),
}));

jest.mock("@/hooks/use-message-templates", () => ({
  useMessageTemplates: () => ({ data: [], isLoading: false }),
}));

jest.mock("@/hooks/useListInfiniteScroll", () => ({
  useListInfiniteScroll: () => ({
    visibleCount: 20,
    isInitialLoad: false,
    hasMore: false,
    sentinelRef: { current: null },
    scrollContainerRef: { current: null },
    loadMore: jest.fn(),
  }),
}));

describe("TemplatesPage", () => {
  it("uses the shared message section shell without a standalone back header", () => {
    const { container } = render(<TemplatesPage />);

    const messagesShell = container.querySelector<HTMLElement>('[data-slot="messages-page"]');
    const content = container.querySelector<HTMLElement>('[data-slot="messages-content"]');
    const card = container.querySelector<HTMLElement>('[data-component="mobile_messages_templates_page_content_list-card"]');

    expect(messagesShell).toHaveAttribute("data-page", "messages-templates");
    expect(content).toContainElement(card);
    const templatesSectionButton = screen.getByRole("button", { name: "템플릿" });
    expect(templatesSectionButton).toHaveAttribute("aria-pressed", "false");
    expect(templatesSectionButton).toBeDisabled();
    expect(screen.getByText("템플릿 관리")).toHaveClass("list-title-text");
    expect(card).toContainElement(
      container.querySelector('[data-component="mobile_messages_templates_page_content_list-card_filters"]'),
    );
    expect(card).toContainElement(
      container.querySelector('[data-component="mobile_messages_templates_page_content_list-card_body"]'),
    );
    expect(screen.getByRole("link", { name: "+ 새 템플릿" }))
      .toHaveAttribute("href", "/messages/templates/new");
    expect(screen.queryByRole("link", { name: "메시지" })).not.toBeInTheDocument();
  });
});
