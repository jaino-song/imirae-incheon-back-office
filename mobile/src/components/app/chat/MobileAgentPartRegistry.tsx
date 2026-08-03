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

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

type MobilePart = { type: string; text?: string; data?: unknown; state?: string; output?: unknown; errorText?: string; toolName?: string };

type Props = {
    part: MobilePart;
    onEntitySelect: (id: string, entityType: string) => void;
    onApproveAction: (actionId: string, expectedRevision: string, acknowledgementToken?: string) => void;
    onRejectAction: (actionId: string) => void;
    onSubmitForm: (formId: string, values: Record<string, unknown>) => void;
    terminalActionIds?: ReadonlySet<string>;
};

export function MobileAgentPartRegistry({ part, onEntitySelect, onApproveAction, onRejectAction, onSubmitForm, terminalActionIds }: Props) {
    const [strongAcknowledged, setStrongAcknowledged] = useState(false);
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
        const proposal = parsed.data;
        const strong = ["irreversible-write", "external-side-effect", "paid-action", "privileged-administration"].includes(proposal.risk ?? "");
        const terminal = terminalActionIds?.has(proposal.actionId) ?? false;
        return <section data-slot="action-proposal" aria-label="승인 대기 작업" className="flex flex-col gap-2 rounded-xl border border-amber-300 bg-amber-50 p-3 text-amber-950"><p className="font-semibold">{proposal.title}</p><p className="text-sm">{proposal.summary}</p><dl className="grid grid-cols-2 gap-1 text-xs"><dt>위험도</dt><dd>{proposal.risk ?? "write"}</dd>{proposal.provider && <><dt>외부 제공자</dt><dd>{proposal.provider}</dd></>}{proposal.estimatedCost && <><dt>예상 비용</dt><dd>{proposal.estimatedCost}</dd></>}<dt className="col-span-2">실제 변경값</dt><dd className="col-span-2 whitespace-pre-wrap break-words">{JSON.stringify(proposal.changes, null, 2)}</dd></dl>{strong && <div className="flex min-h-11 items-start gap-2"><Checkbox id={`mobile-agent-action-ack-${proposal.actionId}`} checked={strongAcknowledged} onCheckedChange={(value) => setStrongAcknowledged(value === true)} /><Label htmlFor={`mobile-agent-action-ack-${proposal.actionId}`} className="text-xs leading-5">실제 부작용, 수신자, 제공자 및 비용을 확인했습니다.</Label></div>}<div className="flex gap-2"><Button type="button" size="sm" className="min-h-11" disabled={terminal || (strong && (!strongAcknowledged || !proposal.acknowledgementToken))} onClick={() => onApproveAction(proposal.actionId, proposal.expectedRevision, proposal.acknowledgementToken)}>승인하고 실행</Button><Button type="button" size="sm" variant="outline" className="min-h-11" disabled={terminal} onClick={() => onRejectAction(proposal.actionId)}>거절</Button></div></section>;
    }
    if (part.type === "data-action-result") {
        const parsed = AgentActionResultPartSchema.safeParse(part.data);
        const label = parsed.success ? parsed.data.status === "succeeded" ? "완료" : parsed.data.status === "uncertain" ? "확인 필요" : parsed.data.status === "rejected" ? "거절됨" : parsed.data.status === "expired" ? "만료됨" : parsed.data.status === "cancelled" ? "취소됨" : "실패" : "";
        return parsed.success ? <section data-slot="action-result" className="rounded-xl border p-3"><p className="font-semibold">{label}</p><p className="text-sm">{parsed.data.summary}</p>{parsed.data.result && <details data-slot="action-result-details" className="mt-2"><summary className="text-sm font-medium">처리 상세</summary><pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-words text-xs">{JSON.stringify(parsed.data.result, null, 2)?.slice(0, 4000)}</pre></details>}{parsed.data.href && <a href={parsed.data.href} className="text-sm underline">결과 열기</a>}</section> : <Fallback />;
    }
    if (part.type === "data-form") {
        const parsed = AgentFormPartSchema.safeParse(part.data);
        return parsed.success ? <MobileAgentForm formId={parsed.data.formId} title={parsed.data.title} fields={parsed.data.fields ?? []} onSubmit={onSubmitForm} /> : <Fallback />;
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

function MobileAgentForm({ formId, title, fields, onSubmit }: { formId: string; title: string; fields: AgentFormField[]; onSubmit: (formId: string, values: Record<string, unknown>) => void }) {
    const [values, setValues] = useState<Record<string, unknown>>({});
    return <form data-component="mobile_chat_agent-form" data-slot="form" className="flex flex-col gap-3 rounded-xl border p-3" onSubmit={(event) => { event.preventDefault(); onSubmit(formId, values); }}><p className="font-semibold">{title}</p>{fields.map((field) => <div key={field.name} className="flex flex-col gap-1"><Label htmlFor={`${formId}-${field.name}`}>{field.label}</Label>{field.type === "textarea" ? <Textarea id={`${formId}-${field.name}`} required={field.required} value={String(values[field.name] ?? "")} onChange={(event) => setValues((current) => ({ ...current, [field.name]: event.target.value }))} /> : field.type === "boolean" ? <Checkbox id={`${formId}-${field.name}`} checked={values[field.name] === true} onCheckedChange={(checked) => setValues((current) => ({ ...current, [field.name]: checked === true }))} /> : <Input id={`${formId}-${field.name}`} type={field.type === "number" ? "number" : field.type === "date" ? "date" : "text"} required={field.required} value={String(values[field.name] ?? "")} onChange={(event) => setValues((current) => ({ ...current, [field.name]: field.type === "number" ? Number(event.target.value) : event.target.value }))} />}</div>)}<Button type="submit">제출</Button></form>;
}

function Fallback() {
    return <p data-slot="fallback" className="text-sm text-muted-foreground">이 응답의 새 형식은 현재 화면에서 안전하게 표시할 수 없습니다.</p>;
}
