"use client";

import { AgentShell, AgentShellLoading } from "@/components/app/chat/AgentShell";
import { LegacyChatPage } from "@/components/app/chat/LegacyChatPage";
import { useAgentShellEnabled } from "@/hooks/useAgentChat";

export default function ChatPage() {
    const agentShellEnabled = useAgentShellEnabled();
    if (agentShellEnabled === null) return <AgentShellLoading />;
    return agentShellEnabled === true ? <AgentShell /> : <LegacyChatPage />;
}
