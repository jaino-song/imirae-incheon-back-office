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

    it("aborts and detaches the active stream before switching sessions", async () => {
        let releaseRead: (() => void) | undefined;
        let chatSignal: AbortSignal | undefined;
        const streamed = new Uint8Array(Buffer.from('data: {"type":"text-delta","delta":"이전 응답"}\n'));
        global.fetch = jest.fn().mockImplementation(async (input: string | URL | Request, init?: RequestInit) => {
            const url = String(input);
            if (url.endsWith("/chat")) {
                chatSignal = init?.signal as AbortSignal;
                let delivered = false;
                return {
                    ok: true,
                    headers: { get: () => "session-a" },
                    body: { getReader: () => ({
                        read: async () => {
                            if (delivered) return { done: true };
                            await new Promise<void>((resolve) => { releaseRead = resolve; });
                            delivered = true;
                            return { done: false, value: streamed };
                        },
                    }) },
                } as unknown as Response;
            }
            if (url.endsWith("/sessions/session-b")) {
                return {
                    ok: true,
                    json: async () => ({
                        id: "session-b", title: "다른 대화", updatedAt: "2026-08-04",
                        messages: [{ id: "message-b", role: "assistant", parts: [{ type: "text", text: "다른 대화" }] }],
                    }),
                } as Response;
            }
            return { ok: true, json: async () => [] } as Response;
        });
        const { result } = renderHook(() => useAgentChat());

        let sendPromise: Promise<void> | undefined;
        await act(async () => {
            sendPromise = result.current.sendMessage("오래 걸리는 질문");
            await Promise.resolve();
        });
        await waitFor(() => expect(result.current.status).toBe("streaming"));

        await act(async () => { await result.current.selectSession("session-b"); });
        expect(chatSignal?.aborted).toBe(true);
        releaseRead?.();
        await act(async () => { await sendPromise; });

        expect(result.current.messages).toEqual([
            { id: "message-b", role: "assistant", parts: [{ type: "text", text: "다른 대화" }] },
        ]);
    });

    it("aborts and detaches a form submission before switching sessions", async () => {
        let releaseBody: (() => void) | undefined;
        let formSignal: AbortSignal | undefined;
        global.fetch = jest.fn().mockImplementation(async (input: string | URL | Request, init?: RequestInit) => {
            const url = String(input);
            if (url.endsWith("/chat")) {
                formSignal = init?.signal as AbortSignal;
                return {
                    ok: true,
                    headers: { get: () => "session-a" },
                    text: async () => new Promise<string>((resolve) => {
                        releaseBody = () => resolve("done");
                    }),
                } as unknown as Response;
            }
            if (url.endsWith("/sessions/session-b")) {
                return {
                    ok: true,
                    json: async () => ({
                        id: "session-b", title: "다른 대화", updatedAt: "2026-08-04",
                        messages: [{ id: "message-b", role: "assistant", parts: [{ type: "text", text: "다른 대화" }] }],
                    }),
                } as Response;
            }
            return { ok: true, json: async () => [] } as Response;
        });
        const { result } = renderHook(() => useAgentChat());

        let formPromise: Promise<void> | undefined;
        await act(async () => {
            formPromise = result.current.submitStructuredForm("clients.create-session-a", {
                name: "홍길동", phone: "01012345678",
            });
            await Promise.resolve();
        });
        await waitFor(() => expect(result.current.status).toBe("streaming"));

        await act(async () => { await result.current.selectSession("session-b"); });
        expect(formSignal?.aborted).toBe(true);
        releaseBody?.();
        await act(async () => { await formPromise; });

        expect(result.current.messages).toEqual([
            { id: "message-b", role: "assistant", parts: [{ type: "text", text: "다른 대화" }] },
        ]);
    });

    it("ignores an older session response whose JSON finishes after a newer selection", async () => {
        let releaseSessionA: (() => void) | undefined;
        let markSessionAJsonStarted: (() => void) | undefined;
        const sessionAJsonStarted = new Promise<void>((resolve) => { markSessionAJsonStarted = resolve; });
        global.fetch = jest.fn().mockImplementation(async (input: string | URL | Request) => {
            const url = String(input);
            if (url.endsWith("/sessions/session-a")) {
                return {
                    ok: true,
                    json: async () => {
                        markSessionAJsonStarted?.();
                        await new Promise<void>((resolve) => { releaseSessionA = resolve; });
                        return {
                            id: "session-a", title: "느린 대화", updatedAt: "2026-08-03",
                            messages: [{ id: "message-a", role: "assistant", parts: [{ type: "text", text: "느린 대화" }] }],
                        };
                    },
                } as Response;
            }
            if (url.endsWith("/sessions/session-b")) {
                return {
                    ok: true,
                    json: async () => ({
                        id: "session-b", title: "최신 대화", updatedAt: "2026-08-04",
                        messages: [{ id: "message-b", role: "assistant", parts: [{ type: "text", text: "최신 대화" }] }],
                    }),
                } as Response;
            }
            return { ok: true, json: async () => [] } as Response;
        });
        const { result } = renderHook(() => useAgentChat());

        let sessionAPromise: Promise<void> | undefined;
        await act(async () => {
            sessionAPromise = result.current.selectSession("session-a");
            await sessionAJsonStarted;
        });
        await act(async () => { await result.current.selectSession("session-b"); });
        releaseSessionA?.();
        await act(async () => { await sessionAPromise; });

        expect(window.sessionStorage.getItem("agent_session_id")).toBe("session-b");
        expect(result.current.messages).toEqual([
            { id: "message-b", role: "assistant", parts: [{ type: "text", text: "최신 대화" }] },
        ]);
    });
});
