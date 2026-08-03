"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { BjjUIMessage } from "@babyjamjam/shared";

export type MobileAgentMessage = Pick<BjjUIMessage, "id" | "role" | "parts">;
type MobileAgentPart = { type: string; text?: string; data?: unknown };
export type MobileAgentSessionSummary = { id: string; title: string | null; updatedAt: string; messages?: MobileAgentMessage[] };
export type MobileAgentError = { code: string; message: string; effectState: "nothing-happened" | "succeeded-unconfirmed" | "partial" };
const AGENT_SESSION_KEY = "agent_session_id";

function makeId(): string { return `mobile-agent-${Date.now()}-${Math.random().toString(36).slice(2)}`; }

function isTruthy(value: string | undefined): boolean {
    return value === "1" || value?.toLowerCase() === "true";
}

/** Resolve the effective server-side capability flag before mounting the new shell. */
export function useAgentShellEnabled(): boolean | null {
    const shellConfigured = isTruthy(process.env.NEXT_PUBLIC_AGENT_SHELL_ENABLED);
    const [enabled, setEnabled] = useState<boolean | null>(shellConfigured ? null : false);
    useEffect(() => {
        if (!shellConfigured) return;
        let active = true;
        fetch("/api/ai/agent/capabilities", { credentials: "same-origin" })
            .then((response) => response.ok ? response.json() : [])
            .then((capabilities) => active && setEnabled(Array.isArray(capabilities) && capabilities.length > 0))
            .catch(() => active && setEnabled(false));
        return () => { active = false; };
    }, [shellConfigured]);
    return enabled;
}

export function useAgentChat() {
    const [messages, setMessages] = useState<MobileAgentMessage[]>([]);
    const [status, setStatus] = useState<"ready" | "streaming" | "error">("ready");
    const [sessions, setSessions] = useState<MobileAgentSessionSummary[]>([]);
    const [errorState, setErrorState] = useState<MobileAgentError | null>(null);
    const sessionId = useRef<string | undefined>(undefined);
    const abortRef = useRef<AbortController | null>(null);

    const refreshSessions = useCallback(async () => {
        const response = await fetch("/api/ai/agent/sessions", { credentials: "same-origin" });
        if (!response.ok) return;
        const value = await response.json() as unknown;
        setSessions(Array.isArray(value) ? value as MobileAgentSessionSummary[] : []);
    }, []);

    useEffect(() => { void refreshSessions(); }, [refreshSessions]);

    const sendMessage = useCallback(async (text: string) => {
        const content = text.trim();
        if (!content || status === "streaming") return;
        const userMessage = { id: makeId(), role: "user" as const, parts: [{ type: "text", text: content }] } as MobileAgentMessage;
        const nextMessages = [...messages, userMessage];
        setMessages(nextMessages);
        setErrorState(null);
        setStatus("streaming");
        const controller = new AbortController();
        abortRef.current = controller;
        try {
            const response = await fetch("/api/ai/agent/chat", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ sessionId: sessionId.current, locale: "ko", messages: [userMessage] }), signal: controller.signal });
            if (!response.ok || !response.body) throw new Error("Agent request failed");
            sessionId.current = response.headers.get("x-agent-session-id") ?? sessionId.current;
            if (sessionId.current && typeof window !== "undefined") window.sessionStorage.setItem(AGENT_SESSION_KEY, sessionId.current);
            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let buffer = "";
            const parts: MobileAgentPart[] = [];
            const consume = (line: string) => {
                if (!line.startsWith("data:")) return;
                const raw = line.slice(5).trim();
                if (!raw || raw === "[DONE]") return;
                try {
                    const chunk = JSON.parse(raw) as { type?: string; delta?: string; data?: unknown };
                    if (chunk.type === "text-delta" && typeof chunk.delta === "string") {
                        const previous = parts.find((part) => part.type === "text");
                        if (previous) previous.text = `${previous.text ?? ""}${chunk.delta}`;
                        else parts.push({ type: "text", text: chunk.delta });
                    } else if (chunk.type?.startsWith("data-")) {
                        parts.push({ type: chunk.type, data: chunk.data });
                    }
                } catch {
                    if (raw.startsWith('"')) parts.push({ type: "text", text: raw.slice(1, -1) });
                }
            };
            while (true) {
                const next = await reader.read();
                buffer += decoder.decode(next.value ?? new Uint8Array(), { stream: !next.done });
                const lines = buffer.split("\n");
                buffer = lines.pop() ?? "";
                lines.forEach(consume);
                if (next.done) break;
            }
            if (buffer) consume(buffer);
            setMessages((current) => [...current, { id: makeId(), role: "assistant", parts: parts.length > 0 ? parts : [{ type: "text", text: "응답을 받지 못했습니다." }] } as MobileAgentMessage]);
            setStatus("ready");
            await refreshSessions();
        } catch (error) {
            if ((error as Error).name !== "AbortError") {
                setStatus("error");
                setErrorState({ code: "stream_failed", message: "응답 스트림이 중단되었습니다.", effectState: "nothing-happened" });
            }
            else setStatus("ready");
        } finally {
            abortRef.current = null;
        }
    }, [messages, refreshSessions, status]);

    const stop = useCallback(() => abortRef.current?.abort(), []);
    const selectSession = useCallback(async (id: string) => {
        const response = await fetch(`/api/ai/agent/sessions/${encodeURIComponent(id)}`, { credentials: "same-origin" });
        if (!response.ok) {
            if (sessionId.current === id) sessionId.current = undefined;
            if (typeof window !== "undefined" && window.sessionStorage.getItem(AGENT_SESSION_KEY) === id) {
                window.sessionStorage.removeItem(AGENT_SESSION_KEY);
            }
            return;
        }
        const session = await response.json() as MobileAgentSessionSummary;
        sessionId.current = session.id;
        if (typeof window !== "undefined") window.sessionStorage.setItem(AGENT_SESSION_KEY, session.id);
        setMessages(session.messages ?? []);
    }, []);

    useEffect(() => {
        if (typeof window === "undefined") return;
        const storedSessionId = window.sessionStorage.getItem(AGENT_SESSION_KEY);
        if (!storedSessionId) return;
        sessionId.current = storedSessionId;
        void selectSession(storedSessionId).catch(() => {
            sessionId.current = undefined;
            window.sessionStorage.removeItem(AGENT_SESSION_KEY);
        });
    }, [selectSession]);

    const refreshCurrentSession = useCallback(async () => {
        if (!sessionId.current) return;
        await selectSession(sessionId.current);
    }, [selectSession]);

    const resolveActionError = useCallback(async (actionId: string, fallbackMessage: string): Promise<MobileAgentError> => {
        await refreshCurrentSession().catch(() => undefined);
        try {
            const response = await fetch(`/api/ai/agent/actions/${encodeURIComponent(actionId)}`, { credentials: "same-origin" });
            if (!response.ok) return { code: "action_unconfirmed", message: "작업 기록을 확인하지 못했습니다.", effectState: "succeeded-unconfirmed" };
            const action = await response.json() as { status?: unknown };
            if (action.status === "failed" || action.status === "executing") return { code: "action_partial", message: "일부 단계가 실행되었을 수 있습니다.", effectState: "partial" };
            if (action.status === "succeeded" || action.status === "uncertain") return { code: "action_unconfirmed", message: "최종 결과를 기록에서 확인해 주세요.", effectState: "succeeded-unconfirmed" };
            return { code: "action_failed", message: fallbackMessage, effectState: "nothing-happened" };
        } catch {
            return { code: "action_unconfirmed", message: "작업 기록을 확인하지 못했습니다.", effectState: "succeeded-unconfirmed" };
        }
    }, [refreshCurrentSession]);

    const approveAction = useCallback(async (actionId: string, expectedRevision: string, acknowledgementToken?: string) => {
        setErrorState(null);
        try {
            const response = await fetch(`/api/ai/agent/actions/${encodeURIComponent(actionId)}/approve`, {
                method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ expectedRevision, ...(acknowledgementToken ? { acknowledgementToken } : {}) }),
            });
            await refreshCurrentSession();
            if (!response.ok) setErrorState(await resolveActionError(actionId, "승인 작업을 완료하지 못했습니다."));
        } catch {
            setErrorState(await resolveActionError(actionId, "승인 결과를 확인하지 못했습니다."));
        }
    }, [refreshCurrentSession, resolveActionError]);

    const rejectAction = useCallback(async (actionId: string) => {
        setErrorState(null);
        try {
            const response = await fetch(`/api/ai/agent/actions/${encodeURIComponent(actionId)}/reject`, {
                method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: "{}",
            });
            await refreshCurrentSession();
            if (!response.ok) setErrorState(await resolveActionError(actionId, "거절 요청을 완료하지 못했습니다."));
        } catch {
            setErrorState(await resolveActionError(actionId, "거절 결과를 확인하지 못했습니다."));
        }
    }, [refreshCurrentSession, resolveActionError]);

    const submitStructuredForm = useCallback(async (formId: string, values: Record<string, unknown>) => {
        if (status === "streaming") return;
        const userMessage = { id: makeId(), role: "user" as const, parts: [{ type: "data-form-submit", data: { formId, values } }] } as MobileAgentMessage;
        setMessages((current) => [...current, userMessage]);
        setStatus("streaming");
        const controller = new AbortController();
        abortRef.current = controller;
        try {
            const response = await fetch("/api/ai/agent/chat", {
                method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" },
                body: JSON.stringify({ sessionId: sessionId.current, locale: "ko", messages: [userMessage] }), signal: controller.signal,
            });
            if (!response.ok) throw new Error("Agent form submission failed");
            sessionId.current = response.headers.get("x-agent-session-id") ?? sessionId.current;
            await response.text();
            await refreshCurrentSession();
            await refreshSessions();
            setStatus("ready");
        } catch (error) {
            setStatus((error as Error).name === "AbortError" ? "ready" : "error");
        } finally {
            abortRef.current = null;
        }
    }, [refreshCurrentSession, refreshSessions, status]);

    const deleteSession = useCallback(async (id: string) => {
        const response = await fetch(`/api/ai/agent/sessions/${encodeURIComponent(id)}`, { method: "DELETE", credentials: "same-origin" });
        if (!response.ok) return;
        if (sessionId.current === id) {
            sessionId.current = undefined;
            if (typeof window !== "undefined") window.sessionStorage.removeItem(AGENT_SESSION_KEY);
            setMessages([]);
        }
        await refreshSessions();
    }, [refreshSessions]);

    const submitFeedback = useCallback(async (messageId: string, type: "positive" | "negative", comment?: string) => {
        if (!sessionId.current) return;
        await fetch("/api/ai/agent/feedback", {
            method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" },
            body: JSON.stringify({ sessionId: sessionId.current, messageId, type, ...(comment ? { comment } : {}) }),
        });
    }, []);

    const resetBranch = useCallback(() => {
        stop();
        sessionId.current = undefined;
        if (typeof window !== "undefined") window.sessionStorage.removeItem(AGENT_SESSION_KEY);
        setMessages([]);
        setStatus("ready");
        setErrorState(null);
        void refreshSessions();
    }, [refreshSessions, stop]);
    return { messages, status, errorState, sendMessage, stop, resetBranch, sessions, refreshSessions, selectSession, deleteSession, approveAction, rejectAction, submitStructuredForm, submitFeedback };
}
