"use client";

import { useState } from "react";
import {
    AgentActionProposalPartSchema,
    AgentActionResultPartSchema,
    AgentActivityPartSchema,
    AgentAttachmentPartSchema,
    AgentEntityChoicePartSchema,
    AgentErrorPartSchema,
    AgentFeedbackPartSchema,
    AgentFormPartSchema,
    AgentFormSubmitPartSchema,
    AgentNavigationPartSchema,
    type AgentFormField,
} from "@babyjamjam/shared";

import { AgentActionApprovalCard } from "@/components/app/ui/AgentActionApprovalCard";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

type MobilePart = { type: string; text?: string; data?: unknown; state?: string; output?: unknown; errorText?: string; toolName?: string };

function normalizeFormValues(fields: AgentFormField[], values: Record<string, unknown>) {
    const normalized: Record<string, unknown> = {
        ...Object.fromEntries(fields.filter((field) => field.type === "boolean").map((field) => [field.name, false])),
    };

    for (const field of fields) {
        if (!Object.prototype.hasOwnProperty.call(values, field.name)) continue;
        const value = values[field.name];

        if (field.type === "number") {
            const numericValue = typeof value === "number"
                ? value
                : typeof value === "string" && value.trim() !== ""
                    ? Number(value)
                    : undefined;
            if (numericValue !== undefined && Number.isFinite(numericValue)) normalized[field.name] = numericValue;
            continue;
        }

        normalized[field.name] = value;
    }

    return normalized;
}

type Props = {
    "data-component": string;
    part: MobilePart;
    onEntitySelect: (id: string, entityType: string) => void;
    onApproveAction: (actionId: string, expectedRevision: string, acknowledgementToken?: string) => void;
    onRejectAction: (actionId: string) => void;
    onSubmitForm: (formId: string, values: Record<string, unknown>) => void;
    terminalActionIds?: ReadonlySet<string>;
};

export function MobileAgentPartRegistry({ "data-component": dataComponent, part, onEntitySelect, onApproveAction, onRejectAction, onSubmitForm, terminalActionIds }: Props) {
    if (part.type === "text") return <p data-slot="text" className="whitespace-pre-wrap break-words">{part.text ?? ""}</p>;
    if (part.type === "dynamic-tool" || part.type.startsWith("tool-")) {
        if (part.state === "output-error") return <p data-slot="tool-error" className="text-sm text-muted-foreground">{part.errorText ?? "도구 결과를 표시할 수 없습니다."}</p>;
        if (part.state === "output-available") return <details data-slot="tool-result" className="rounded-lg border p-2"><summary className="text-sm font-medium">{part.toolName ?? part.type.replace(/^tool-/, "").replaceAll("_", ".")} 결과</summary><pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-words text-xs">{JSON.stringify(part.output, null, 2)?.slice(0, 4000)}</pre></details>;
        return <p data-slot="tool-progress" className="text-sm text-muted-foreground">처리 중…</p>;
    }
    if (part.type === "data-activity") {
        const parsed = AgentActivityPartSchema.safeParse(part.data);
        return parsed.success ? <p data-slot="activity" className="text-sm text-muted-foreground">{parsed.data.label}</p> : <Fallback />;
    }
    if (part.type === "data-entity-choice") {
        const parsed = AgentEntityChoicePartSchema.safeParse(part.data);
        return parsed.success ? <div data-slot="entity-choice" className="flex flex-col gap-2" role="group" aria-label={parsed.data.prompt}><p className="text-sm font-medium">{parsed.data.prompt}</p>{parsed.data.choices.map((choice) => <Button key={choice.id} type="button" variant="outline" className="h-auto min-h-11 justify-start whitespace-normal py-2" onClick={() => onEntitySelect(choice.id, parsed.data.entityType)}>{choice.label}{choice.description ? ` · ${choice.description}` : ""}</Button>)}</div> : <Fallback />;
    }
    if (part.type === "data-navigation") {
        const parsed = AgentNavigationPartSchema.safeParse(part.data);
        return parsed.success ? <a data-slot="navigation" href={parsed.data.href} className="underline">{parsed.data.label}</a> : <Fallback />;
    }
    if (part.type === "data-error") {
        const parsed = AgentErrorPartSchema.safeParse(part.data);
        const effectLabel = parsed.success && parsed.data.effectState === "succeeded-unconfirmed"
            ? "결과 확인 전에는 다시 실행하지 마세요."
            : parsed.success && parsed.data.effectState === "partial"
                ? "일부 단계만 완료되었을 수 있습니다."
                : "작업은 실행되지 않았습니다.";
        return parsed.success ? <section data-slot="error" role="alert" className="rounded-lg border border-destructive/40 p-3"><p className="font-medium">{parsed.data.message}</p><p className="mt-1 text-xs text-muted-foreground">{effectLabel}</p><p className="mt-1 text-xs text-muted-foreground">{parsed.data.code}</p></section> : <Fallback />;
    }
    if (part.type === "data-action-proposal") {
        const parsed = AgentActionProposalPartSchema.safeParse(part.data);
        if (!parsed.success) return <Fallback />;
        return <AgentActionApprovalCard
            data-component={dataComponent}
            {...parsed.data}
            terminal={terminalActionIds?.has(parsed.data.actionId) ?? false}
            onApprove={onApproveAction}
            onReject={onRejectAction}
        />;
    }
    if (part.type === "data-action-result") {
        const parsed = AgentActionResultPartSchema.safeParse(part.data);
        const label = parsed.success ? parsed.data.status === "succeeded" ? "완료" : parsed.data.status === "uncertain" ? "확인 필요" : parsed.data.status === "rejected" ? "거절됨" : parsed.data.status === "expired" ? "만료됨" : parsed.data.status === "cancelled" ? "취소됨" : "실패" : "";
        return parsed.success ? <section data-slot="action-result" className="rounded-xl border p-3"><p className="font-semibold">{label}</p><p className="text-sm">{parsed.data.summary}</p>{parsed.data.result && <details data-slot="action-result-details" className="mt-2"><summary className="text-sm font-medium">처리 상세</summary><pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-words text-xs">{JSON.stringify(parsed.data.result, null, 2)?.slice(0, 4000)}</pre></details>}{parsed.data.href && <a href={parsed.data.href} className="text-sm underline">결과 열기</a>}</section> : <Fallback />;
    }
    if (part.type === "data-form") {
        const parsed = AgentFormPartSchema.safeParse(part.data);
        return parsed.success ? <MobileAgentForm data-component={`${dataComponent}_form`} formId={parsed.data.formId} title={parsed.data.title} fields={parsed.data.fields ?? []} onSubmit={onSubmitForm} /> : <Fallback />;
    }
    if (part.type === "data-form-submit") return AgentFormSubmitPartSchema.safeParse(part.data).success ? <p data-slot="form-submit" className="text-sm text-muted-foreground">구조화된 입력을 제출했습니다.</p> : <Fallback />;
    if (part.type === "data-attachment") {
        const parsed = AgentAttachmentPartSchema.safeParse(part.data);
        return parsed.success ? <p data-slot="attachment" className="text-sm">{parsed.data.name} · {parsed.data.mediaType} · {parsed.data.size.toLocaleString()} bytes</p> : <Fallback />;
    }
    if (part.type === "data-feedback") {
        const parsed = AgentFeedbackPartSchema.safeParse(part.data);
        return parsed.success ? <p data-slot="feedback" className="text-sm text-muted-foreground">{parsed.data.prompt}</p> : <Fallback />;
    }
    return <Fallback />;
}

function MobileAgentForm({ "data-component": dataComponent, formId, title, fields, onSubmit }: { "data-component": string; formId: string; title: string; fields: AgentFormField[]; onSubmit: (formId: string, values: Record<string, unknown>) => void }) {
    const [values, setValues] = useState<Record<string, unknown>>({});
    const sub = (suffix: string) => `${dataComponent}_${suffix}`;
    return <form data-component={dataComponent} data-slot="form" data-source-component="MobileAgentForm" className="flex flex-col gap-3 rounded-xl border p-3" onSubmit={(event) => { event.preventDefault(); if (!event.currentTarget.checkValidity()) return; onSubmit(formId, normalizeFormValues(fields, values)); }}><p data-component={sub("title")} data-slot="title" className="font-semibold">{title}</p>{fields.map((field) => <div key={field.name} data-component={sub("field")} className="flex flex-col gap-1"><Label data-component={sub("field_label")} htmlFor={`${formId}-${field.name}`}>{field.label}</Label>{field.type === "textarea" ? <Textarea data-component={sub("field_control")} id={`${formId}-${field.name}`} required={field.required} inputMode={field.inputMode} maxLength={field.maxLength} placeholder={field.placeholder ?? field.label} value={String(values[field.name] ?? "")} onChange={(event) => setValues((current) => ({ ...current, [field.name]: event.target.value }))} /> : field.type === "boolean" ? <Checkbox data-component={sub("field_control")} id={`${formId}-${field.name}`} checked={values[field.name] === true} onCheckedChange={(checked) => setValues((current) => ({ ...current, [field.name]: checked === true }))} /> : <Input data-component={sub("field_control")} id={`${formId}-${field.name}`} type={field.type === "number" ? "number" : field.type === "date" ? "date" : "text"} inputMode={field.inputMode} maxLength={field.maxLength} required={field.required} placeholder={field.placeholder ?? field.label} value={String(values[field.name] ?? "")} onChange={(event) => setValues((current) => ({ ...current, [field.name]: event.target.value }))} />}</div>)}<Button data-component={sub("submit")} type="submit">제출</Button></form>;
}

function Fallback() {
    return <p data-slot="fallback" className="text-sm text-muted-foreground">이 응답의 새 형식은 현재 화면에서 안전하게 표시할 수 없습니다.</p>;
}
