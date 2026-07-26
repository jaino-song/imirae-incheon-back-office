"use client";

import { useRef, useEffect, useCallback, useLayoutEffect, useState } from "react";
import { X, Trash2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import { ChatInput } from "./ChatInput";
import { AssistantMessage } from "./AssistantMessage";
import { useChatStream, ChatMessage, ChatState } from "@/hooks/useChatStream";

// Hook to track visual viewport height for mobile keyboard handling
function useVisualViewportHeight() {
    const [height, setHeight] = useState<number | null>(null);

    useEffect(() => {
        // Only run on client side
        if (typeof window === "undefined") return;

        const updateHeight = () => {
            if (window.visualViewport) {
                setHeight(window.visualViewport.height);
            } else {
                setHeight(window.innerHeight);
            }
        };

        // Initial set
        updateHeight();

        // Listen to visual viewport changes (keyboard show/hide)
        if (window.visualViewport) {
            window.visualViewport.addEventListener("resize", updateHeight);
            window.visualViewport.addEventListener("scroll", updateHeight);
        }
        window.addEventListener("resize", updateHeight);

        return () => {
            if (window.visualViewport) {
                window.visualViewport.removeEventListener("resize", updateHeight);
                window.visualViewport.removeEventListener("scroll", updateHeight);
            }
            window.removeEventListener("resize", updateHeight);
        };
    }, []);

    return height;
}

interface ChatFullscreenProps {
    open: boolean;
    onClose: () => void;
}

function UserMessage({ message }: { message: ChatMessage }) {
    return (
        <div className="flex justify-end mb-4">
            <div
                data-component="desktop_chat_page_fullscreen-message-user"
                className="max-w-[80%] px-4 py-3 rounded-lg bg-primary text-primary-foreground"
            >
                <p className="whitespace-pre-wrap break-words">
                    {message.content}
                </p>
            </div>
        </div>
    );
}

function ToolExecutingIndicator({ toolName }: { toolName: string | null }) {
    return (
        <div className="flex items-center gap-2 mb-4 px-4">
            <Spinner size="sm" />
            <span className="text-sm text-muted-foreground">
                {toolName ? `${toolName} 실행 중...` : "처리 중..."}
            </span>
        </div>
    );
}

function StateIndicator({ state }: { state: ChatState }) {
    if (state === "connecting") {
        return (
            <div className="flex items-center gap-2 mb-4 px-4">
                <Spinner size="sm" />
                <span className="text-sm text-muted-foreground">
                    연결 중...
                </span>
            </div>
        );
    }
    return null;
}

export function ChatFullscreen({ open, onClose }: ChatFullscreenProps) {
    const viewportHeight = useVisualViewportHeight();
    const {
        messages,
        state,
        sessionId,
        sendMessage,
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
        comment?: string
    ) => {
        if (!sessionId) return;
        await fetch("/api/ai/chat/feedback", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                sessionId,
                messageIndex,
                type,
                comment,
            }),
        });
    }, [sessionId]);

    const messagesEndRef = useRef<HTMLDivElement>(null);
    const scrollContainerRef = useRef<HTMLDivElement>(null);
    const prevScrollHeightRef = useRef(0);
    const lastMessageRef = useRef<ChatMessage | null>(null);

    useEffect(() => {
        if (open) {
            loadHistory(0);
        }
    }, [open, loadHistory]);

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
        if (container) {
            container.addEventListener("scroll", handleScroll);
            return () => container.removeEventListener("scroll", handleScroll);
        }
    }, [handleScroll]);

    useLayoutEffect(() => {
        const container = scrollContainerRef.current;
        const lastMessage = messages[messages.length - 1];
        const isNewMessage = lastMessage !== lastMessageRef.current;

        if (!isNewMessage && container && prevScrollHeightRef.current > 0) {
            const diff = container.scrollHeight - prevScrollHeightRef.current;
            if (diff > 0) {
                requestAnimationFrame(() => {
                    container.scrollTop = diff;
                });
            }
            prevScrollHeightRef.current = 0;
        } else if (isNewMessage && messagesEndRef.current) {
            messagesEndRef.current.scrollIntoView({ behavior: "smooth" });
        }

        lastMessageRef.current = lastMessage || null;
    }, [messages]);

    const handleConfirm = () => {
        sendMessage("확인");
    };

    const handleCancel = () => {
        sendMessage("취소");
    };

    const quickActions = ["산모 등록", "계약서 전송", "계약서 상태 조회"] as const;

    const lastMessage = messages[messages.length - 1];
    const showConfirmButtons =
        lastMessage?.role === "assistant" &&
        !lastMessage.isStreaming &&
        (lastMessage.content.includes("하시겠습니까?") ||
            lastMessage.content.includes("Would you like"));

    // Don't render anything when closed
    if (!open) return null;

    return (
        <div
            data-component="desktop_chat_page_fullscreen"
            className={cn(
                "fixed inset-0 bg-background z-[1300]",
                "transition-transform duration-300 ease-out",
                open ? "translate-y-0" : "translate-y-full"
            )}
        >
            {/* Chat content container with dynamic height for mobile keyboard */}
            <div
                className="absolute top-0 left-0 right-0 flex flex-col select-text transition-[height] duration-100 ease-out"
                style={{
                    height: viewportHeight !== null ? `${viewportHeight}px` : "100%",
                }}
            >
                {/* Header */}
                <div data-component="desktop_chat_page_fullscreen_header" className="flex items-center justify-between px-4 py-3 border-b border-border bg-card">
                    <div className="flex items-center gap-2">
                        <Sparkles className="w-5 h-5 text-primary" />
                        <h2 className="text-lg font-semibold">
                            AI 어시스턴트
                        </h2>
                    </div>
                    <div className="flex items-center gap-1">
                        <Button
                            variant="ghost"
                            size="icon"
                            onClick={clearSession}
                            className="h-8 w-8"
                            aria-label="대화 삭제"
                            data-testid="chat-fullscreen-clear"
                        >
                            <Trash2 className="w-4 h-4" />
                        </Button>
                        <Button
                            variant="ghost"
                            size="icon"
                            onClick={onClose}
                            className="h-8 w-8"
                            aria-label="닫기"
                            data-testid="chat-fullscreen-close"
                        >
                            <X className="w-4 h-4" />
                        </Button>
                    </div>
                </div>

                {/* Messages area */}
                <div
                    data-component="desktop_chat_page_fullscreen_messages"
                    ref={scrollContainerRef}
                    className="flex-1 overflow-auto px-4 sm:px-8 py-6 select-text"
                >
                    {isLoadingHistory && messages.length > 0 && (
                        <div className="flex justify-center p-4">
                            <Spinner size="sm" />
                        </div>
                    )}
                    {messages.length === 0 ? (
                        <div className="flex flex-col items-center justify-center h-full text-center text-muted-foreground animate-fade-in">
                            <Sparkles className="w-12 h-12 mb-4 opacity-50" />
                            <h3 className="text-lg font-semibold mb-2">
                                무엇을 도와드릴까요?
                            </h3>
                            <p className="text-sm">
                                고객 검색, 직원 관리, 계약서 발송 등을 도와드립니다.
                            </p>
                        </div>
                    ) : (
                        <>
                            {messages.map((msg, idx) =>
                                msg.role === "user" ? (
                                    <UserMessage key={idx} message={msg} />
                                ) : (
                                    <AssistantMessage
                                        key={idx}
                                        message={msg}
                                        messageIndex={idx}
                                        sessionId={sessionId}
                                        isToolExecuting={isToolExecuting}
                                        currentTool={currentTool}
                                        onSubmitFeedback={handleSubmitFeedback}
                                    />
                                )
                            )}
                            {isToolExecuting && <ToolExecutingIndicator toolName={currentTool} />}
                            <StateIndicator state={state} />
                            {showConfirmButtons && (
                                <div className="flex gap-2 mb-4 px-4">
                                    <Button
                                        size="sm"
                                        onClick={handleConfirm}
                                        disabled={state === "streaming"}
                                    >
                                        확인
                                    </Button>
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={handleCancel}
                                        disabled={state === "streaming"}
                                    >
                                        취소
                                    </Button>
                                </div>
                            )}
                            <div ref={messagesEndRef} />
                        </>
                    )}
                </div>

                {/* Input area */}
                <div data-component="desktop_chat_page_fullscreen_input-area" className="px-4 sm:px-8 py-4 border-t border-border bg-card">
                    <div className="mb-3 flex flex-wrap gap-2">
                        {quickActions.map((label) => (
                            <Button
                                key={label}
                                type="button"
                                variant="secondary"
                                size="sm"
                                onClick={() => sendMessage(label)}
                                disabled={state === "streaming" || state === "connecting"}
                                className="rounded-full"
                            >
                                {label}
                            </Button>
                        ))}
                    </div>
                    <ChatInput
                        onSubmit={sendMessage}
                        disabled={state === "streaming" || state === "connecting"}
                    />
                </div>
            </div>
        </div>
    );
}
