import { StrictMode, type ReactNode } from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";

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
        const restoredSessions = [{ id: "session-a", title: "대화", updatedAt: "2026-08-03" }];
        global.fetch = jest.fn().mockImplementation(async (input: string | URL | Request) => {
            const url = String(input);
            const payload = url === "/api/ai/agent/sessions"
                ? restoredSessions
                : url.endsWith("/sessions/session-a")
                    ? { id: "session-a", title: "대화", updatedAt: "2026-08-03", messages: restoredMessages }
                    : [];

            return { ok: true, json: async () => payload } as Response;
        });

        const { result } = renderHook(() => useAgentChat(), {
            wrapper: ({ children }: { children: ReactNode }) => <StrictMode>{children}</StrictMode>,
        });

        await waitFor(() => expect(setMessages).toHaveBeenCalledWith(restoredMessages));
        await waitFor(() => expect(result.current.sessions).toEqual(restoredSessions));
    });

    it.each(["delete", "archive"] as const)("ignores a delayed pre-mutation session list after %s", async (mutation) => {
        let listCallCount = 0;
        let releaseStaleList: (() => void) | undefined;
        let markStaleListStarted: (() => void) | undefined;
        let markStaleListResolved: (() => void) | undefined;
        const staleListStarted = new Promise<void>((resolve) => { markStaleListStarted = resolve; });
        const staleListResolved = new Promise<void>((resolve) => { markStaleListResolved = resolve; });
        const staleSessions = [{ id: "session-stale", title: "오래된 목록", updatedAt: "2026-08-03" }];
        const freshSessions = [{ id: "session-fresh", title: "최신 목록", updatedAt: "2026-08-04" }];
        global.fetch = jest.fn().mockImplementation(async (input: string | URL | Request, init?: RequestInit) => {
            const url = String(input);
            if (url === "/api/ai/agent/sessions") {
                listCallCount += 1;
                if (listCallCount === 1) {
                    return {
                        ok: true,
                        json: async () => {
                            markStaleListStarted?.();
                            await new Promise<void>((resolve) => { releaseStaleList = resolve; });
                            markStaleListResolved?.();
                            return staleSessions;
                        },
                    } as Response;
                }
                return { ok: true, json: async () => freshSessions } as Response;
            }
            if (url.endsWith("/sessions/session-stale") && (init?.method === "DELETE" || init?.method === "PATCH")) {
                return { ok: true, json: async () => ({}) } as Response;
            }
            return { ok: true, json: async () => [] } as Response;
        });
        const { result } = renderHook(() => useAgentChat());

        await staleListStarted;
        await act(async () => {
            if (mutation === "delete") await result.current.deleteSession("session-stale");
            else await result.current.archiveSession("session-stale");
        });
        expect(result.current.sessions).toEqual(freshSessions);

        releaseStaleList?.();
        await act(async () => { await staleListResolved; });
        expect(result.current.sessions).toEqual(freshSessions);
    });

    it("marks certain execution failures as nothing-happened and preserves the server error code", async () => {
        (useChat as jest.Mock).mockReturnValue({
            messages: [], setMessages: jest.fn(), sendMessage: jest.fn(), regenerate: jest.fn(), stop: jest.fn(), status: "ready",
        });
        global.fetch = jest.fn().mockImplementation(async (input: string | URL | Request) => {
            const url = String(input);
            if (url === "/api/ai/agent/sessions") return { ok: false } as Response;
            if (url.endsWith("/approve")) return { ok: false, json: async () => ({}) } as Response;
            if (url.endsWith("/api/ai/actions/action-a")) {
                return { ok: true, json: async () => ({ status: "failed", error: { code: "execution_failed" } }) } as Response;
            }
            return { ok: true, json: async () => [] } as Response;
        });
        const { result } = renderHook(() => useAgentChat());
        await waitFor(() => expect(global.fetch).toHaveBeenCalledWith("/api/ai/agent/sessions", { credentials: "same-origin" }));

        await act(async () => { await result.current.approveAction("action-a", "revision-a"); });

        expect(result.current.actionError).toEqual({
            code: "execution_failed",
            message: "승인된 작업을 완료하지 못했습니다.",
            effectState: "nothing-happened",
        });
    });

    it("keeps provider-reported failures partial and preserves the server error code", async () => {
        (useChat as jest.Mock).mockReturnValue({
            messages: [], setMessages: jest.fn(), sendMessage: jest.fn(), regenerate: jest.fn(), stop: jest.fn(), status: "ready",
        });
        global.fetch = jest.fn().mockImplementation(async (input: string | URL | Request) => {
            const url = String(input);
            if (url === "/api/ai/agent/sessions") return { ok: false } as Response;
            if (url.endsWith("/approve")) return { ok: false, json: async () => ({}) } as Response;
            if (url.endsWith("/api/ai/actions/action-b")) {
                return { ok: true, json: async () => ({ status: "failed", error: { code: "provider_reported_failure" } }) } as Response;
            }
            return { ok: true, json: async () => [] } as Response;
        });
        const { result } = renderHook(() => useAgentChat());
        await waitFor(() => expect(global.fetch).toHaveBeenCalledWith("/api/ai/agent/sessions", { credentials: "same-origin" }));

        await act(async () => { await result.current.approveAction("action-b", "revision-b"); });

        expect(result.current.actionError).toEqual({
            code: "provider_reported_failure",
            message: "작업의 일부 단계가 실행되었을 수 있습니다. 기록 확인 전에는 다시 실행하지 마세요.",
            effectState: "partial",
        });
    });

    it("stops the active stream and ignores an older overlapping session selection", async () => {
        const setMessages = jest.fn();
        const stop = jest.fn();
        (useChat as jest.Mock).mockReturnValue({ messages: [], setMessages, sendMessage: jest.fn(), regenerate: jest.fn(), stop, status: "ready" });
        let releaseA: (() => void) | undefined;
        global.fetch = jest.fn().mockImplementation(async (input: string | URL | Request) => {
            const url = String(input);
            if (url.endsWith("/sessions/session-a")) return { ok: true, json: async () => {
                await new Promise<void>((resolve) => { releaseA = resolve; });
                return { id: "session-a", messages: [{ id: "a" }] };
            } } as Response;
            if (url.endsWith("/sessions/session-b")) return { ok: true, json: async () => ({ id: "session-b", messages: [{ id: "b" }] }) } as Response;
            return { ok: true, json: async () => [] } as Response;
        });
        const { result } = renderHook(() => useAgentChat());

        const selectionA = result.current.selectSession("session-a");
        await waitFor(() => expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining("session-a"), expect.anything()));
        await result.current.selectSession("session-b");
        releaseA?.();
        await selectionA;

        expect(stop).toHaveBeenCalledTimes(2);
        expect(window.sessionStorage.getItem("agent_session_id")).toBe("session-b");
        expect(setMessages).toHaveBeenLastCalledWith([{ id: "b" }]);
    });

    it("stops and detaches active work before reset, archive, and delete", async () => {
        const setMessages = jest.fn();
        const stop = jest.fn();
        (useChat as jest.Mock).mockReturnValue({ messages: [], setMessages, sendMessage: jest.fn(), regenerate: jest.fn(), stop, status: "streaming" });
        global.fetch = jest.fn().mockImplementation(async () => ({ ok: true, json: async () => [] } as Response));
        const { result } = renderHook(() => useAgentChat());

        window.sessionStorage.setItem("agent_session_id", "session-a");
        await act(async () => { await result.current.archiveSession("session-a"); });
        window.sessionStorage.setItem("agent_session_id", "session-b");
        await act(async () => { await result.current.deleteSession("session-b"); });
        act(() => { result.current.resetBranch(); });

        expect(stop.mock.calls.length).toBeGreaterThanOrEqual(3);
        expect(window.sessionStorage.getItem("agent_session_id")).toBeNull();
        expect(setMessages).toHaveBeenCalledWith([]);
    });

    it("clears an inactive-at-start session selected before delete succeeds", async () => {
        const setMessages = jest.fn();
        const stop = jest.fn();
        (useChat as jest.Mock).mockReturnValue({ messages: [], setMessages, sendMessage: jest.fn(), regenerate: jest.fn(), stop, status: "streaming" });
        let releaseDelete: (() => void) | undefined;
        global.fetch = jest.fn().mockImplementation(async (input: string | URL | Request, init?: RequestInit) => {
            const url = String(input);
            if (url.endsWith("/sessions/session-history") && init?.method === "DELETE") {
                await new Promise<void>((resolve) => { releaseDelete = resolve; });
                return { ok: true, json: async () => ({}) } as Response;
            }
            if (url.endsWith("/sessions/session-history")) {
                return { ok: true, json: async () => ({ id: "session-history", messages: [{ id: "history" }] }) } as Response;
            }
            return { ok: true, json: async () => [] } as Response;
        });
        const { result } = renderHook(() => useAgentChat());

        await waitFor(() => expect(global.fetch).toHaveBeenCalledWith("/api/ai/agent/sessions", { credentials: "same-origin" }));
        window.sessionStorage.setItem("agent_session_id", "session-current");
        const deletion = result.current.deleteSession("session-history");
        await waitFor(() => expect(releaseDelete).toBeDefined());

        await act(async () => { await result.current.selectSession("session-history"); });
        const stopCallsAfterSelect = stop.mock.calls.length;
        expect(window.sessionStorage.getItem("agent_session_id")).toBe("session-history");
        expect(setMessages).toHaveBeenLastCalledWith([{ id: "history" }]);

        releaseDelete?.();
        await act(async () => { await deletion; });

        expect(stop).toHaveBeenCalledTimes(stopCallsAfterSelect + 1);
        expect(window.sessionStorage.getItem("agent_session_id")).toBeNull();
        expect(setMessages).toHaveBeenLastCalledWith([]);
    });

    it("clears an inactive-at-start session selected before archive succeeds", async () => {
        const setMessages = jest.fn();
        const stop = jest.fn();
        (useChat as jest.Mock).mockReturnValue({ messages: [], setMessages, sendMessage: jest.fn(), regenerate: jest.fn(), stop, status: "streaming" });
        let releaseArchive: (() => void) | undefined;
        global.fetch = jest.fn().mockImplementation(async (input: string | URL | Request, init?: RequestInit) => {
            const url = String(input);
            if (url.endsWith("/sessions/session-history") && init?.method === "PATCH") {
                await new Promise<void>((resolve) => { releaseArchive = resolve; });
                return { ok: true, json: async () => ({}) } as Response;
            }
            if (url.endsWith("/sessions/session-history")) {
                return { ok: true, json: async () => ({ id: "session-history", messages: [{ id: "history" }] }) } as Response;
            }
            return { ok: true, json: async () => [] } as Response;
        });
        const { result } = renderHook(() => useAgentChat());

        await waitFor(() => expect(global.fetch).toHaveBeenCalledWith("/api/ai/agent/sessions", { credentials: "same-origin" }));
        window.sessionStorage.setItem("agent_session_id", "session-current");
        const archive = result.current.archiveSession("session-history");
        await waitFor(() => expect(releaseArchive).toBeDefined());

        await act(async () => { await result.current.selectSession("session-history"); });
        const stopCallsAfterSelect = stop.mock.calls.length;
        expect(window.sessionStorage.getItem("agent_session_id")).toBe("session-history");
        expect(setMessages).toHaveBeenLastCalledWith([{ id: "history" }]);

        releaseArchive?.();
        await act(async () => { await archive; });

        expect(stop).toHaveBeenCalledTimes(stopCallsAfterSelect + 1);
        expect(window.sessionStorage.getItem("agent_session_id")).toBeNull();
        expect(setMessages).toHaveBeenLastCalledWith([]);
    });

    it("ignores a delayed selection after an inactive session is deleted", async () => {
        const setMessages = jest.fn();
        const stop = jest.fn();
        (useChat as jest.Mock).mockReturnValue({ messages: [], setMessages, sendMessage: jest.fn(), regenerate: jest.fn(), stop, status: "streaming" });
        let releaseSelection: (() => void) | undefined;
        global.fetch = jest.fn().mockImplementation(async (input: string | URL | Request, init?: RequestInit) => {
            const url = String(input);
            if (url.endsWith("/sessions/session-history") && !init?.method) {
                await new Promise<void>((resolve) => { releaseSelection = resolve; });
                return { ok: true, json: async () => ({ id: "session-history", messages: [{ id: "history" }] }) } as Response;
            }
            return { ok: true, json: async () => [] } as Response;
        });
        const { result } = renderHook(() => useAgentChat());

        await waitFor(() => expect(global.fetch).toHaveBeenCalledWith("/api/ai/agent/sessions", { credentials: "same-origin" }));
        window.sessionStorage.setItem("agent_session_id", "session-current");
        const selection = result.current.selectSession("session-history");
        await waitFor(() => expect(releaseSelection).toBeDefined());

        await act(async () => { await result.current.deleteSession("session-history"); });
        expect(window.sessionStorage.getItem("agent_session_id")).toBe("session-current");
        const stopCallsAfterDelete = stop.mock.calls.length;

        releaseSelection?.();
        await act(async () => { await selection; });

        expect(stop).toHaveBeenCalledTimes(stopCallsAfterDelete);
        expect(window.sessionStorage.getItem("agent_session_id")).toBe("session-current");
        expect(setMessages).not.toHaveBeenCalledWith([{ id: "history" }]);
    });

    it("ignores a delayed selection after an inactive session is archived", async () => {
        const setMessages = jest.fn();
        const stop = jest.fn();
        (useChat as jest.Mock).mockReturnValue({ messages: [], setMessages, sendMessage: jest.fn(), regenerate: jest.fn(), stop, status: "streaming" });
        let releaseSelection: (() => void) | undefined;
        global.fetch = jest.fn().mockImplementation(async (input: string | URL | Request, init?: RequestInit) => {
            const url = String(input);
            if (url.endsWith("/sessions/session-history") && !init?.method) {
                await new Promise<void>((resolve) => { releaseSelection = resolve; });
                return { ok: true, json: async () => ({ id: "session-history", messages: [{ id: "history" }] }) } as Response;
            }
            return { ok: true, json: async () => [] } as Response;
        });
        const { result } = renderHook(() => useAgentChat());

        await waitFor(() => expect(global.fetch).toHaveBeenCalledWith("/api/ai/agent/sessions", { credentials: "same-origin" }));
        window.sessionStorage.setItem("agent_session_id", "session-current");
        const selection = result.current.selectSession("session-history");
        await waitFor(() => expect(releaseSelection).toBeDefined());

        await act(async () => { await result.current.archiveSession("session-history"); });
        expect(window.sessionStorage.getItem("agent_session_id")).toBe("session-current");
        const stopCallsAfterArchive = stop.mock.calls.length;

        releaseSelection?.();
        await act(async () => { await selection; });

        expect(stop).toHaveBeenCalledTimes(stopCallsAfterArchive);
        expect(window.sessionStorage.getItem("agent_session_id")).toBe("session-current");
        expect(setMessages).not.toHaveBeenCalledWith([{ id: "history" }]);
    });

    it("clears an active deleted session after a failed replacement selection", async () => {
        const setMessages = jest.fn();
        const stop = jest.fn();
        (useChat as jest.Mock).mockReturnValue({ messages: [], setMessages, sendMessage: jest.fn(), regenerate: jest.fn(), stop, status: "streaming" });
        let releaseDelete: (() => void) | undefined;
        global.fetch = jest.fn().mockImplementation(async (input: string | URL | Request, init?: RequestInit) => {
            const url = String(input);
            if (url.endsWith("/sessions/session-b") && init?.method === "DELETE") {
                await new Promise<void>((resolve) => { releaseDelete = resolve; });
                return { ok: true, json: async () => ({}) } as Response;
            }
            if (url.endsWith("/sessions/session-c")) return { ok: false, json: async () => ({}) } as Response;
            return { ok: true, json: async () => [] } as Response;
        });
        const { result } = renderHook(() => useAgentChat());

        await waitFor(() => expect(global.fetch).toHaveBeenCalledWith("/api/ai/agent/sessions", { credentials: "same-origin" }));
        window.sessionStorage.setItem("agent_session_id", "session-b");
        const deletion = result.current.deleteSession("session-b");
        await waitFor(() => expect(releaseDelete).toBeDefined());

        await act(async () => { await result.current.selectSession("session-c"); });
        expect(window.sessionStorage.getItem("agent_session_id")).toBe("session-b");

        releaseDelete?.();
        await act(async () => { await deletion; });

        expect(stop).toHaveBeenCalledTimes(3);
        expect(window.sessionStorage.getItem("agent_session_id")).toBeNull();
        expect(setMessages).toHaveBeenLastCalledWith([]);
    });

    it("keeps the current stream alive when deleting an inactive historical session", async () => {
        const setMessages = jest.fn();
        const stop = jest.fn();
        (useChat as jest.Mock).mockReturnValue({ messages: [], setMessages, sendMessage: jest.fn(), regenerate: jest.fn(), stop, status: "streaming" });
        let releaseStream: (() => void) | undefined;
        global.fetch = jest.fn().mockImplementation(async (input: string | URL | Request) => {
            if (String(input) === "current-stream") {
                await new Promise<void>((resolve) => { releaseStream = resolve; });
                return { headers: { get: () => "stream-session" } } as unknown as Response;
            }
            return { ok: true, json: async () => [] } as Response;
        });
        const { result } = renderHook(() => useAgentChat());

        await waitFor(() => expect(global.fetch).toHaveBeenCalledWith("/api/ai/agent/sessions", { credentials: "same-origin" }));
        window.sessionStorage.setItem("agent_session_id", "session-current");
        const transportConfig = (DefaultChatTransport as jest.Mock).mock.calls[0][0] as { fetch: (input: string, init?: RequestInit) => Promise<Response> };
        const stream = transportConfig.fetch("current-stream");

        await act(async () => { await result.current.deleteSession("session-history"); });

        expect(stop).not.toHaveBeenCalled();
        expect(window.sessionStorage.getItem("agent_session_id")).toBe("session-current");
        releaseStream?.();
        await stream;

        expect(window.sessionStorage.getItem("agent_session_id")).toBe("stream-session");
        expect(setMessages).not.toHaveBeenCalledWith([]);
    });

    it("keeps the current stream alive when archiving an inactive historical session", async () => {
        const setMessages = jest.fn();
        const stop = jest.fn();
        (useChat as jest.Mock).mockReturnValue({ messages: [], setMessages, sendMessage: jest.fn(), regenerate: jest.fn(), stop, status: "streaming" });
        let releaseStream: (() => void) | undefined;
        global.fetch = jest.fn().mockImplementation(async (input: string | URL | Request) => {
            if (String(input) === "current-stream") {
                await new Promise<void>((resolve) => { releaseStream = resolve; });
                return { headers: { get: () => "stream-session" } } as unknown as Response;
            }
            return { ok: true, json: async () => [] } as Response;
        });
        const { result } = renderHook(() => useAgentChat());

        await waitFor(() => expect(global.fetch).toHaveBeenCalledWith("/api/ai/agent/sessions", { credentials: "same-origin" }));
        window.sessionStorage.setItem("agent_session_id", "session-current");
        const transportConfig = (DefaultChatTransport as jest.Mock).mock.calls[0][0] as { fetch: (input: string, init?: RequestInit) => Promise<Response> };
        const stream = transportConfig.fetch("current-stream");

        await act(async () => { await result.current.archiveSession("session-history"); });

        expect(stop).not.toHaveBeenCalled();
        expect(window.sessionStorage.getItem("agent_session_id")).toBe("session-current");
        releaseStream?.();
        await stream;

        expect(window.sessionStorage.getItem("agent_session_id")).toBe("stream-session");
        expect(setMessages).not.toHaveBeenCalledWith([]);
    });

    it("ignores a late stream response header after session reset", async () => {
        const stop = jest.fn();
        (useChat as jest.Mock).mockReturnValue({ messages: [], setMessages: jest.fn(), sendMessage: jest.fn(), regenerate: jest.fn(), stop, status: "streaming" });
        let releaseResponse: (() => void) | undefined;
        global.fetch = jest.fn().mockImplementation(async (input: string | URL | Request) => {
            if (String(input) === "old-stream") {
                await new Promise<void>((resolve) => { releaseResponse = resolve; });
                return { headers: { get: () => "stale-session" } } as unknown as Response;
            }
            return { ok: true, json: async () => [] } as Response;
        });
        const { result } = renderHook(() => useAgentChat());
        const transportConfig = (DefaultChatTransport as jest.Mock).mock.calls[0][0] as { fetch: (input: string, init?: RequestInit) => Promise<Response> };

        const pending = transportConfig.fetch("old-stream");
        result.current.resetBranch();
        releaseResponse?.();
        await pending;

        expect(stop).toHaveBeenCalled();
        expect(window.sessionStorage.getItem("agent_session_id")).toBeNull();
    });
});
