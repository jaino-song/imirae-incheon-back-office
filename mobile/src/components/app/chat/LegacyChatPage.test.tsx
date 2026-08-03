import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import { LegacyChatPage } from "./LegacyChatPage";

const mockLoadHistory = jest.fn();
const mockSendMessage = jest.fn();

jest.mock("react-markdown", () => ({
  __esModule: true,
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

jest.mock("remark-gfm", () => ({
  __esModule: true,
  default: jest.fn(),
}));

jest.mock("@/components/app/chat/CodeBlock", () => ({
  CodeBlock: ({ children }: { children: React.ReactNode }) => <pre>{children}</pre>,
}));

jest.mock("@/providers/UserProvider", () => ({
  useInitialUser: () => ({ name: "테스트 사용자", branchName: "테스트 지점" }),
}));

jest.mock("@/hooks/useChatStream", () => ({
  useChatStream: () => ({
    messages: [],
    state: "idle",
    sendMessage: mockSendMessage,
    clearSession: jest.fn(),
    isToolExecuting: false,
    currentTool: null,
    loadHistory: mockLoadHistory,
    isLoadingHistory: false,
    hasMoreHistory: false,
  }),
}));

describe("LegacyChatPage", () => {
  beforeAll(() => {
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      value: jest.fn(),
    });
  });

  beforeEach(() => {
    mockLoadHistory.mockReset();
    mockSendMessage.mockReset();
  });

  it("keeps the legacy chat selectors and reloads history on mount", () => {
    render(<LegacyChatPage />);

    expect(document.querySelector('[data-component="mobile_chat_page"]')).toHaveAttribute(
      "data-slot",
      "chat-page",
    );
    expect(screen.getByPlaceholderText("질문을 입력하세요...")).toHaveAttribute(
      "data-component",
      "mobile_chat_page_input-area_input",
    );
    expect(mockLoadHistory).toHaveBeenCalledWith(0);
  });

  it("submits on Enter and restores composer focus", async () => {
    render(<LegacyChatPage />);
    const input = screen.getByPlaceholderText("질문을 입력하세요...");
    input.focus();

    fireEvent.change(input, { target: { value: "  테스트 질문  " } });
    fireEvent.keyDown(input, { key: "Enter", shiftKey: false });

    expect(mockSendMessage).toHaveBeenCalledWith("테스트 질문");
    expect(input).toHaveValue("");
    await waitFor(() => expect(input).toHaveFocus());
  });
});
