"use client";

import { AgentShell, AgentShellLoading } from "@/components/app/chat/AgentShell";
import { LegacyChatPage } from "@/components/app/chat/LegacyChatPage";
import { AGENT_DISCOVERY_ERROR_MESSAGE, useAgentShellEnabled } from "@/hooks/useAgentChat";

export default function ChatPage() {
    const agentShellState = useAgentShellEnabled();
    if (agentShellState === "loading") return <AgentShellLoading />;
    if (agentShellState === "discovery-error") throw new Error(AGENT_DISCOVERY_ERROR_MESSAGE);
    if (agentShellState === "compatibility-off") return <LegacyChatPage />;
    return <AgentShell />;
}
