import { act, renderHook, waitFor } from "@testing-library/react";
import { TextDecoder as NodeTextDecoder } from "node:util";

import { useAgentChat } from "./useAgentChat";

describe("mobile useAgentChat", () => {
    beforeAll(() => {
        Object.defineProperty(globalThis, "TextDecoder", { configurable: true, value: NodeTextDecoder });
    });

    beforeEach(() => {
        window.sessionStorage.clear();
        jest.resetAllMocks();
    });

    it("restores messages for the persisted owned session", async () => {
        window.sessionStorage.setItem("agent_session_id", "session-a");
        const restoredMessages = [{ id: "message-a", role: "assistant", parts: [{ type: "text", text: "복원됨" }] }];
        global.fetch = jest.fn().mockImplementation(async (input: string | URL | Request) => {
            const url = String(input);
            const payload = url.endsWith("/sessions/session-a")
                ? { id: "session-a", title: "대화", updatedAt: "2026-08-03", messages: restoredMessages }
                : [];

            return { ok: true, json: async () => payload } as Response;
        });

        const { result } = renderHook(() => useAgentChat());

        await waitFor(() => expect(result.current.messages).toEqual(restoredMessages));
    });

    it("keeps the server-issued assistant message id from the UI message stream", async () => {
        global.fetch = jest.fn().mockImplementation(async (input: string | URL | Request) => {
            const url = String(input);
            if (url.endsWith("/chat")) {
                const payload = new Uint8Array(Buffer.from([
                    'data: {"type":"start","messageId":"assistant-server-id"}',
                    'data: {"type":"text-delta","delta":"응답"}',
                    "data: [DONE]",
                    "",
                ].join("\n")));
                let consumed = false;
                return {
                    ok: true,
                    headers: { get: (name: string) => name.toLowerCase() === "x-agent-session-id" ? "session-stream" : null },
                    body: { getReader: () => ({ read: async () => consumed ? { done: true } : (consumed = true, { done: false, value: payload }) }) },
                } as unknown as Response;
            }
            return { ok: true, json: async () => [] } as Response;
        });
        const { result } = renderHook(() => useAgentChat());

        await act(async () => { await result.current.sendMessage("질문"); });

        expect(result.current.messages.at(-1)).toEqual(expect.objectContaining({
            id: "assistant-server-id",
            role: "assistant",
            parts: [{ type: "text", text: "응답" }],
        }));
    });
});
