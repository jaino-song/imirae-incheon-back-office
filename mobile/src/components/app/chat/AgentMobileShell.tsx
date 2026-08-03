"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Menu, Send, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useAgentChat } from "@/hooks/useAgentChat";
import { MobileAgentPartRegistry } from "./MobileAgentPartRegistry";

export function AgentMobileShell() {
    const [drawerOpen, setDrawerOpen] = useState(false);
    const [input, setInput] = useState("");
    const contentRef = useRef<HTMLDivElement>(null);
    const drawerRef = useRef<HTMLElement>(null);
    const menuButtonRef = useRef<HTMLButtonElement>(null);
    const { messages, status, errorState, sendMessage, stop, resetBranch, sessions, selectSession, deleteSession, approveAction, rejectAction, submitStructuredForm, submitFeedback } = useAgentChat();
    const streaming = status === "streaming";
    const terminalActionIds = useMemo(() => new Set(messages.flatMap((message) => message.parts.flatMap((part) => {
        if (part.type !== "data-action-result") return [];
        const data = (part as { data?: { actionId?: unknown } }).data;
        return typeof data?.actionId === "string" ? [data.actionId] : [];
    }))), [messages]);
    const submit = () => { const value = input.trim(); if (!value || streaming) return; setInput(""); void sendMessage(value); };
    useEffect(() => {
        const content = contentRef.current;
        if (content) content.inert = drawerOpen;
        if (!drawerOpen) return;
        drawerRef.current?.focus();
        const closeOnEscape = (event: KeyboardEvent) => {
            if (event.key !== "Escape") return;
            event.preventDefault();
            setDrawerOpen(false);
            menuButtonRef.current?.focus();
        };
        window.addEventListener("keydown", closeOnEscape);
        return () => window.removeEventListener("keydown", closeOnEscape);
    }, [drawerOpen]);
    const closeDrawer = () => {
        setDrawerOpen(false);
        requestAnimationFrame(() => menuButtonRef.current?.focus());
    };
    return <main data-component="mobile_chat_agent-shell" data-slot="agent-mobile-shell" className="fixed inset-0 flex flex-col bg-background">
        <div ref={contentRef} data-slot="application-content" className="flex min-h-0 flex-1 flex-col">
            <header data-component="mobile_chat_agent-shell_header" className="flex items-center gap-3 border-b px-4 py-3"><Button ref={menuButtonRef} type="button" size="icon" variant="ghost" className="min-h-11 min-w-11" aria-label="대화 목록" aria-controls="agent-mobile-session-drawer" aria-expanded={drawerOpen} onClick={() => setDrawerOpen(true)}><Menu className="h-5 w-5" /></Button><h1 className="font-semibold">AI 운영 코파일럿</h1><Button type="button" variant="ghost" size="sm" className="ml-auto min-h-11" onClick={resetBranch}>새 대화</Button></header>
            <div data-component="mobile_chat_agent-shell_thread" className="min-h-0 flex-1 overflow-y-auto p-4 pb-6"><div className="flex flex-col gap-4">{messages.map((message) => <article key={message.id} data-component={`mobile_chat_agent-shell_thread_message-${message.role}`} className={message.role === "user" ? "ml-8 rounded-2xl bg-primary p-3 text-primary-foreground" : "mr-8 rounded-2xl border bg-card p-3"}>{message.parts.map((part, index) => <MobileAgentPartRegistry key={`${message.id}-${index}`} part={part as never} terminalActionIds={terminalActionIds} onEntitySelect={(id, entityType) => void sendMessage(`선택한 엔티티 유형: ${entityType}, ID: ${id}`)} onApproveAction={(actionId, expectedRevision, acknowledgementToken) => void approveAction(actionId, expectedRevision, acknowledgementToken)} onRejectAction={(actionId) => void rejectAction(actionId)} onSubmitForm={(formId, values) => void submitStructuredForm(formId, values)} />)}{message.role === "assistant" && <div data-slot="feedback" className="mt-3 flex gap-2"><Button type="button" size="sm" variant="ghost" className="min-h-11" onClick={() => void submitFeedback(message.id, "positive")}>좋아요</Button><Button type="button" size="sm" variant="ghost" className="min-h-11" onClick={() => void submitFeedback(message.id, "negative")}>아쉬워요</Button></div>}</article>)}{errorState && <section data-slot="client-error" role="alert" className="rounded-xl border border-destructive/40 p-3"><p className="font-medium">{errorState.message}</p><p className="mt-1 text-xs text-muted-foreground">{errorState.effectState === "nothing-happened" ? "작업은 실행되지 않았습니다." : errorState.effectState === "partial" ? "일부 단계만 완료되었을 수 있습니다. 다시 실행하지 마세요." : "결과 확인 전에는 다시 실행하지 마세요."}</p></section>}</div></div>
            <div data-component="mobile_chat_agent-shell_composer" className="flex items-end gap-2 border-t p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]"><Textarea value={input} onChange={(event) => setInput(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); submit(); } }} aria-label="질문 입력" placeholder="질문을 입력하세요" rows={2} /><Button type="button" size="icon" className="min-h-11 min-w-11" aria-label={streaming ? "중지" : "전송"} onClick={streaming ? stop : submit}>{streaming ? <Square className="h-4 w-4" /> : <Send className="h-4 w-4" />}</Button></div>
        </div>
        {drawerOpen && <aside ref={drawerRef} id="agent-mobile-session-drawer" role="dialog" aria-modal="true" aria-label="대화 목록" tabIndex={-1} data-component="mobile_chat_agent-shell_drawer" className="absolute inset-x-0 top-0 z-10 max-h-[70vh] overflow-auto border-b bg-card p-4 shadow-lg"><p className="mb-2 text-sm text-muted-foreground">브랜치별 대화는 안전하게 분리됩니다.</p><div className="flex flex-col gap-1">{sessions.map((session) => <div key={session.id} className="flex items-center gap-1"><Button type="button" variant="ghost" className="min-h-11 min-w-0 flex-1 justify-start truncate" onClick={() => { void selectSession(session.id); closeDrawer(); }}>{session.title || "새 대화"}</Button><Button type="button" variant="ghost" size="icon" className="min-h-11 min-w-11" aria-label={`${session.title || "대화"} 삭제`} onClick={() => void deleteSession(session.id)}>×</Button></div>)}</div><Button type="button" size="sm" className="mt-3 min-h-11" onClick={closeDrawer}>닫기</Button></aside>}
    </main>;
}
