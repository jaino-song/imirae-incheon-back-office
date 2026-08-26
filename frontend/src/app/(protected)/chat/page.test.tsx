import { render, screen } from "@testing-library/react";

import ChatPage from "./page";

type AgentShellState = "compatibility-off" | "loading" | "enabled" | "discovery-error";
const mockUseAgentShellEnabled = jest.fn<AgentShellState, []>();

jest.mock("@/hooks/useAgentChat", () => ({
  useAgentShellEnabled: () => mockUseAgentShellEnabled(),
  AGENT_DISCOVERY_ERROR_MESSAGE: "AI 운영 코파일럿을 준비하지 못했습니다.",
}));

jest.mock("@/components/app/chat/AgentShell", () => ({
  AgentShell: () => <div data-testid="agent-shell" />,
  AgentShellLoading: () => <div data-testid="agent-shell-loading" />,
}));

jest.mock("@/components/app/chat/LegacyChatPage", () => ({
  LegacyChatPage: () => <div data-testid="legacy-chat-page" />,
}));

describe("ChatPage composition", () => {
  beforeEach(() => {
    mockUseAgentShellEnabled.mockReset();
  });

  it("renders the imported loading organism while the flag is unresolved", () => {
    mockUseAgentShellEnabled.mockReturnValue("loading");

    render(<ChatPage />);

    expect(screen.getByTestId("agent-shell-loading")).toBeInTheDocument();
    expect(screen.queryByTestId("legacy-chat-page")).not.toBeInTheDocument();
    expect(screen.queryByTestId("agent-shell")).not.toBeInTheDocument();
  });

  it("renders legacy chat only for explicit compatibility-off mode", () => {
    mockUseAgentShellEnabled.mockReturnValue("compatibility-off");

    render(<ChatPage />);

    expect(screen.getByTestId("legacy-chat-page")).toBeInTheDocument();
    expect(screen.queryByTestId("agent-shell-loading")).not.toBeInTheDocument();
    expect(screen.queryByTestId("agent-shell")).not.toBeInTheDocument();
  });

  it("renders the imported agent organism when discovery succeeds", () => {
    mockUseAgentShellEnabled.mockReturnValue("enabled");

    render(<ChatPage />);

    expect(screen.getByTestId("agent-shell")).toBeInTheDocument();
    expect(screen.queryByTestId("agent-shell-loading")).not.toBeInTheDocument();
    expect(screen.queryByTestId("legacy-chat-page")).not.toBeInTheDocument();
  });

  it("throws a safe discovery error instead of mounting either chat surface", () => {
    mockUseAgentShellEnabled.mockReturnValue("discovery-error");

    expect(() => ChatPage()).toThrow("AI 운영 코파일럿을 준비하지 못했습니다.");
    expect(screen.queryByTestId("agent-shell-loading")).not.toBeInTheDocument();
    expect(screen.queryByTestId("legacy-chat-page")).not.toBeInTheDocument();
    expect(screen.queryByTestId("agent-shell")).not.toBeInTheDocument();
  });
});
