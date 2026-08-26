"use client";

import { useState, useCallback, useRef } from "react";
import { refreshAppAuthSession } from "@/lib/api/client";
import { safeStorageGetItem, safeStorageRemoveItem, safeStorageSetItem } from "@/lib/safe-storage";
import { extractClientRegistrationDraft } from "@/lib/client/client-registration-extraction";

export interface ChatMessage {
    role: "user" | "assistant";
    content: string;
    timestamp: string;
    isStreaming?: boolean;
        employeeDraft?: {
            name?: string;
            phone?: string;
        };
        ui?: {
        clientId?: number;
        clientName?: string;
        documentStatus?: string | null;
        serviceStatus?: string | null;
        registrationDraft?: {
            name?: string;
            phone?: string;
            birthday?: string;
            address?: string;
            dueDate?: string;
        };
        type: "clientRegistrationWizard" | "clientRegistrationSuccess" | "contractSendWizard" | "contractStatusWizard" | "contractStatusResponse";
    };
}

export interface ChatStreamEvent {
    type: "chunk" | "tool_call" | "confirmation" | "done" | "error";
    content?: string;
    toolName?: string;
    toolStatus?: string;
    confirmationMessage?: string;
    sessionId?: string;
    error?: string;
}

export type ChatState = "idle" | "connecting" | "streaming" | "complete" | "error";

interface UseChatStreamReturn {
    messages: ChatMessage[];
    state: ChatState;
    sessionId: string | null;
    error: string | null;
    sendMessage: (message: string) => Promise<void>;
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
const CHAT_SESSION_EXPIRED_MESSAGE =
    "세션이 만료되었습니다. 페이지를 새로고침하거나 다시 로그인해 주세요.";
const CHAT_PERMISSION_DENIED_MESSAGE =
    "이 기능에 접근할 권한이 없습니다. 관리자에게 문의해 주세요.";
const CHAT_TEMPORARY_ERROR_MESSAGE =
    "일시적인 오류로 응답을 가져오지 못했습니다. 잠시 후 다시 시도해 주세요.";

class ChatStreamResponseError extends Error {
    constructor(readonly status: number) {
        super(`Chat stream request failed with status ${status}`);
        this.name = "ChatStreamResponseError";
    }
}

function isChatStreamAuthError(error: unknown): boolean {
    return error instanceof ChatStreamResponseError
        && (error.status === 401 || error.status === 403);
}

function getChatStreamErrorMessage(error: unknown): string {
    if (error instanceof ChatStreamResponseError && error.status === 403) {
        return CHAT_PERMISSION_DENIED_MESSAGE;
    }
    if (isChatStreamAuthError(error)) {
        return CHAT_SESSION_EXPIRED_MESSAGE;
    }
    return CHAT_TEMPORARY_ERROR_MESSAGE;
}

function logChatStreamError(context: string, error: unknown): void {
    if (error instanceof ChatStreamResponseError) {
        console.error(`[chat] ${context}:`, { status: error.status });
        return;
    }

    console.error(`[chat] ${context}:`, error);
}

async function requestChatStream(init: RequestInit): Promise<Response> {
    const sendRequest = () => fetch("/api/ai/chat/stream", init);
    let response = await sendRequest();

    if (response.status === 401) {
        await response.body?.cancel().catch(() => undefined);

        // Share the axios interceptor's single-flight refresh: a second
        // concurrent refresh would consume the rotating refresh token and
        // force a full logout on the losing request.
        try {
            await refreshAppAuthSession();
        } catch {
            throw new ChatStreamResponseError(401);
        }

        response = await sendRequest();
    }

    if (!response.ok) {
        throw new ChatStreamResponseError(response.status);
    }

    return response;
}

// Map persisted wizard markers back to UI metadata
const WIZARD_MARKERS: Record<string, ChatMessage["ui"]> = {
    "[산모 등록 위자드 표시됨]": { type: "clientRegistrationWizard" },
    "[계약서 전송 위자드 표시됨]": { type: "contractSendWizard" },
    "[계약서 상태 조회 위자드 표시됨]": { type: "contractStatusWizard" },
};

const CLIENT_REGISTRATION_TRIGGER = /산모\s*등록|고객\s*등록/;

function clientRegistrationAssistantContent(draft: ReturnType<typeof extractClientRegistrationDraft>): string {
    const labels = {
        phone: "연락처",
        birthday: "생년월일 (YYMMDD)",
        address: "주소",
        dueDate: "출산 예정일 (YYMMDD)",
    } as const;

    return draft.missingFields.length === 0
        ? "[산모 등록 위자드 표시됨]"
        : `[산모 등록 위자드 표시됨] ${draft.missingFields.map((field) => `${labels[field]} 알려주세요.`).join(" ")}`;
}

function restoreMessageUI(msg: ChatMessage): ChatMessage {
    if (msg.role !== "assistant") return msg;
    
    const ui = WIZARD_MARKERS[msg.content];
    if (ui) {
        return { ...msg, content: "", ui };
    }
    return msg;
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

    const persistMessage = useCallback(async (userMessage: string, assistantContent: string) => {
        try {
            await fetch("/api/ai/chat/persist", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    sessionId,
                    userMessage,
                    assistantContent,
                }),
            });
        } catch (err) {
            console.error("[chat] failed to persist message:", err);
        }
    }, [sessionId]);

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

        // Save message for retry
        setLastMessage(trimmed);

        // Local command intercepts (no SSE call)
        if (CLIENT_REGISTRATION_TRIGGER.test(trimmed)) {
            const ts = new Date().toISOString();
            const draft = extractClientRegistrationDraft(trimmed);
            const employeeName = draft.employeeName;
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
                    ui: {
                        registrationDraft: { ...draft, employeeName: undefined },
                        type: "clientRegistrationWizard",
                    },
                },
            ]);
            // persist to backend (fire and forget)
            persistMessage(trimmed, clientRegistrationAssistantContent(draft));
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
            const response = await requestChatStream({
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
                            console.error("[chat] stream event reported an error");
                            setIsToolExecuting(false);
                            setCurrentTool(null);
                            setError(CHAT_TEMPORARY_ERROR_MESSAGE);
                            setState("error");
                            clearScheduledFlush();
                            flushPendingAssistant();
                            setMessages((prev) => {
                                const updated = [...prev];
                                const lastIdx = updated.length - 1;
                                if (lastIdx >= 0 && updated[lastIdx].role === "assistant") {
                                    updated[lastIdx] = {
                                        ...updated[lastIdx],
                                        content: CHAT_TEMPORARY_ERROR_MESSAGE,
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
                            console.error("[chat] buffered stream event reported an error");
                            setIsToolExecuting(false);
                            setCurrentTool(null);
                            setError(CHAT_TEMPORARY_ERROR_MESSAGE);
                            setState("error");
                            clearScheduledFlush();
                            flushPendingAssistant();
                            setMessages((prev) => {
                                const updated = [...prev];
                                const lastIdx = updated.length - 1;
                                if (lastIdx >= 0 && updated[lastIdx].role === "assistant") {
                                    updated[lastIdx] = {
                                        ...updated[lastIdx],
                                        content: CHAT_TEMPORARY_ERROR_MESSAGE,
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
            
            const errorMessage = getChatStreamErrorMessage(err);
            logChatStreamError("stream request failed", err);
            clearScheduledFlush();
            flushPendingAssistant();
            
            // Auto-retry logic: retry once automatically after 1 second
            if (retryCount < 1 && !isChatStreamAuthError(err)) {
                setRetryCount((prev) => prev + 1);
                setMessages((prev) => {
                    const updated = [...prev];
                    const lastIdx = updated.length - 1;
                    if (lastIdx >= 0 && updated[lastIdx].role === "assistant") {
                        updated[lastIdx] = {
                            ...updated[lastIdx],
                            content: `${errorMessage} 자동으로 다시 시도하고 있습니다.`,
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

                    requestChatStream({
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
                                        console.error("[chat] retried stream event reported an error");
                                        setIsToolExecuting(false);
                                        setCurrentTool(null);
                                        setError(CHAT_TEMPORARY_ERROR_MESSAGE);
                                        setState("error");
                                        clearScheduledFlush();
                                        flushPendingAssistant();
                                        setMessages((prev) => {
                                            const updated = [...prev];
                                            const lastIdx = updated.length - 1;
                                            if (lastIdx >= 0 && updated[lastIdx].role === "assistant") {
                                                updated[lastIdx] = {
                                                    ...updated[lastIdx],
                                                    content: CHAT_TEMPORARY_ERROR_MESSAGE,
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
                                        console.error("[chat] buffered retried stream event reported an error");
                                        setIsToolExecuting(false);
                                        setCurrentTool(null);
                                        setError(CHAT_TEMPORARY_ERROR_MESSAGE);
                                        setState("error");
                                        clearScheduledFlush();
                                        flushPendingAssistant();
                                        setMessages((prev) => {
                                            const updated = [...prev];
                                            const lastIdx = updated.length - 1;
                                            if (lastIdx >= 0 && updated[lastIdx].role === "assistant") {
                                                updated[lastIdx] = {
                                                    ...updated[lastIdx],
                                                    content: CHAT_TEMPORARY_ERROR_MESSAGE,
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
                        
                        const retryErrorMessage = getChatStreamErrorMessage(retryErr);
                        logChatStreamError("retried stream request failed", retryErr);
                        setError(retryErrorMessage);
                        setState("error");
                        
                        setMessages((prev) => {
                            const updated = [...prev];
                            const lastIdx = updated.length - 1;
                            if (lastIdx >= 0 && updated[lastIdx].role === "assistant") {
                                updated[lastIdx] = {
                                    ...updated[lastIdx],
                                    content: retryErrorMessage,
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
                        content: errorMessage,
                        isStreaming: false,
                    };
                }
                return updated;
            });
        }
    }, [sessionId, state, retryCount, persistMessage, clearScheduledFlush, flushPendingAssistant, scheduleFlushPendingAssistant]);

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
