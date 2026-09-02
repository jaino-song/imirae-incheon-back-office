"use client";

import { useRef, useEffect, useCallback, useLayoutEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Trash2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import { ChatInput } from "@/components/app/chat/ChatInput";
import { AssistantMessage } from "@/components/app/chat/AssistantMessage";
import { useChatStream, ChatMessage, ChatState } from "@/hooks/useChatStream";

function UserMessage({ message }: { message: ChatMessage }) {
    return (
        <div data-component="desktop_chat_page_message-user-row" className="flex justify-end mb-4">
            <div data-component="desktop_chat_page_message-user-row_bubble" className="max-w-[80%] px-4 py-3 rounded-lg bg-primary text-primary-foreground">
                <p className="text-base whitespace-pre-wrap break-words">{message.content}</p>
            </div>
        </div>
    );
}

function ToolExecutingIndicator({ toolName }: { toolName: string | null }) {
    return (
        <div data-component="desktop_chat_page_tool-indicator" className="flex items-center gap-2 mb-4 px-4">
            <Spinner size="sm" />
            <p className="text-sm text-muted-foreground">{toolName ? `${toolName} 실행 중...` : "처리 중..."}</p>
        </div>
    );
}

function StateIndicator({ state }: { state: ChatState }) {
    if (state !== "connecting") return null;
    return (
        <div data-component="desktop_chat_page_state-indicator" className="flex items-center gap-2 mb-4 px-4">
            <Spinner size="sm" />
            <p className="text-sm text-muted-foreground">연결 중...</p>
        </div>
    );
}

export function LegacyChatPage() {
    const router = useRouter();
    const [isOpen, setIsOpen] = useState(false);
    const {
        messages,
        state,
        sessionId,
        sendMessage,
        confirmAction,
        cancelAction,
        pendingConfirmation,
        clearSession,
        isToolExecuting,
        currentTool,
        loadHistory,
        isLoadingHistory,
        hasMoreHistory,
    } = useChatStream();

    const handleSubmitFeedback = useCallback(async (
        messageIndex: number,
        type: "positive" | "negative",
        comment?: string,
    ) => {
        if (!sessionId) return;
        await fetch("/api/ai/chat/feedback", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ sessionId, messageIndex, type, comment }),
        });
    }, [sessionId]);

    const messagesEndRef = useRef<HTMLDivElement>(null);
    const scrollContainerRef = useRef<HTMLDivElement>(null);
    const prevScrollHeightRef = useRef(0);
    const lastMessageRef = useRef<ChatMessage | null>(null);

    useEffect(() => {
        const timer = setTimeout(() => setIsOpen(true), 10);
        return () => clearTimeout(timer);
    }, []);

    useEffect(() => {
        loadHistory(0);
    }, [loadHistory]);

    const handleScroll = useCallback(() => {
        const container = scrollContainerRef.current;
        if (!container) return;
        if (container.scrollTop < 100 && hasMoreHistory && !isLoadingHistory) {
            prevScrollHeightRef.current = container.scrollHeight;
            loadHistory(messages.length);
        }
    }, [hasMoreHistory, isLoadingHistory, messages.length, loadHistory]);

    useEffect(() => {
        const container = scrollContainerRef.current;
        if (!container) return;
        container.addEventListener("scroll", handleScroll);
        return () => container.removeEventListener("scroll", handleScroll);
    }, [handleScroll]);

    useLayoutEffect(() => {
        const container = scrollContainerRef.current;
        const lastMessage = messages[messages.length - 1];
        const isNewMessage = lastMessage !== lastMessageRef.current;
        if (!isNewMessage && container && prevScrollHeightRef.current > 0) {
            const diff = container.scrollHeight - prevScrollHeightRef.current;
            if (diff > 0) requestAnimationFrame(() => { container.scrollTop = diff; });
            prevScrollHeightRef.current = 0;
        } else if (isNewMessage && messagesEndRef.current) {
            messagesEndRef.current.scrollIntoView({ behavior: "smooth" });
        }
        lastMessageRef.current = lastMessage || null;
    }, [messages]);

    const handleBack = () => {
        setIsOpen(false);
        setTimeout(() => router.back(), 300);
    };
    const handleConfirm = () => { void confirmAction?.(); };
    const handleCancel = () => { cancelAction?.(); };
    const quickActions = ["산모 등록", "계약서 전송", "계약서 상태 조회"] as const;
    const lastMessage = messages[messages.length - 1];
    const showConfirmButtons = Boolean(pendingConfirmation) && lastMessage?.role === "assistant" && !lastMessage.isStreaming;

    return (
        <div data-component="desktop_chat_page" className={cn("fixed inset-0 h-dvh flex flex-col bg-background z-[1200]", "transition-transform duration-300 ease-out", isOpen ? "translate-y-0" : "translate-y-full")}>
            <div data-component="desktop_chat_page_header" className="flex items-center justify-between px-4 py-3 border-b border-border bg-card shrink-0">
                <div data-component="desktop_chat_page_header_title-group" className="flex items-center gap-2">
                    <Button variant="ghost" size="icon" onClick={handleBack} aria-label="뒤로가기" data-testid="chat-back"><ArrowLeft className="w-5 h-5" /></Button>
                    <Sparkles className="w-5 h-5 text-primary" />
                    <h1 className="text-lg font-semibold text-foreground">AI 어시스턴트</h1>
                </div>
                <Button variant="ghost" size="icon" onClick={clearSession} aria-label="대화 삭제" data-testid="chat-clear"><Trash2 className="w-5 h-5" /></Button>
            </div>

            <div data-component="desktop_chat_page_messages" ref={scrollContainerRef} className="flex-1 overflow-auto px-4 sm:px-8 py-6 select-text [-webkit-overflow-scrolling:touch]">
                {isLoadingHistory && messages.length > 0 && <div data-component="desktop_chat_page_messages_history-loading" className="flex justify-center p-4"><Spinner size="sm" /></div>}
                {messages.length === 0 ? (
                    <div data-component="desktop_chat_page_messages_empty" className="flex flex-col items-center justify-center h-full text-center text-muted-foreground animate-fade-in">
                        <Sparkles className="w-12 h-12 mb-4 opacity-50" />
                        <h2 className="text-lg font-semibold mb-2">무엇을 도와드릴까요?</h2>
                        <p className="text-sm">고객 검색, 직원 관리, 계약서 발송 등을 도와드립니다.</p>
                    </div>
                ) : (
                    <>
                        {messages.map((msg: ChatMessage, idx: number) => msg.role === "user" ? (
                            <UserMessage key={idx} message={msg} />
                        ) : (
                            <AssistantMessage key={idx} message={msg} messageIndex={idx} sessionId={sessionId} isToolExecuting={isToolExecuting} currentTool={currentTool} onSubmitFeedback={handleSubmitFeedback} />
                        ))}
                        {isToolExecuting && <ToolExecutingIndicator toolName={currentTool} />}
                        <StateIndicator state={state} />
                        {showConfirmButtons && (
                            <div data-component="desktop_chat_page_messages_confirm-actions" className="flex gap-2 mb-4 px-4">
                                <Button size="sm" onClick={handleConfirm} disabled={state === "streaming" || state === "connecting"}>확인</Button>
                                <Button variant="outline" size="sm" onClick={handleCancel} disabled={state === "streaming" || state === "connecting"}>취소</Button>
                            </div>
                        )}
                        <div ref={messagesEndRef} data-component="desktop_chat_page_messages_end" />
                    </>
                )}
            </div>

            <div data-component="desktop_chat_page_input-area" className="px-4 sm:px-8 py-4 border-t border-border bg-card shrink-0">
                <div data-component="desktop_chat_page_input-area_quick-actions" className="mb-3 flex flex-wrap gap-2">
                    {quickActions.map((label) => <Button key={label} type="button" variant="secondary" size="sm" onClick={() => sendMessage(label)} disabled={state === "streaming" || state === "connecting"} className="rounded-full">{label}</Button>)}
                </div>
                <ChatInput onSubmit={sendMessage} disabled={state === "streaming" || state === "connecting"} />
            </div>
        </div>
    );
}
