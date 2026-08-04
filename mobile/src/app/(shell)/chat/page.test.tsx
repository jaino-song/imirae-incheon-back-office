import { render, screen } from "@testing-library/react";

import ChatPage from "./page";

const mockUseAgentShellEnabled = jest.fn<null | boolean, []>();

jest.mock("@/hooks/useAgentChat", () => ({
  useAgentShellEnabled: () => mockUseAgentShellEnabled(),
}));

jest.mock("@/components/app/chat/AgentMobileShell", () => ({
  AgentMobileShell: () => <div data-testid="agent-mobile-shell" />,
}));

jest.mock("@/components/app/chat/ChatPageLoading", () => ({
  ChatPageLoading: () => <div data-testid="chat-page-loading" />,
}));

jest.mock("@/components/app/chat/LegacyChatPage", () => ({
  LegacyChatPage: () => <div data-testid="legacy-chat-page" />,
}));

describe("ChatPage composition", () => {
  beforeEach(() => {
    mockUseAgentShellEnabled.mockReset();
  });

  it("renders the imported loading organism while the flag is unresolved", () => {
    mockUseAgentShellEnabled.mockReturnValue(null);

    render(<ChatPage />);

    expect(screen.getByTestId("chat-page-loading")).toBeInTheDocument();
    expect(screen.queryByTestId("legacy-chat-page")).not.toBeInTheDocument();
    expect(screen.queryByTestId("agent-mobile-shell")).not.toBeInTheDocument();
  });

  it("renders the imported legacy organism when the flag is disabled", () => {
    mockUseAgentShellEnabled.mockReturnValue(false);

    render(<ChatPage />);

    expect(screen.getByTestId("legacy-chat-page")).toBeInTheDocument();
    expect(screen.queryByTestId("chat-page-loading")).not.toBeInTheDocument();
    expect(screen.queryByTestId("agent-mobile-shell")).not.toBeInTheDocument();
  });

  it("renders the imported agent organism when the flag is enabled", () => {
    mockUseAgentShellEnabled.mockReturnValue(true);

    render(<ChatPage />);

    expect(screen.getByTestId("agent-mobile-shell")).toBeInTheDocument();
    expect(screen.queryByTestId("chat-page-loading")).not.toBeInTheDocument();
    expect(screen.queryByTestId("legacy-chat-page")).not.toBeInTheDocument();
  });
});
