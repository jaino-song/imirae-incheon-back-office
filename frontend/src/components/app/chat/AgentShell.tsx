"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Menu, Pencil, Plus, Send, Square, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { AgentPartRegistry } from "./parts/AgentPartRegistry";
import { ErrorPart } from "./parts/ErrorPart";
import { useAgentChat } from "@/hooks/useAgentChat";

const MOBILE_MEDIA_QUERY = "(max-width: 767px)";

function subscribeMobileViewport(onChange: () => void) {
    const media = window.matchMedia(MOBILE_MEDIA_QUERY);
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
}

function getMobileViewportSnapshot() {
    return window.matchMedia(MOBILE_MEDIA_QUERY).matches;
}

export function AgentShellLoading() {
    return <main data-component="desktop_chat_agent-shell_loading" data-source-component="AgentShell" className="fixed inset-0 grid place-items-center" role="status" aria-live="polite">AI 운영 코파일럿 준비 중...</main>;
}

export function AgentShell() {
    const router = useRouter();
    const [input, setInput] = useState("");
    const [sessionSearch, setSessionSearch] = useState("");
    const [renamingSessionId, setRenamingSessionId] = useState<string | null>(null);
    const [renameValue, setRenameValue] = useState("");
    const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
    const [desktopSidebarOpen, setDesktopSidebarOpen] = useState(true);
    const isMobile = useSyncExternalStore(subscribeMobileViewport, getMobileViewportSnapshot, () => false);
    const sidebarOpen = isMobile ? mobileSidebarOpen : desktopSidebarOpen;
    const menuButtonRef = useRef<HTMLButtonElement>(null);
    const sidebarRef = useRef<HTMLElement>(null);
    const { messages, sendMessage, status, error, actionError, stop, regenerate, resetBranch, sessions, selectSession, renameSession, deleteSession, approveAction, rejectAction, submitStructuredForm, submitFeedback } = useAgentChat();
    const isStreaming = status === "streaming" || status === "submitted";
    const terminalActionIds = useMemo(() => new Set(messages.flatMap((message) => message.parts.flatMap((part) => {
        if (part.type !== "data-action-result") return [];
        const data = (part as { data?: { actionId?: unknown } }).data;
        return typeof data?.actionId === "string" ? [data.actionId] : [];
    }))), [messages]);
    const filteredSessions = useMemo(() => {
        const query = sessionSearch.trim().toLocaleLowerCase();
        return query ? sessions.filter((session) => (session.title ?? "새 대화").toLocaleLowerCase().includes(query)) : sessions;
    }, [sessionSearch, sessions]);

    useEffect(() => {
        if (!isMobile) return;
        if (sidebarOpen) sidebarRef.current?.focus();
        else menuButtonRef.current?.focus();
    }, [isMobile, sidebarOpen]);

    useEffect(() => {
        if (!sidebarOpen) return;
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === "Escape" && isMobile) setMobileSidebarOpen(false);
        };
        window.addEventListener("keydown", onKeyDown);
        return () => window.removeEventListener("keydown", onKeyDown);
    }, [isMobile, sidebarOpen]);

    const submit = () => {
        const text = input.trim();
        if (!text || isStreaming) return;
        setInput("");
        void sendMessage({ text });
    };
    const closeSidebarOnMobile = () => {
        if (isMobile) setMobileSidebarOpen(false);
    };
    const toggleSidebar = () => {
        if (isMobile) setMobileSidebarOpen((value) => !value);
        else setDesktopSidebarOpen((value) => !value);
    };

    return (
        <main data-component="desktop_chat_agent-shell" data-source-component="AgentShell" className="fixed inset-0 z-[1200] grid grid-cols-[auto_1fr] bg-background">
            {sidebarOpen && <Button type="button" variant="ghost" aria-label="사이드바 닫기" onClick={() => setMobileSidebarOpen(false)} className="fixed inset-y-0 left-64 right-0 z-10 h-auto w-auto rounded-none bg-black/20 p-0 hover:bg-black/20 md:hidden" />}
            <aside ref={sidebarRef} tabIndex={-1} aria-hidden={!sidebarOpen} inert={!sidebarOpen} data-component="desktop_chat_agent-shell_sidebar" id="agent-shell-sidebar" className={`${sidebarOpen ? "translate-x-0" : "-translate-x-full md:w-0 md:overflow-hidden"} fixed inset-y-0 left-0 z-20 w-64 border-r bg-card transition-[width,transform] duration-200 md:static md:block md:translate-x-0`}>
                <div data-component="desktop_chat_agent-shell_sidebar_header" className="flex items-center justify-between p-4"><span className="font-semibold">대화</span><Button type="button" variant="ghost" size="icon" aria-label="새 대화" onClick={() => { resetBranch(); closeSidebarOnMobile(); }}><Plus className="h-4 w-4" /></Button></div>
                <Separator />
                <div data-slot="session-search" className="p-2"><Input value={sessionSearch} onChange={(event) => setSessionSearch(event.target.value)} aria-label="대화 검색" placeholder="대화 검색" /></div>
                <div data-component="desktop_chat_agent-shell_sidebar_sessions" className="flex flex-col gap-1 overflow-auto p-2">
                    {filteredSessions.map((session) => (
                        <div key={session.id} data-component="desktop_chat_agent-shell_sidebar_sessions_session" className="flex items-center gap-1">
                            {renamingSessionId === session.id
                                ? <Input autoFocus value={renameValue} aria-label="대화 제목" onChange={(event) => setRenameValue(event.target.value)} onBlur={() => setRenamingSessionId(null)} onKeyDown={(event) => { if (event.nativeEvent.isComposing) return; if (event.key === "Enter") { event.preventDefault(); void renameSession(session.id, renameValue).then((saved) => { if (saved) setRenamingSessionId(null); }); } if (event.key === "Escape") setRenamingSessionId(null); }} />
                                : <Button type="button" variant="ghost" size="sm" className="min-w-0 flex-1 justify-start truncate" onClick={() => { void selectSession(session.id); closeSidebarOnMobile(); }}>{session.title || "새 대화"}</Button>}
                            <Button type="button" variant="ghost" size="icon" aria-label={`${session.title || "대화"} 이름 변경`} onMouseDown={(event) => event.preventDefault()} onClick={() => { setRenameValue(session.title || "새 대화"); setRenamingSessionId(session.id); }}><Pencil className="h-4 w-4" /></Button>
                            <Button type="button" variant="ghost" size="icon" aria-label={`${session.title || "대화"} 삭제`} onClick={() => void deleteSession(session.id)}><Trash2 className="h-4 w-4" /></Button>
                        </div>
                    ))}
                </div>
                <div data-slot="sidebar-description" className="p-4 text-sm text-muted-foreground">권한에 따라 조회와 승인 작업을 지원합니다.</div>
            </aside>
            <section data-component="desktop_chat_agent-shell_thread" className="flex min-w-0 flex-col">
                <header data-component="desktop_chat_agent-shell_thread_header" className="flex items-center gap-2 border-b bg-card px-4 py-3">
                    <Button ref={menuButtonRef} type="button" variant="ghost" size="icon" aria-label="사이드바 열기" aria-expanded={sidebarOpen} aria-controls="agent-shell-sidebar" onClick={toggleSidebar}><Menu className="h-4 w-4" /></Button>
                    <Button type="button" variant="ghost" size="icon" aria-label="기존 채팅으로 돌아가기" onClick={() => window.history.back()}><ArrowLeft className="h-4 w-4" /></Button>
                    <h1 className="font-semibold">AI 운영 코파일럿</h1>
                    <Button type="button" variant="ghost" size="sm" className="ml-auto" onClick={() => { resetBranch(); router.push("/select-branch"); }}>지점 바꾸기</Button>
                </header>
                <ScrollArea className="min-h-0 flex-1"><div data-component="desktop_chat_agent-shell_thread_messages" className="mx-auto flex w-full max-w-3xl flex-col gap-6 p-4 sm:p-8">
                    {messages.length === 0 && <div className="py-24 text-center text-muted-foreground"><p className="text-lg font-semibold">무엇을 도와드릴까요?</p><p className="mt-2 text-sm">고객·직원·일정·계약을 확인하고 권한이 있는 작업을 제안합니다.</p></div>}
                    {messages.map((message) => <article key={message.id} data-component="desktop_chat_agent-shell_thread_messages_message" data-source-component="AgentShell" className={message.role === "user" ? "ml-auto max-w-[85%] rounded-2xl bg-primary px-4 py-3 text-primary-foreground" : "max-w-[90%] rounded-2xl border bg-card px-4 py-3"}><AgentPartRegistry data-component="desktop_chat_agent-shell_thread_messages_message_part-registry" message={message} isBusy={isStreaming} terminalActionIds={terminalActionIds} onEntitySelect={(id, entityType) => void sendMessage({ text: `선택한 엔티티 유형: ${entityType}, 선택한 엔티티 ID: ${id}` })} onFeedback={(value) => void submitFeedback(message.id, value)} onApproveAction={(actionId, expectedRevision, acknowledgementToken) => void approveAction(actionId, expectedRevision, acknowledgementToken)} onRejectAction={(actionId) => void rejectAction(actionId)} onSubmitForm={submitStructuredForm} onRetry={() => void regenerate()} />{message.role === "assistant" && !message.parts.some((part) => part.type === "data-feedback") && <div data-component="desktop_chat_agent-shell_thread_messages_message_feedback" data-slot="feedback" className="mt-3 flex gap-2"><Button data-component="desktop_chat_agent-shell_thread_messages_message_feedback_positive" type="button" size="sm" variant="ghost" onClick={() => void submitFeedback(message.id, "positive")}>좋아요</Button><Button data-component="desktop_chat_agent-shell_thread_messages_message_feedback_negative" type="button" size="sm" variant="ghost" onClick={() => void submitFeedback(message.id, "negative")}>아쉬워요</Button></div>}</article>)}
                    {error && <ErrorPart data-component="desktop_chat_agent-shell_thread_messages_stream-error" code="stream_failed" category="client" message="응답 스트림이 중단되었습니다." retryable effectState="nothing-happened" onRetry={() => void regenerate()} />}
                    {actionError && <ErrorPart data-component="desktop_chat_agent-shell_thread_messages_action-error" code={actionError.code} category="client" message={actionError.message} retryable={false} effectState={actionError.effectState} />}
                </div></ScrollArea>
                <div data-component="desktop_chat_agent-shell_thread_composer" className="mx-auto flex w-full max-w-3xl items-end gap-2 p-4 sm:p-6">
                    <Textarea value={input} onChange={(event) => setInput(event.target.value)} onKeyDown={(event) => { if (event.nativeEvent.isComposing) return; if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); submit(); } }} placeholder="질문을 입력하세요" aria-label="질문 입력" rows={2} />
                    <Button type="button" size="icon" aria-label={isStreaming ? "중지" : "전송"} onClick={isStreaming ? () => void stop() : submit}>{isStreaming ? <Square className="h-4 w-4" /> : <Send className="h-4 w-4" />}</Button>
                </div>
            </section>
        </main>
    );
}
