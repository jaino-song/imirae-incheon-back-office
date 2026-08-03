"use client";

type ActionResultPartProps = {
    actionId: string;
    status: "succeeded" | "failed" | "uncertain" | "rejected" | "expired" | "cancelled";
    summary: string;
    result?: Record<string, unknown>;
    completedAt?: string;
    href?: string;
};

export function ActionResultPart({ actionId, status, summary, result, completedAt, href }: ActionResultPartProps) {
    const label = status === "succeeded" ? "완료" : status === "uncertain" ? "확인 필요" : status === "rejected" ? "거절됨" : status === "expired" ? "만료됨" : status === "cancelled" ? "취소됨" : "실패";
    const safeHref = href && href.startsWith("/") && !href.startsWith("//") ? href : undefined;
    return <section data-component="desktop_chat_agent-action-result" data-source-component="ActionResultPart" className="rounded-xl border p-4" aria-label={`작업 결과: ${label}`}><p data-slot="status" className="font-semibold">{label}</p><p data-slot="summary" className="text-sm">{summary}</p>{completedAt && <p data-slot="completed-at" className="text-xs text-muted-foreground">처리 시각: {new Date(completedAt).toLocaleString()}</p>}{result && <pre data-slot="result" className="max-h-40 overflow-auto whitespace-pre-wrap break-words text-xs">{JSON.stringify(result, null, 2)}</pre>}{safeHref && <a data-slot="link" className="text-sm underline" href={safeHref}>결과 열기</a>}<p data-slot="action-id" className="mt-1 text-xs text-muted-foreground">작업 ID: {actionId}</p></section>;
}
