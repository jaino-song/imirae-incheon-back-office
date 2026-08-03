import { renderHook, waitFor } from "@testing-library/react";
import { useChat } from "@ai-sdk/react";

import { useAgentChat } from "./useAgentChat";

jest.mock("ai", () => ({ DefaultChatTransport: jest.fn() }));
jest.mock("@ai-sdk/react", () => ({ useChat: jest.fn() }));

describe("useAgentChat", () => {
    beforeEach(() => {
        window.sessionStorage.clear();
        jest.resetAllMocks();
    });

    it("restores messages for the persisted owned session", async () => {
        const setMessages = jest.fn();
        (useChat as jest.Mock).mockReturnValue({
            messages: [], setMessages, sendMessage: jest.fn(), regenerate: jest.fn(), stop: jest.fn(), status: "ready",
        });
        window.sessionStorage.setItem("agent_session_id", "session-a");
        const restoredMessages = [{ id: "message-a", role: "assistant", parts: [{ type: "text", text: "복원됨" }] }];
        global.fetch = jest.fn().mockImplementation(async (input: string | URL | Request) => {
            const url = String(input);
            const payload = url.endsWith("/sessions/session-a")
                ? { id: "session-a", title: "대화", updatedAt: "2026-08-03", messages: restoredMessages }
                : [];

            return { ok: true, json: async () => payload } as Response;
        });

        renderHook(() => useAgentChat());

        await waitFor(() => expect(setMessages).toHaveBeenCalledWith(restoredMessages));
    });
});
