"use client";

import { Button } from "@/components/ui/button";

type ErrorPartProps = {
    code: string;
    category: string;
    message: string;
    retryable: boolean;
    effectState?: "nothing-happened" | "succeeded-unconfirmed" | "partial";
    onRetry?: () => void;
};

const EFFECT_STATE_LABELS = {
    "nothing-happened": "작업이 실행되지 않았습니다. 안전하게 다시 시도할 수 있습니다.",
    "succeeded-unconfirmed": "요청 결과가 확인되지 않았습니다. 중복 실행하지 말고 기록을 새로고침해 확인하세요.",
    partial: "일부 단계만 완료되었을 수 있습니다. 상태를 확인하기 전에는 다시 실행하지 마세요.",
} as const;

export function ErrorPart({ code, category, message, retryable, effectState = "nothing-happened", onRetry }: ErrorPartProps) {
    const canRetry = retryable && effectState === "nothing-happened";
    return (
        <section data-component="desktop_chat_agent-error" data-source-component="ErrorPart" className="flex flex-wrap items-center gap-3 rounded-xl border border-destructive/30 bg-destructive/5 p-3" role="alert">
            <div data-slot="message" className="min-w-0 flex-1">
                <p className="text-sm text-destructive">{message}</p>
                <p data-slot="effect-state" className="mt-1 text-xs text-muted-foreground">{EFFECT_STATE_LABELS[effectState]}</p>
                <p data-slot="category" className="mt-1 text-xs text-muted-foreground">{category} · {code}</p>
            </div>
            {canRetry && <Button type="button" size="sm" variant="outline" onClick={onRetry}>다시 시도</Button>}
        </section>
    );
}
