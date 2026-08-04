"use client";

import { AgentMobileShell } from "@/components/app/chat/AgentMobileShell";
import { ChatPageLoading } from "@/components/app/chat/ChatPageLoading";
import { LegacyChatPage } from "@/components/app/chat/LegacyChatPage";
import { useAgentShellEnabled } from "@/hooks/useAgentChat";

export default function ChatPage() {
  const agentShellEnabled = useAgentShellEnabled();

  if (agentShellEnabled === null) return <ChatPageLoading />;
  return agentShellEnabled ? <AgentMobileShell /> : <LegacyChatPage />;
}
