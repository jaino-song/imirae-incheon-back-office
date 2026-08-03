"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DefaultChatTransport } from "ai";
import { useChat } from "@ai-sdk/react";
import type { UIMessage } from "ai";

const AGENT_SESSION_KEY = "agent_session_id";

class SessionOperationEpoch {
    #value = 0;

    read(): number {
        return this.#value;
    }

    next(): number {
        this.#value += 1;
        return this.#value;
    }
}

export type AgentSessionSummary = {
    id: string;
    title: string | null;
    updatedAt: string;
    messages?: UIMessage[];
};

export type AgentClientError = {
    code: string;
    message: string;
    effectState: "nothing-happened" | "succeeded-unconfirmed" | "partial";
};

function actionErrorFromStatus(status: unknown, fallbackCode: string, fallbackMessage: string): AgentClientError {
    if (status === "uncertain" || status === "succeeded") {
        return { code: "action_result_unconfirmed", message: "서버 작업 기록을 새로고침해 최종 결과를 확인해 주세요.", effectState: "succeeded-unconfirmed" };
    }
    if (status === "failed" || status === "executing") {
        return { code: "action_partial", message: "작업의 일부 단계가 실행되었을 수 있습니다. 기록 확인 전에는 다시 실행하지 마세요.", effectState: "partial" };
    }
    return { code: fallbackCode, message: fallbackMessage, effectState: "nothing-happened" };
}

function isTruthy(value: string | undefined): boolean {
    return value === "1" || value?.toLowerCase() === "true";
}

function readAgentSessionId(): string | null {
    return typeof window === "undefined" ? null : window.sessionStorage.getItem(AGENT_SESSION_KEY);
}

function makeAgentTransport(transportFetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>) {
    return new DefaultChatTransport({
        api: "/api/ai/agent/chat",
        credentials: "same-origin",
        prepareSendMessagesRequest: ({ messages, body }) => ({
            body: { ...body, messages: messages.slice(-1) },
        }),
        fetch: transportFetch,
        body: () => ({
            sessionId: typeof window === "undefined" ? undefined : window.sessionStorage.getItem(AGENT_SESSION_KEY) ?? undefined,
            locale: "ko",
        }),
    });
}

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
    const [sessions, setSessions] = useState<AgentSessionSummary[]>([]);
    const [actionError, setActionError] = useState<AgentClientError | null>(null);
    const restoredSession = useRef(false);
    const activeSessionIdRef = useRef<string | null>(readAgentSessionId());
    const sessionSelectionGenerationRef = useRef(new Map<string, number>());
    const invalidatedSelectionGenerationRef = useRef(new Map<string, number>());
    const sessionOperationEpoch = useMemo(() => new SessionOperationEpoch(), []);

    const refreshSessions = useCallback(async () => {
        const requestEpoch = sessionOperationEpoch.read();
        const response = await fetch("/api/ai/agent/sessions", { credentials: "same-origin" });
        if (!response.ok) return;
        const next = await response.json() as AgentSessionSummary[];
        if (requestEpoch !== sessionOperationEpoch.read()) return;
        setSessions(Array.isArray(next) ? next : []);
    }, [sessionOperationEpoch]);

    const transportFetch = useCallback(async (input: RequestInfo | URL, init?: RequestInit) => {
        const requestEpoch = sessionOperationEpoch.read();
        const response = await fetch(input, init);
        const sessionId = response.headers.get("x-agent-session-id");
        if (requestEpoch === sessionOperationEpoch.read() && sessionId && typeof window !== "undefined") {
            window.sessionStorage.setItem(AGENT_SESSION_KEY, sessionId);
        }
        return response;
    }, [sessionOperationEpoch]);
    const transport = useMemo(() => makeAgentTransport(transportFetch), [transportFetch]);
    const chat = useChat({
        transport,
        experimental_throttle: 50,
        onFinish: () => { void refreshSessions(); },
    });

    const selectSession = useCallback(async (sessionId: string) => {
        const selectionGeneration = (sessionSelectionGenerationRef.current.get(sessionId) ?? 0) + 1;
        sessionSelectionGenerationRef.current.set(sessionId, selectionGeneration);
        const operationEpoch = sessionOperationEpoch.next();
        chat.stop();
        const response = await fetch(`/api/ai/agent/sessions/${encodeURIComponent(sessionId)}`, { credentials: "same-origin" });
        if (operationEpoch !== sessionOperationEpoch.read()) return;
        if ((invalidatedSelectionGenerationRef.current.get(sessionId) ?? 0) >= selectionGeneration) return;
        if (!response.ok) {
            if (activeSessionIdRef.current === sessionId) activeSessionIdRef.current = null;
            if (typeof window !== "undefined" && window.sessionStorage.getItem(AGENT_SESSION_KEY) === sessionId) {
                window.sessionStorage.removeItem(AGENT_SESSION_KEY);
            }
            return;
        }
        const session = await response.json() as AgentSessionSummary;
        if (operationEpoch !== sessionOperationEpoch.read()) return;
        if ((invalidatedSelectionGenerationRef.current.get(sessionId) ?? 0) >= selectionGeneration) return;
        activeSessionIdRef.current = session.id;
        if (typeof window !== "undefined") window.sessionStorage.setItem(AGENT_SESSION_KEY, session.id);
        chat.setMessages(session.messages ?? []);
    }, [chat, sessionOperationEpoch]);

    const refreshCurrentSession = useCallback(async () => {
        const sessionId = readAgentSessionId();
        if (!sessionId) return;
        const requestEpoch = sessionOperationEpoch.read();
        const response = await fetch(`/api/ai/agent/sessions/${encodeURIComponent(sessionId)}`, { credentials: "same-origin" });
        if (!response.ok) return;
        const session = await response.json() as AgentSessionSummary;
        if (requestEpoch !== sessionOperationEpoch.read()) return;
        chat.setMessages(session.messages ?? []);
    }, [chat, sessionOperationEpoch]);

    useEffect(() => {
        if (restoredSession.current) return;
        restoredSession.current = true;
        queueMicrotask(() => {
            void refreshSessions();
            const sessionId = window.sessionStorage.getItem(AGENT_SESSION_KEY);
            if (sessionId) void selectSession(sessionId).catch(() => window.sessionStorage.removeItem(AGENT_SESSION_KEY));
        });
    }, [refreshSessions, selectSession]);

    const resolveActionError = useCallback(async (actionId: string, fallbackCode: string, fallbackMessage: string) => {
        await refreshCurrentSession().catch(() => undefined);
        try {
            const response = await fetch(`/api/ai/actions/${encodeURIComponent(actionId)}`, { credentials: "same-origin" });
            if (!response.ok) return { code: "action_unconfirmed", message: "작업 기록을 확인하지 못했습니다. 중복 실행하지 마세요.", effectState: "succeeded-unconfirmed" as const };
            const action = await response.json() as { status?: unknown };
            return actionErrorFromStatus(action.status, fallbackCode, fallbackMessage);
        } catch {
            return { code: "action_unconfirmed", message: "작업 기록을 확인하지 못했습니다. 중복 실행하지 마세요.", effectState: "succeeded-unconfirmed" as const };
        }
    }, [refreshCurrentSession]);

    const approveAction = useCallback(async (actionId: string, expectedRevision: string, acknowledgementToken?: string) => {
        setActionError(null);
        try {
            const response = await fetch(`/api/ai/actions/${encodeURIComponent(actionId)}/approve`, {
                method: "POST",
                credentials: "same-origin",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ expectedRevision, ...(acknowledgementToken ? { acknowledgementToken } : {}) }),
            });
            await refreshCurrentSession();
            if (!response.ok) setActionError(await resolveActionError(actionId, "approval_failed", "승인된 작업을 완료하지 못했습니다."));
        } catch {
            setActionError(await resolveActionError(actionId, "approval_unconfirmed", "승인 요청의 최종 결과를 확인하지 못했습니다."));
        }
    }, [refreshCurrentSession, resolveActionError]);

    const rejectAction = useCallback(async (actionId: string) => {
        setActionError(null);
        try {
            const response = await fetch(`/api/ai/actions/${encodeURIComponent(actionId)}/reject`, {
                method: "POST",
                credentials: "same-origin",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({}),
            });
            await refreshCurrentSession();
            if (!response.ok) setActionError(await resolveActionError(actionId, "rejection_failed", "거절 요청을 완료하지 못했습니다."));
        } catch {
            setActionError(await resolveActionError(actionId, "rejection_unconfirmed", "거절 요청의 최종 결과를 확인하지 못했습니다."));
        }
    }, [refreshCurrentSession, resolveActionError]);

    const submitStructuredForm = useCallback((formId: string, values: Record<string, unknown>) => {
        void chat.sendMessage({
            role: "user",
            parts: [{ type: "data-form-submit", data: { formId, values } }],
        } as never);
    }, [chat]);

    const submitFeedback = useCallback(async (messageId: string, type: "positive" | "negative", comment?: string) => {
        const sessionId = typeof window === "undefined" ? null : window.sessionStorage.getItem(AGENT_SESSION_KEY);
        if (!sessionId) return;
        await fetch("/api/ai/agent/feedback", {
            method: "POST",
            credentials: "same-origin",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ sessionId, messageId, type, ...(comment ? { comment } : {}) }),
        });
    }, []);

    const invalidatePendingSelection = useCallback((sessionId: string) => {
        const selectionGeneration = sessionSelectionGenerationRef.current.get(sessionId);
        if (selectionGeneration === undefined) return;
        const previousInvalidation = invalidatedSelectionGenerationRef.current.get(sessionId) ?? 0;
        if (selectionGeneration > previousInvalidation) {
            invalidatedSelectionGenerationRef.current.set(sessionId, selectionGeneration);
        }
    }, []);

    const deleteSession = useCallback(async (sessionId: string) => {
        activeSessionIdRef.current = readAgentSessionId();
        const deletingActiveSession = activeSessionIdRef.current === sessionId;
        if (deletingActiveSession) {
            sessionOperationEpoch.next();
            chat.stop();
        }
        const response = await fetch(`/api/ai/agent/sessions/${encodeURIComponent(sessionId)}`, { method: "DELETE", credentials: "same-origin" });
        if (!response.ok) return;
        invalidatePendingSelection(sessionId);
        const activeSessionAtResponse = activeSessionIdRef.current === sessionId;
        if (activeSessionAtResponse) {
            sessionOperationEpoch.next();
            chat.stop();
            activeSessionIdRef.current = null;
            window.sessionStorage.removeItem(AGENT_SESSION_KEY);
            chat.setMessages([]);
        }
        await refreshSessions();
    }, [chat, invalidatePendingSelection, refreshSessions, sessionOperationEpoch]);

    const renameSession = useCallback(async (sessionId: string, title: string) => {
        const nextTitle = title.trim();
        if (!nextTitle) return false;
        const response = await fetch(`/api/ai/agent/sessions/${encodeURIComponent(sessionId)}`, {
            method: "PATCH",
            credentials: "same-origin",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ title: nextTitle }),
        });
        if (!response.ok) return false;
        await refreshSessions();
        return true;
    }, [refreshSessions]);

    const archiveSession = useCallback(async (sessionId: string) => {
        activeSessionIdRef.current = readAgentSessionId();
        const archivingActiveSession = activeSessionIdRef.current === sessionId;
        if (archivingActiveSession) {
            sessionOperationEpoch.next();
            chat.stop();
        }
        const response = await fetch(`/api/ai/agent/sessions/${encodeURIComponent(sessionId)}`, {
            method: "PATCH",
            credentials: "same-origin",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ archived: true }),
        });
        if (!response.ok) return;
        invalidatePendingSelection(sessionId);
        const activeSessionAtResponse = activeSessionIdRef.current === sessionId;
        if (activeSessionAtResponse) {
            sessionOperationEpoch.next();
            chat.stop();
            activeSessionIdRef.current = null;
            window.sessionStorage.removeItem(AGENT_SESSION_KEY);
            chat.setMessages([]);
        }
        await refreshSessions();
    }, [chat, invalidatePendingSelection, refreshSessions, sessionOperationEpoch]);

    const resetBranch = () => {
        sessionOperationEpoch.next();
        chat.stop();
        activeSessionIdRef.current = null;
        if (typeof window !== "undefined") window.sessionStorage.removeItem(AGENT_SESSION_KEY);
        chat.setMessages([]);
        setActionError(null);
        void refreshSessions();
    };

    return { ...chat, actionError, clearActionError: () => setActionError(null), resetBranch, sessions, refreshSessions, selectSession, renameSession, archiveSession, deleteSession, approveAction, rejectAction, submitStructuredForm, submitFeedback };
}
