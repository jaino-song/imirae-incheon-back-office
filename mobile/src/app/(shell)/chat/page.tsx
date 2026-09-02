"use client";

import { AgentMobileShell } from "@/components/app/chat/AgentMobileShell";
import { ChatPageLoading } from "@/components/app/chat/ChatPageLoading";
import { LegacyChatPage } from "@/components/app/chat/LegacyChatPage";
import { AGENT_DISCOVERY_ERROR_MESSAGE, useAgentShellEnabled } from "@/hooks/useAgentChat";

export default function ChatPage() {
  const agentShellState = useAgentShellEnabled();

  if (agentShellState === "loading") return <ChatPageLoading />;
  if (agentShellState === "discovery-error") throw new Error(AGENT_DISCOVERY_ERROR_MESSAGE);
  if (agentShellState === "compatibility-off") return <LegacyChatPage />;
  return <AgentMobileShell />;
}
