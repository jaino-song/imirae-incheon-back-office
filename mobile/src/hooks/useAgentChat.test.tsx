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

    it("publishes one immutable assistant snapshot before the stream closes and updates that message", async () => {
        let releaseLaterChunk: (() => void) | undefined;
        let markFirstChunkRead: (() => void) | undefined;
        const firstChunkRead = new Promise<void>((resolve) => { markFirstChunkRead = resolve; });
        const firstChunk = new Uint8Array(Buffer.from([
            'data: {"type":"start","messageId":"assistant-stream-id"}',
            'data: {"type":"text-delta","delta":"첫"}',
            'data: {"type":"data-action-result","data":{"status":"pending"}}',
            "",
        ].join("\n")));
        const laterChunk = new Uint8Array(Buffer.from([
            'data: {"type":"text-delta","delta":"번째"}',
            "data: [DONE]",
            "",
        ].join("\n")));
        global.fetch = jest.fn().mockImplementation(async (input: string | URL | Request) => {
            const url = String(input);
            if (!url.endsWith("/chat")) return { ok: true, json: async () => [] } as Response;
            let readCount = 0;
            return {
                ok: true,
                headers: { get: () => "session-stream" },
                body: {
                    getReader: () => ({
                        read: async () => {
                            if (readCount === 0) {
                                readCount += 1;
                                markFirstChunkRead?.();
                                return { done: false, value: firstChunk };
                            }
                            if (readCount === 1) {
                                readCount += 1;
                                await new Promise<void>((resolve) => { releaseLaterChunk = resolve; });
                                return { done: false, value: laterChunk };
                            }
                            return { done: true, value: new Uint8Array() };
                        },
                    }),
                },
            } as unknown as Response;
        });
        const { result } = renderHook(() => useAgentChat());

        let sendPromise: Promise<void> | undefined;
        await act(async () => {
            sendPromise = result.current.sendMessage("질문");
            await firstChunkRead;
        });
        await waitFor(() => expect(result.current.messages).toHaveLength(2));
        const firstAssistant = result.current.messages.at(-1);
        expect(firstAssistant).toEqual({
            id: "assistant-stream-id",
            role: "assistant",
            parts: [
                { type: "text", text: "첫" },
                { type: "data-action-result", data: { status: "pending" } },
            ],
        });

        releaseLaterChunk?.();
        await act(async () => { await sendPromise; });

        const finalAssistant = result.current.messages.at(-1);
        expect(finalAssistant).not.toBe(firstAssistant);
        expect(finalAssistant?.parts).not.toBe(firstAssistant?.parts);
        expect(finalAssistant?.id).toBe(firstAssistant?.id);
        expect(finalAssistant?.parts).toEqual([
            { type: "text", text: "첫번째" },
            { type: "data-action-result", data: { status: "pending" } },
        ]);
    });

    it("does not append later chunks from an aborted stream", async () => {
        let releaseLaterChunk: (() => void) | undefined;
        let markFirstChunkRead: (() => void) | undefined;
        const firstChunkRead = new Promise<void>((resolve) => { markFirstChunkRead = resolve; });
        const firstChunk = new Uint8Array(Buffer.from([
            'data: {"type":"text-delta","delta":"첫"}',
            "",
        ].join("\n")));
        const laterChunk = new Uint8Array(Buffer.from([
            'data: {"type":"text-delta","delta":"늦은"}',
            "data: [DONE]",
            "",
        ].join("\n")));
        global.fetch = jest.fn().mockImplementation(async (input: string | URL | Request) => {
            const url = String(input);
            if (!url.endsWith("/chat")) return { ok: true, json: async () => [] } as Response;
            let readCount = 0;
            return {
                ok: true,
                headers: { get: () => "session-aborted" },
                body: {
                    getReader: () => ({
                        read: async () => {
                            if (readCount === 0) {
                                readCount += 1;
                                markFirstChunkRead?.();
                                return { done: false, value: firstChunk };
                            }
                            if (readCount === 1) {
                                readCount += 1;
                                await new Promise<void>((resolve) => { releaseLaterChunk = resolve; });
                                return { done: false, value: laterChunk };
                            }
                            return { done: true, value: new Uint8Array() };
                        },
                    }),
                },
            } as unknown as Response;
        });
        const { result } = renderHook(() => useAgentChat());

        let sendPromise: Promise<void> | undefined;
        await act(async () => {
            sendPromise = result.current.sendMessage("질문");
            await firstChunkRead;
        });
        await waitFor(() => expect(result.current.messages.at(-1)?.parts).toEqual([{ type: "text", text: "첫" }]));

        act(() => { result.current.stop(); });
        releaseLaterChunk?.();
        await act(async () => { await sendPromise; });

        expect(result.current.messages.at(-1)?.parts).toEqual([{ type: "text", text: "첫" }]);
    });

    it("retires a stopped stream before delayed abort rejection and allows a later send", async () => {
        let chatCallCount = 0;
        let releaseAbortedRead: (() => void) | undefined;
        let markFirstChunkRead: (() => void) | undefined;
        const firstChunkRead = new Promise<void>((resolve) => { markFirstChunkRead = resolve; });
        const firstChunk = new Uint8Array(Buffer.from([
            'data: {"type":"text-delta","delta":"부분"}',
            "",
        ].join("\n")));
        global.fetch = jest.fn().mockImplementation(async (input: string | URL | Request) => {
            const url = String(input);
            if (!url.endsWith("/chat")) return { ok: true, json: async () => [] } as Response;
            chatCallCount += 1;
            if (chatCallCount === 1) {
                let readCount = 0;
                return {
                    ok: true,
                    headers: { get: () => "session-stopped" },
                    body: {
                        getReader: () => ({
                            read: async () => {
                                if (readCount === 0) {
                                    readCount += 1;
                                    markFirstChunkRead?.();
                                    return { done: false, value: firstChunk };
                                }
                                if (readCount === 1) {
                                    readCount += 1;
                                    await new Promise<void>((resolve) => { releaseAbortedRead = resolve; });
                                    throw Object.assign(new Error("aborted"), { name: "AbortError" });
                                }
                                return { done: true, value: new Uint8Array() };
                            },
                        }),
                    },
                } as unknown as Response;
            }
            let consumed = false;
            return {
                ok: true,
                headers: { get: () => "session-next" },
                body: {
                    getReader: () => ({
                        read: async () => {
                            if (consumed) return { done: true, value: new Uint8Array() };
                            consumed = true;
                            return {
                                done: false,
                                value: new Uint8Array(Buffer.from([
                                    'data: {"type":"start","messageId":"assistant-next"}',
                                    'data: {"type":"text-delta","delta":"새 응답"}',
                                    "data: [DONE]",
                                    "",
                                ].join("\n"))),
                            };
                        },
                    }),
                },
            } as unknown as Response;
        });
        const { result } = renderHook(() => useAgentChat());

        let firstSend: Promise<void> | undefined;
        await act(async () => {
            firstSend = result.current.sendMessage("중단할 질문");
            await firstChunkRead;
        });
        await waitFor(() => expect(result.current.messages.at(-1)?.parts).toEqual([{ type: "text", text: "부분" }]));
        expect(result.current.status).toBe("streaming");

        act(() => { result.current.stop(); });
        expect(result.current.status).toBe("ready");

        releaseAbortedRead?.();
        await act(async () => { await firstSend; });
        expect(result.current.status).toBe("ready");
        expect(result.current.messages.at(-1)?.parts).toEqual([{ type: "text", text: "부분" }]);

        await act(async () => { await result.current.sendMessage("다음 질문"); });
        expect(result.current.status).toBe("ready");
        expect(result.current.messages.at(-1)).toEqual({
            id: "assistant-next",
            role: "assistant",
            parts: [{ type: "text", text: "새 응답" }],
        });
    });

    it("does not append later chunks from a stale stream after switching sessions", async () => {
        let releaseLaterChunk: (() => void) | undefined;
        let markFirstChunkRead: (() => void) | undefined;
        const firstChunkRead = new Promise<void>((resolve) => { markFirstChunkRead = resolve; });
        const firstChunk = new Uint8Array(Buffer.from([
            'data: {"type":"text-delta","delta":"이전"}',
            "",
        ].join("\n")));
        const laterChunk = new Uint8Array(Buffer.from([
            'data: {"type":"text-delta","delta":" 응답"}',
            "data: [DONE]",
            "",
        ].join("\n")));
        global.fetch = jest.fn().mockImplementation(async (input: string | URL | Request) => {
            const url = String(input);
            if (url.endsWith("/chat")) {
                let readCount = 0;
                return {
                    ok: true,
                    headers: { get: () => "session-old" },
                    body: {
                        getReader: () => ({
                            read: async () => {
                                if (readCount === 0) {
                                    readCount += 1;
                                    markFirstChunkRead?.();
                                    return { done: false, value: firstChunk };
                                }
                                if (readCount === 1) {
                                    readCount += 1;
                                    await new Promise<void>((resolve) => { releaseLaterChunk = resolve; });
                                    return { done: false, value: laterChunk };
                                }
                                return { done: true, value: new Uint8Array() };
                            },
                        }),
                    },
                } as unknown as Response;
            }
            if (url.endsWith("/sessions/session-new")) {
                return {
                    ok: true,
                    json: async () => ({
                        id: "session-new", title: "새 대화", updatedAt: "2026-08-04",
                        messages: [{ id: "message-new", role: "assistant", parts: [{ type: "text", text: "새 대화" }] }],
                    }),
                } as Response;
            }
            return { ok: true, json: async () => [] } as Response;
        });
        const { result } = renderHook(() => useAgentChat());

        let sendPromise: Promise<void> | undefined;
        await act(async () => {
            sendPromise = result.current.sendMessage("질문");
            await firstChunkRead;
        });
        await waitFor(() => expect(result.current.messages.at(-1)?.parts).toEqual([{ type: "text", text: "이전" }]));

        await act(async () => { await result.current.selectSession("session-new"); });
        releaseLaterChunk?.();
        await act(async () => { await sendPromise; });

        expect(result.current.messages).toEqual([
            { id: "message-new", role: "assistant", parts: [{ type: "text", text: "새 대화" }] },
        ]);
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

    it("ignores a pending selection after its target is deleted", async () => {
        let releaseSessionB: (() => void) | undefined;
        let markSessionBJsonStarted: (() => void) | undefined;
        const sessionBJsonStarted = new Promise<void>((resolve) => { markSessionBJsonStarted = resolve; });
        const sessionA = {
            id: "session-a", title: "현재 대화", updatedAt: "2026-08-03",
            messages: [{ id: "message-a", role: "assistant", parts: [{ type: "text", text: "현재 대화" }] }],
        };
        const sessionB = {
            id: "session-b", title: "삭제할 대화", updatedAt: "2026-08-04",
            messages: [{ id: "message-b", role: "assistant", parts: [{ type: "text", text: "삭제할 대화" }] }],
        };
        global.fetch = jest.fn().mockImplementation(async (input: string | URL | Request, init?: RequestInit) => {
            const url = String(input);
            if (url.endsWith("/sessions/session-a") && !init?.method) {
                return { ok: true, json: async () => sessionA } as Response;
            }
            if (url.endsWith("/sessions/session-b") && init?.method === "DELETE") {
                return { ok: true } as Response;
            }
            if (url.endsWith("/sessions/session-b") && !init?.method) {
                return {
                    ok: true,
                    json: async () => {
                        markSessionBJsonStarted?.();
                        await new Promise<void>((resolve) => { releaseSessionB = resolve; });
                        return sessionB;
                    },
                } as Response;
            }
            return { ok: true, json: async () => [] } as Response;
        });
        const { result } = renderHook(() => useAgentChat());

        await act(async () => { await result.current.selectSession("session-a"); });
        let selectionB: Promise<void> | undefined;
        await act(async () => {
            selectionB = result.current.selectSession("session-b");
            await sessionBJsonStarted;
        });

        await act(async () => { await result.current.deleteSession("session-b"); });
        releaseSessionB?.();
        await act(async () => { await selectionB; });

        expect(window.sessionStorage.getItem("agent_session_id")).toBe("session-a");
        expect(result.current.messages).toEqual(sessionA.messages);
    });

    it("does not let a stale selection cleanup clear a newer pending selection", async () => {
        let releaseSessionA: (() => void) | undefined;
        let releaseSessionB: (() => void) | undefined;
        let markSessionAJsonStarted: (() => void) | undefined;
        let markSessionBJsonStarted: (() => void) | undefined;
        const sessionAJsonStarted = new Promise<void>((resolve) => { markSessionAJsonStarted = resolve; });
        const sessionBJsonStarted = new Promise<void>((resolve) => { markSessionBJsonStarted = resolve; });
        global.fetch = jest.fn().mockImplementation(async (input: string | URL | Request, init?: RequestInit) => {
            const url = String(input);
            if (url.endsWith("/sessions/session-a") && !init?.method) {
                return {
                    ok: true,
                    json: async () => {
                        markSessionAJsonStarted?.();
                        await new Promise<void>((resolve) => { releaseSessionA = resolve; });
                        return { id: "session-a", title: "느린 대화", updatedAt: "2026-08-03", messages: [] };
                    },
                } as Response;
            }
            if (url.endsWith("/sessions/session-b") && init?.method === "DELETE") {
                return { ok: true } as Response;
            }
            if (url.endsWith("/sessions/session-b") && !init?.method) {
                return {
                    ok: true,
                    json: async () => {
                        markSessionBJsonStarted?.();
                        await new Promise<void>((resolve) => { releaseSessionB = resolve; });
                        return {
                            id: "session-b", title: "최신 대화", updatedAt: "2026-08-04",
                            messages: [{ id: "message-b", role: "assistant", parts: [{ type: "text", text: "최신 대화" }] }],
                        };
                    },
                } as Response;
            }
            return { ok: true, json: async () => [] } as Response;
        });
        const { result } = renderHook(() => useAgentChat());

        let selectionA: Promise<void> | undefined;
        await act(async () => {
            selectionA = result.current.selectSession("session-a");
            await sessionAJsonStarted;
        });
        let selectionB: Promise<void> | undefined;
        await act(async () => {
            selectionB = result.current.selectSession("session-b");
            await sessionBJsonStarted;
        });

        releaseSessionA?.();
        await act(async () => { await selectionA; });
        await act(async () => { await result.current.deleteSession("session-b"); });
        releaseSessionB?.();
        await act(async () => { await selectionB; });

        expect(window.sessionStorage.getItem("agent_session_id")).toBeNull();
        expect(result.current.messages).toEqual([]);
    });

    it.each([
        ["execution_failed", "failed", "nothing-happened", "승인 작업을 완료하지 못했습니다."],
        ["provider_reported_failure", "failed", "partial", "일부 단계가 실행되었을 수 있습니다."],
        ["provider_uncertain", "executing", "partial", "일부 단계가 실행되었을 수 있습니다."],
    ] as const)("preserves action error code for %s and classifies %s conservatively", async (errorCode, status, effectState, message) => {
        global.fetch = jest.fn().mockImplementation(async (input: string | URL | Request) => {
            const url = String(input);
            if (url.endsWith("/approve")) return { ok: false } as Response;
            if (url.endsWith("/actions/action-outcome")) {
                return { ok: true, json: async () => ({ status, error: { code: errorCode } }) } as Response;
            }
            return { ok: true, json: async () => [] } as Response;
        });
        const { result } = renderHook(() => useAgentChat());

        await act(async () => { await result.current.approveAction("action-outcome", "revision-a"); });

        expect(result.current.errorState).toEqual({ code: errorCode, message, effectState });
    });
});
