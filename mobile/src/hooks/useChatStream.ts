"use client";

import { useState, useCallback, useRef } from "react";
import { safeStorageGetItem, safeStorageRemoveItem, safeStorageSetItem } from "@/lib/safe-storage";

export interface ChatMessage {
    role: "user" | "assistant";
    content: string;
    timestamp: string;
    isStreaming?: boolean;
    ui?: {
        clientId?: number;
        clientName?: string;
        documentStatus?: string | null;
        serviceStatus?: string | null;
        type: "clientRegistrationWizard" | "clientRegistrationSuccess" | "contractSendWizard" | "contractStatusWizard" | "contractStatusResponse";
    };
}

export interface ChatStreamEvent {
    type: "chunk" | "tool_call" | "confirmation" | "done" | "error";
    content?: string;
    toolName?: string;
    toolStatus?: string;
    confirmationMessage?: string;
    confirmationIntentId?: string;
    confirmationNonce?: string;
    confirmationExpiresAt?: string;
    sessionId?: string;
    error?: string;
}

export interface ChatConfirmation {
    intentId: string;
    nonce: string;
    sessionId: string;
    expiresAt: string | null;
    toolName?: string;
}

export type ChatState = "idle" | "connecting" | "streaming" | "complete" | "error";

interface UseChatStreamReturn {
    messages: ChatMessage[];
    state: ChatState;
    sessionId: string | null;
    error: string | null;
    sendMessage: (message: string) => Promise<void>;
    confirmAction: () => Promise<void>;
    cancelAction: () => void;
    pendingConfirmation: ChatConfirmation | null;
    loadHistory: (offset?: number) => Promise<void>;
    clearSession: () => void;
    appendMessage: (message: ChatMessage) => void;
    isToolExecuting: boolean;
    currentTool: string | null;
    isLoadingHistory: boolean;
    hasMoreHistory: boolean;
    totalMessages: number;
    retry: () => void;
    canRetry: boolean;
}

const SESSION_STORAGE_KEY = "ai_chat_session_id";

// Map persisted wizard markers back to UI metadata
const WIZARD_MARKERS: Record<string, ChatMessage["ui"]> = {
    "[산모 등록 위자드 표시됨]": { type: "clientRegistrationWizard" },
    "[계약서 전송 위자드 표시됨]": { type: "contractSendWizard" },
    "[계약서 상태 조회 위자드 표시됨]": { type: "contractStatusWizard" },
};

function restoreMessageUI(msg: ChatMessage): ChatMessage {
    if (msg.role !== "assistant") return msg;
    
    const ui = WIZARD_MARKERS[msg.content];
    if (ui) {
        return { ...msg, content: "", ui };
    }
    return msg;
}

function confirmationResultMessage(result: unknown): string {
    if (!result || typeof result !== "object") {
        return "요청이 처리되었습니다.";
    }

    const typedResult = result as { success?: unknown; data?: unknown; error?: unknown };
    if (typedResult.success === false) {
        return typeof typedResult.error === "string"
            ? `작업을 처리하지 못했습니다: ${typedResult.error}`
            : "작업을 처리하지 못했습니다.";
    }

    if (typedResult.data && typeof typedResult.data === "object") {
        const message = (typedResult.data as { message?: unknown }).message;
        if (typeof message === "string" && message.trim()) {
            return message;
        }
    }

    return "요청이 처리되었습니다.";
}

function confirmationRequestErrorMessage(status: number): string {
    if (status === 401) return "로그인이 만료되었습니다. 다시 로그인해 주세요.";
    if (status === 403) return "이 확인 요청에 접근할 권한이 없습니다.";
    if (status === 404) return "확인 요청을 찾을 수 없습니다. 새로 요청해 주세요.";
    if (status === 409) return "확인 요청이 이미 처리되었거나 만료되었습니다. 새로 요청해 주세요.";
    return "요청 결과를 확인할 수 없습니다. 중복 실행하지 말고 기록을 새로고침해 확인해 주세요.";
}

function parseSSEBuffer(buffer: string): { events: ChatStreamEvent[]; remaining: string } {
    const events: ChatStreamEvent[] = [];
    const normalized = buffer.replace(/\r/g, "");
    let cursor = 0;

    while (true) {
        const boundary = normalized.indexOf("\n\n", cursor);
        if (boundary === -1) break;

        const block = normalized.slice(cursor, boundary).trim();
        cursor = boundary + 2;

        if (!block) continue;

        const data = block
            .split("\n")
            .filter((line) => line.startsWith("data:"))
            .map((line) => line.slice(5).trimStart())
            .join("\n")
            .trim();

        if (!data || data === "[DONE]") continue;

        try {
            const parsed = JSON.parse(data) as ChatStreamEvent;
            events.push(parsed);
        } catch {
            // Ignore malformed partial chunks and keep streaming.
        }
    }

    return {
        events,
        remaining: normalized.slice(cursor),
    };
}

export function useChatStream(): UseChatStreamReturn {
    const [messages, setMessages] = useState<ChatMessage[]>([]);
    const [state, setState] = useState<ChatState>("idle");
    const [sessionId, setSessionId] = useState<string | null>(() => {
        return safeStorageGetItem("local", SESSION_STORAGE_KEY);
    });
    const [error, setError] = useState<string | null>(null);
    const [isToolExecuting, setIsToolExecuting] = useState(false);
    const [currentTool, setCurrentTool] = useState<string | null>(null);
    const [pendingConfirmation, setPendingConfirmation] = useState<ChatConfirmation | null>(null);
    const confirmationInFlightRef = useRef(false);

    const [isLoadingHistory, setIsLoadingHistory] = useState(false);
    const [hasMoreHistory, setHasMoreHistory] = useState(true);
    const [totalMessages, setTotalMessages] = useState(0);
    const isLoadingRef = useRef<boolean>(false);
    
    const abortControllerRef = useRef<AbortController | null>(null);

    // Streaming perf: batch many tiny SSE "chunk" events into at most ~1 UI update per frame.
    const pendingAssistantAppendRef = useRef("");
    const flushScheduleRef = useRef<{ kind: "raf" | "timeout"; id: number } | null>(null);

    const [retryCount, setRetryCount] = useState(0);
    const [lastMessage, setLastMessage] = useState<string | null>(null);

    const clearScheduledFlush = useCallback(() => {
        const scheduled = flushScheduleRef.current;
        if (!scheduled) return;
        if (scheduled.kind === "raf") {
            cancelAnimationFrame(scheduled.id);
        } else {
            clearTimeout(scheduled.id);
        }
        flushScheduleRef.current = null;
    }, []);

    const flushPendingAssistant = useCallback(() => {
        const delta = pendingAssistantAppendRef.current;
        if (!delta) return;
        pendingAssistantAppendRef.current = "";
        setMessages((prev) => {
            const updated = [...prev];
            const lastIdx = updated.length - 1;
            if (lastIdx >= 0 && updated[lastIdx].role === "assistant") {
                updated[lastIdx] = {
                    ...updated[lastIdx],
                    content: updated[lastIdx].content + delta,
                };
            }
            return updated;
        });
    }, []);

    const scheduleFlushPendingAssistant = useCallback(() => {
        if (flushScheduleRef.current) return;

        const run = () => {
            flushScheduleRef.current = null;
            flushPendingAssistant();
        };

        if (typeof window !== "undefined" && typeof window.requestAnimationFrame === "function") {
            flushScheduleRef.current = { kind: "raf", id: window.requestAnimationFrame(run) };
            return;
        }

        // Fallback for non-browser/test environments.
        flushScheduleRef.current = { kind: "timeout", id: setTimeout(run, 0) as unknown as number };
    }, [flushPendingAssistant]);

    const appendMessage = useCallback((message: ChatMessage) => {
        setMessages((prev) => [...prev, message]);
    }, []);

    const persistMessage = useCallback(async (
        userMessage: string,
        assistantContent: string,
        sessionIdOverride: string | null = sessionId,
    ) => {
        try {
            await fetch("/api/ai/chat/persist", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    sessionId: sessionIdOverride,
                    userMessage,
                    assistantContent,
                }),
            });
        } catch (err) {
            console.error("[chat] failed to persist message:", err);
        }
    }, [sessionId]);

    const handleConfirmationEvent = useCallback((event: ChatStreamEvent) => {
        setIsToolExecuting(false);
        setCurrentTool(null);
        clearScheduledFlush();
        flushPendingAssistant();

        if (event.confirmationMessage) {
            setMessages((prev) => {
                const updated = [...prev];
                const lastIdx = updated.length - 1;
                if (lastIdx >= 0 && updated[lastIdx].role === "assistant") {
                    updated[lastIdx] = {
                        ...updated[lastIdx],
                        content: event.confirmationMessage || "",
                        isStreaming: false,
                    };
                }
                return updated;
            });
        }

        if (event.confirmationIntentId && event.confirmationNonce && event.sessionId) {
            setPendingConfirmation({
                intentId: event.confirmationIntentId,
                nonce: event.confirmationNonce,
                sessionId: event.sessionId,
                expiresAt: event.confirmationExpiresAt ?? null,
                toolName: event.toolName,
            });
            return;
        }

        // A model-produced preview without a server intent is display-only.
        setPendingConfirmation(null);
        setError("확인 요청을 사용할 수 없습니다. 새로 요청해 주세요.");
    }, [clearScheduledFlush, flushPendingAssistant]);

    const confirmAction = useCallback(async () => {
        if (!pendingConfirmation || confirmationInFlightRef.current) return;

        confirmationInFlightRef.current = true;
        const confirmation = pendingConfirmation;
        setPendingConfirmation(null);
        setError(null);
        setIsToolExecuting(true);
        setCurrentTool(confirmation.toolName ?? null);
        setState("connecting");

        try {
            if (confirmation.expiresAt && Date.parse(confirmation.expiresAt) <= Date.now()) {
                const safeMessage = confirmationRequestErrorMessage(409);
                setError(safeMessage);
                appendMessage({
                    role: "assistant",
                    content: safeMessage,
                    timestamp: new Date().toISOString(),
                });
                setState("error");
                return;
            }

            const response = await fetch("/api/ai/chat/confirm", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                credentials: "include",
                body: JSON.stringify({
                    intentId: confirmation.intentId,
                    nonce: confirmation.nonce,
                    sessionId: confirmation.sessionId,
                }),
            });

            if (!response.ok) {
                const safeMessage = confirmationRequestErrorMessage(response.status);
                setError(safeMessage);
                appendMessage({
                    role: "assistant",
                    content: safeMessage,
                    timestamp: new Date().toISOString(),
                });
                setState("error");
                return;
            }

            const result = await response.json().catch(() => ({}));
            const resultMessage = confirmationResultMessage(result);
            appendMessage({
                role: "assistant",
                content: resultMessage,
                timestamp: new Date().toISOString(),
            });
            setSessionId(confirmation.sessionId);
            safeStorageSetItem("local", SESSION_STORAGE_KEY, confirmation.sessionId);
            await persistMessage("확인", resultMessage, confirmation.sessionId);
            setState("complete");
        } catch {
            const safeMessage = confirmationRequestErrorMessage(599);
            setError(safeMessage);
            appendMessage({
                role: "assistant",
                content: safeMessage,
                timestamp: new Date().toISOString(),
            });
            setState("error");
        } finally {
            setIsToolExecuting(false);
            setCurrentTool(null);
            confirmationInFlightRef.current = false;
        }
    }, [appendMessage, pendingConfirmation, persistMessage]);

    const cancelAction = useCallback(() => {
        setPendingConfirmation(null);
        setError(null);
        setState("complete");
    }, []);

    const loadHistory = useCallback(async (offset: number = 0) => {
        if (isLoadingRef.current) return;
        isLoadingRef.current = true;
        setIsLoadingHistory(true);
        try {
            const res = await fetch(`/api/ai/chat/history?offset=${offset}&limit=20`);
            if (!res.ok) {
                console.error("failed to load history:", res.status);
                setHasMoreHistory(false);
                return;
            }
            const data = await res.json();
            const restoredMessages = (data.messages as ChatMessage[]).map(restoreMessageUI);
            if (offset === 0) {
                setPendingConfirmation(null);
                setMessages(restoredMessages);
                if (data.sessionId) {
                    setSessionId(data.sessionId);
                    safeStorageSetItem("local", SESSION_STORAGE_KEY, data.sessionId);
                }
            } else {
                setMessages((prev) => [...restoredMessages, ...prev]);
            }
            setHasMoreHistory(data.hasMore);
            setTotalMessages(data.total);
        } catch (err) {
            console.error("error loading history:", err);
            setHasMoreHistory(false);
        } finally {
            isLoadingRef.current = false;
            setIsLoadingHistory(false);
        }
    }, []);

    const sendMessage = useCallback(async (message: string) => {
        if (state === "streaming" || state === "connecting") {
            return;
        }

        const trimmed = message.trim();
        if (!trimmed) {
            return;
        }

        // Starting a different turn abandons the display-only preview. The
        // server intent remains one-time and will expire without client-side
        // token persistence.
        setPendingConfirmation(null);

        // Save message for retry
        setLastMessage(trimmed);

        // Local command intercepts (no SSE call)
        if (trimmed === "산모 등록") {
            const ts = new Date().toISOString();
            setError(null);
            setIsToolExecuting(false);
            setCurrentTool(null);
            setMessages((prev) => [
                ...prev,
                {
                    role: "user",
                    content: trimmed,
                    timestamp: ts,
                },
                {
                    role: "assistant",
                    content: "",
                    timestamp: ts,
                    ui: { type: "clientRegistrationWizard" },
                },
            ]);
            // persist to backend (fire and forget)
            persistMessage(trimmed, "[산모 등록 위자드 표시됨]");
            setState("idle");
            return;
        }

        if (trimmed === "계약서 전송") {
            const ts = new Date().toISOString();
            setError(null);
            setIsToolExecuting(false);
            setCurrentTool(null);
            setMessages((prev) => [
                ...prev,
                {
                    role: "user",
                    content: trimmed,
                    timestamp: ts,
                },
                {
                    role: "assistant",
                    content: "",
                    timestamp: ts,
                    ui: { type: "contractSendWizard" },
                },
            ]);
            // persist to backend (fire and forget)
            persistMessage(trimmed, "[계약서 전송 위자드 표시됨]");
            setState("idle");
            return;
        }

        if (trimmed === "계약서 상태 조회") {
            const ts = new Date().toISOString();
            setError(null);
            setIsToolExecuting(false);
            setCurrentTool(null);
            setMessages((prev) => [
                ...prev,
                {
                    role: "user",
                    content: trimmed,
                    timestamp: ts,
                },
                {
                    role: "assistant",
                    content: "",
                    timestamp: ts,
                    ui: { type: "contractStatusWizard" },
                },
            ]);
            // persist to backend (fire and forget)
            persistMessage(trimmed, "[계약서 상태 조회 위자드 표시됨]");
            setState("idle");
            return;
        }

        setError(null);
        setState("connecting");

        const userMessage: ChatMessage = {
            role: "user",
            content: trimmed,
            timestamp: new Date().toISOString(),
        };

        const assistantMessage: ChatMessage = {
            role: "assistant",
            content: "",
            timestamp: new Date().toISOString(),
            isStreaming: true,
        };
        setMessages((prev) => [...prev, userMessage, assistantMessage]);

        abortControllerRef.current = new AbortController();

        try {
            const response = await fetch("/api/ai/chat/stream", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    sessionId,
                    message: trimmed,
                }),
                credentials: "include",
                signal: abortControllerRef.current.signal,
            });

            if (!response.ok) {
                throw new Error(`HTTP error: ${response.status}`);
            }

            setState("streaming");

            const reader = response.body?.getReader();
            if (!reader) {
                throw new Error("No response body");
            }

            const decoder = new TextDecoder();
            let buffer = "";

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                buffer += decoder.decode(value, { stream: true });
                const { events, remaining } = parseSSEBuffer(buffer);
                buffer = remaining;

                for (const event of events) {
                    switch (event.type) {
                        case "chunk":
                            if (event.content) {
                                pendingAssistantAppendRef.current += event.content;
                                scheduleFlushPendingAssistant();
                            }
                            break;

                        case "tool_call":
                            setIsToolExecuting(true);
                            setCurrentTool(event.toolName || null);
                            break;

                        case "confirmation":
                            handleConfirmationEvent(event);
                            break;

                        case "done":
                            setIsToolExecuting(false);
                            setCurrentTool(null);
                            clearScheduledFlush();
                            flushPendingAssistant();
                            if (event.sessionId) {
                                setSessionId(event.sessionId);
                                safeStorageSetItem("local", SESSION_STORAGE_KEY, event.sessionId);
                            }
                            setMessages((prev) => {
                                const updated = [...prev];
                                const lastIdx = updated.length - 1;
                                if (lastIdx >= 0 && updated[lastIdx].role === "assistant") {
                                    updated[lastIdx] = {
                                        ...updated[lastIdx],
                                        isStreaming: false,
                                    };
                                }
                                return updated;
                            });
                            setState("complete");
                            break;

                        case "error":
                            setIsToolExecuting(false);
                            setCurrentTool(null);
                            setError(event.error || "Unknown error");
                            setState("error");
                            clearScheduledFlush();
                            flushPendingAssistant();
                            setMessages((prev) => {
                                const updated = [...prev];
                                const lastIdx = updated.length - 1;
                                if (lastIdx >= 0 && updated[lastIdx].role === "assistant") {
                                    updated[lastIdx] = {
                                        ...updated[lastIdx],
                                        content: `Error: ${event.error}`,
                                        isStreaming: false,
                                    };
                                }
                                return updated;
                            });
                            break;
                    }
                }
            }

            // Flush any remaining buffered event data after stream end.
            if (buffer.trim()) {
                const { events } = parseSSEBuffer(`${buffer}\n\n`);
                for (const event of events) {
                    switch (event.type) {
                        case "chunk":
                            if (event.content) {
                                pendingAssistantAppendRef.current += event.content;
                                scheduleFlushPendingAssistant();
                            }
                            break;
                        case "tool_call":
                            setIsToolExecuting(true);
                            setCurrentTool(event.toolName || null);
                            break;
                        case "confirmation":
                            handleConfirmationEvent(event);
                            break;
                        case "done":
                            setIsToolExecuting(false);
                            setCurrentTool(null);
                            clearScheduledFlush();
                            flushPendingAssistant();
                            if (event.sessionId) {
                                setSessionId(event.sessionId);
                                safeStorageSetItem("local", SESSION_STORAGE_KEY, event.sessionId);
                            }
                            setMessages((prev) => {
                                const updated = [...prev];
                                const lastIdx = updated.length - 1;
                                if (lastIdx >= 0 && updated[lastIdx].role === "assistant") {
                                    updated[lastIdx] = {
                                        ...updated[lastIdx],
                                        isStreaming: false,
                                    };
                                }
                                return updated;
                            });
                            setState("complete");
                            break;
                        case "error":
                            setIsToolExecuting(false);
                            setCurrentTool(null);
                            setError(event.error || "Unknown error");
                            setState("error");
                            clearScheduledFlush();
                            flushPendingAssistant();
                            setMessages((prev) => {
                                const updated = [...prev];
                                const lastIdx = updated.length - 1;
                                if (lastIdx >= 0 && updated[lastIdx].role === "assistant") {
                                    updated[lastIdx] = {
                                        ...updated[lastIdx],
                                        content: `Error: ${event.error}`,
                                        isStreaming: false,
                                    };
                                }
                                return updated;
                            });
                            break;
                    }
                }
            }

            clearScheduledFlush();
            flushPendingAssistant();
            setState("complete");
            // Reset retry count on success
            setRetryCount(0);
        } catch (err) {
            if (err instanceof Error && err.name === "AbortError") {
                clearScheduledFlush();
                pendingAssistantAppendRef.current = "";
                setState("idle");
                return;
            }
            
            const errorMessage = err instanceof Error ? err.message : "Unknown error";
            clearScheduledFlush();
            flushPendingAssistant();
            
            // Auto-retry logic: retry once automatically after 1 second
            if (retryCount < 1) {
                setRetryCount((prev) => prev + 1);
                setMessages((prev) => {
                    const updated = [...prev];
                    const lastIdx = updated.length - 1;
                    if (lastIdx >= 0 && updated[lastIdx].role === "assistant") {
                        updated[lastIdx] = {
                            ...updated[lastIdx],
                            content: `Error: ${errorMessage}. Retrying...`,
                            isStreaming: false,
                        };
                    }
                    return updated;
                });
                
                // Wait 1 second and retry
                setTimeout(() => {
                    // Remove the error message and retry
                    setMessages((prev) => {
                        const updated = [...prev];
                        if (updated.length >= 2) {
                            updated.pop(); // remove assistant error
                            updated.pop(); // remove user message
                        }
                        return updated;
                    });
                    
                    // Retry by re-triggering the flow
                    setError(null);
                    setState("connecting");

                    const userMessage: ChatMessage = {
                        role: "user",
                        content: trimmed,
                        timestamp: new Date().toISOString(),
                    };

                    const assistantMessage: ChatMessage = {
                        role: "assistant",
                        content: "",
                        timestamp: new Date().toISOString(),
                        isStreaming: true,
                    };
                    setMessages((prev) => [...prev, userMessage, assistantMessage]);

                    abortControllerRef.current = new AbortController();

                    fetch("/api/ai/chat/stream", {
                        method: "POST",
                        headers: {
                            "Content-Type": "application/json",
                        },
                        body: JSON.stringify({
                            sessionId,
                            message: trimmed,
                        }),
                        credentials: "include",
                        signal: abortControllerRef.current.signal,
                    }).then(async (response) => {
                        if (!response.ok) {
                            throw new Error(`HTTP error: ${response.status}`);
                        }

                        setState("streaming");

                        const reader = response.body?.getReader();
                        if (!reader) {
                            throw new Error("No response body");
                        }

                        const decoder = new TextDecoder();
                        let buffer = "";

                        while (true) {
                            const { done, value } = await reader.read();
                            if (done) break;

                            buffer += decoder.decode(value, { stream: true });
                            const { events, remaining } = parseSSEBuffer(buffer);
                            buffer = remaining;

                            for (const event of events) {
                                switch (event.type) {
	                                    case "chunk":
	                                        if (event.content) {
	                                            pendingAssistantAppendRef.current += event.content;
	                                            scheduleFlushPendingAssistant();
	                                        }
	                                        break;

                                    case "tool_call":
                                        setIsToolExecuting(true);
                                        setCurrentTool(event.toolName || null);
                                        break;

                                    case "confirmation":
                                        handleConfirmationEvent(event);
                                        break;

	                                    case "done":
	                                        setIsToolExecuting(false);
	                                        setCurrentTool(null);
	                                        clearScheduledFlush();
	                                        flushPendingAssistant();
	                                        if (event.sessionId) {
	                                            setSessionId(event.sessionId);
	                                            safeStorageSetItem("local", SESSION_STORAGE_KEY, event.sessionId);
	                                        }
                                        setMessages((prev) => {
                                            const updated = [...prev];
                                            const lastIdx = updated.length - 1;
                                            if (lastIdx >= 0 && updated[lastIdx].role === "assistant") {
                                                updated[lastIdx] = {
                                                    ...updated[lastIdx],
                                                    isStreaming: false,
                                                };
                                            }
                                            return updated;
                                        });
                                        setState("complete");
                                        break;

	                                    case "error":
	                                        setIsToolExecuting(false);
	                                        setCurrentTool(null);
	                                        setError(event.error || "Unknown error");
	                                        setState("error");
	                                        clearScheduledFlush();
	                                        flushPendingAssistant();
	                                        setMessages((prev) => {
	                                            const updated = [...prev];
	                                            const lastIdx = updated.length - 1;
	                                            if (lastIdx >= 0 && updated[lastIdx].role === "assistant") {
                                                updated[lastIdx] = {
                                                    ...updated[lastIdx],
                                                    content: `Error: ${event.error}`,
                                                    isStreaming: false,
                                                };
                                            }
                                            return updated;
                                        });
                                        break;
                                }
                            }
                        }

                        if (buffer.trim()) {
                            const { events } = parseSSEBuffer(`${buffer}\n\n`);
                            for (const event of events) {
                                switch (event.type) {
	                                    case "chunk":
	                                        if (event.content) {
	                                            pendingAssistantAppendRef.current += event.content;
	                                            scheduleFlushPendingAssistant();
	                                        }
	                                        break;
                                    case "tool_call":
                                        setIsToolExecuting(true);
                                        setCurrentTool(event.toolName || null);
                                        break;
                                    case "confirmation":
                                        handleConfirmationEvent(event);
                                        break;
	                                    case "done":
	                                        setIsToolExecuting(false);
	                                        setCurrentTool(null);
	                                        clearScheduledFlush();
	                                        flushPendingAssistant();
	                                        if (event.sessionId) {
	                                            setSessionId(event.sessionId);
	                                            safeStorageSetItem("local", SESSION_STORAGE_KEY, event.sessionId);
	                                        }
                                        setMessages((prev) => {
                                            const updated = [...prev];
                                            const lastIdx = updated.length - 1;
                                            if (lastIdx >= 0 && updated[lastIdx].role === "assistant") {
                                                updated[lastIdx] = {
                                                    ...updated[lastIdx],
                                                    isStreaming: false,
                                                };
                                            }
                                            return updated;
                                        });
                                        setState("complete");
                                        break;
	                                    case "error":
	                                        setIsToolExecuting(false);
	                                        setCurrentTool(null);
	                                        setError(event.error || "Unknown error");
	                                        setState("error");
	                                        clearScheduledFlush();
	                                        flushPendingAssistant();
	                                        setMessages((prev) => {
	                                            const updated = [...prev];
	                                            const lastIdx = updated.length - 1;
	                                            if (lastIdx >= 0 && updated[lastIdx].role === "assistant") {
                                                updated[lastIdx] = {
                                                    ...updated[lastIdx],
                                                    content: `Error: ${event.error}`,
                                                    isStreaming: false,
                                                };
                                            }
                                            return updated;
                                        });
                                        break;
                                }
                            }
                        }

                        clearScheduledFlush();
                        flushPendingAssistant();
                        setState("complete");
                        setRetryCount(0);
                    }).catch((retryErr) => {
                        clearScheduledFlush();
                        flushPendingAssistant();
                        if (retryErr instanceof Error && retryErr.name === "AbortError") {
                            setState("idle");
                            return;
                        }
                        
                        const retryErrorMessage = retryErr instanceof Error ? retryErr.message : "Unknown error";
                        setError(retryErrorMessage);
                        setState("error");
                        
                        setMessages((prev) => {
                            const updated = [...prev];
                            const lastIdx = updated.length - 1;
                            if (lastIdx >= 0 && updated[lastIdx].role === "assistant") {
                                updated[lastIdx] = {
                                    ...updated[lastIdx],
                                    content: `Error: ${retryErrorMessage}`,
                                    isStreaming: false,
                                };
                            }
                            return updated;
                        });
                    });
                }, 1000);
                return;
            }
            
            // After second failure, show error (manual retry needed)
            setError(errorMessage);
            setState("error");
            
            setMessages((prev) => {
                const updated = [...prev];
                const lastIdx = updated.length - 1;
                if (lastIdx >= 0 && updated[lastIdx].role === "assistant") {
                    updated[lastIdx] = {
                        ...updated[lastIdx],
                        content: `Error: ${errorMessage}`,
                        isStreaming: false,
                    };
                }
                return updated;
            });
        }
    }, [sessionId, state, retryCount, persistMessage, clearScheduledFlush, flushPendingAssistant, scheduleFlushPendingAssistant, handleConfirmationEvent]);

    const clearSession = useCallback(async () => {
        if (abortControllerRef.current) {
            abortControllerRef.current.abort();
        }

        const currentSessionId = sessionId;
        
        setMessages([]);
        setSessionId(null);
        setState("idle");
        setError(null);
        setIsToolExecuting(false);
        setCurrentTool(null);
        setPendingConfirmation(null);
        safeStorageRemoveItem("local", SESSION_STORAGE_KEY);

        if (currentSessionId) {
            try {
                await fetch(`/api/ai/chat/sessions/${currentSessionId}`, {
                    method: "DELETE",
                });
            } catch (e) {
                console.error("Failed to delete session:", e);
            }
        }
    }, [sessionId]);

    const retry = useCallback(() => {
        if (lastMessage && state === "error") {
            setRetryCount(0);
            setError(null);
            setMessages((prev) => {
                const updated = [...prev];
                if (updated.length >= 2) {
                    updated.pop();
                    updated.pop();
                }
                return updated;
            });
            sendMessage(lastMessage);
        }
    }, [lastMessage, state, sendMessage]);

    return {
        messages,
        state,
        sessionId,
        error,
        sendMessage,
        confirmAction,
        cancelAction,
        pendingConfirmation,
        loadHistory,
        clearSession,
        appendMessage,
        isToolExecuting,
        currentTool,
        isLoadingHistory,
        hasMoreHistory,
        totalMessages,
        retry,
        canRetry: state === "error" && lastMessage !== null,
    };
}
