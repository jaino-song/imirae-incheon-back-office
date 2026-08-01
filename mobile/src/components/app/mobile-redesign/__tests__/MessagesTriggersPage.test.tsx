import { fireEvent, render, screen } from "@testing-library/react";

import { MessagesTriggersPage } from "../MessagesTriggersPage";

jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: jest.fn() }),
}));

jest.mock("@/components/app/mobile-redesign/ClientRegistrationPolicySettings", () => ({
  ClientRegistrationPolicySettings: () => <div data-testid="client-registration-policy" />,
}));

jest.mock("@/components/app/mobile-redesign/MessageTriggerList", () => ({
  MessageTriggerList: ({ onEdit }: { onEdit?: (rule: null) => void }) => (
    <button type="button" onClick={() => onEdit?.(null)}>규칙 편집 열기</button>
  ),
}));

jest.mock("@/components/app/mobile-redesign/MessageTriggerEditor", () => ({
  MessageTriggerEditor: () => <div data-component="test-message-trigger-editor">규칙 편집 화면</div>,
}));

describe("MessagesTriggersPage", () => {
  it("renders the automation section navigation in the shared message shell", () => {
    const { container } = render(<MessagesTriggersPage />);

    const content = container.querySelector<HTMLElement>('[data-slot="messages-content"]');
    const navigation = screen.getByRole("navigation", { name: "메시지 기능" });

    expect(content?.firstElementChild).toBe(navigation);
    expect(container.querySelector('[data-component="messages-shell"]')).not.toBeInTheDocument();
    expect(container.querySelector('[data-slot="messages-page"]')).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "자동 전송" })).toBeDisabled();
    expect(container.querySelector('[data-component="mobile_messages_triggers_detail-sheet_stack_list-page_shell_content_list-card_header"] .list-title-text'))
      .toHaveTextContent("자동 전송");
    expect(container.querySelector('[data-component="mobile_messages_triggers_detail-sheet_stack_list-page_shell_content_list-card"]'))
      .toContainElement(container.querySelector('[data-component="mobile_messages_triggers_detail-sheet_stack_list-page_shell_content_list-card_body"]'));
  });

  it("opens creation and editing details from mobile automation", () => {
    render(<MessagesTriggersPage />);

    fireEvent.click(screen.getByRole("button", { name: "+ 규칙" }));
    expect(screen.getByText("규칙 편집 화면")).toBeInTheDocument();
  });
});
