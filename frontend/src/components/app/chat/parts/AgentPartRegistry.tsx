"use client";

import type { UIMessage } from "ai";
import { Button } from "@/components/ui/button";
import { AgentActionApprovalCard } from "@/components/app/ui/AgentActionApprovalCard";
import { ActionResultPart } from "./ActionResultPart";
import { FormRequestPart } from "./FormRequestPart";
import { ErrorPart } from "./ErrorPart";
import { AttachmentPart } from "./AttachmentPart";
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
} from "@babyjamjam/shared";

type AgentPartRegistryProps = {
    "data-component": string;
    message: UIMessage;
    onEntitySelect?: (id: string, entityType: string) => void;
    onFeedback?: (value: "positive" | "negative") => void;
    onApproveAction?: (actionId: string, expectedRevision: string, acknowledgementToken?: string) => void;
    onRejectAction?: (actionId: string) => void;
    onSubmitForm?: (formId: string, values: Record<string, unknown>) => void;
    onRetry?: () => void;
    terminalActionIds?: ReadonlySet<string>;
};

export function AgentPartRegistry({ "data-component": dataComponent, message, onEntitySelect, onFeedback, onApproveAction, onRejectAction, onSubmitForm, onRetry, terminalActionIds }: AgentPartRegistryProps) {
    const component = (suffix: string) => `${dataComponent}_${suffix}`;

    return (
        <div data-component={dataComponent} data-source-component="AgentPartRegistry" className="flex flex-col gap-3">
            {message.parts.map((part, index) => {
                if (part.type === "text") return <p key={index} data-component={component("text")} data-slot="text" className="whitespace-pre-wrap break-words">{part.text}</p>;
                const toolPart = part as unknown as { type?: string; state?: string; output?: unknown; errorText?: string; toolName?: string };
                if (toolPart.type === "dynamic-tool" || toolPart.type?.startsWith("tool-")) {
                    const toolName = toolPart.toolName ?? toolPart.type?.slice(5).replaceAll("_", ".") ?? "agent";
                    if (toolPart.state === "output-error") {
                        return <p key={index} data-component={component("tool-error")} data-slot="tool-error" className="text-sm text-muted-foreground">{toolPart.errorText ?? "도구 결과를 표시할 수 없습니다."}</p>;
                    }
                    if (toolPart.state === "output-available") {
                        const serialized = JSON.stringify(toolPart.output, null, 2);
                        return <details key={index} data-component={component("tool-result")} data-slot="tool-result" className="rounded-lg border p-3"><summary data-component={component("tool-result_summary")} className="cursor-pointer text-sm font-medium">{toolName} 결과</summary><pre data-component={component("tool-result_output")} className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-words text-xs">{serialized?.slice(0, 4000) ?? "결과 없음"}</pre></details>;
                    }
                    return <p key={index} data-component={component("tool-progress")} data-slot="tool-progress" className="text-sm text-muted-foreground">{toolName} 처리 중…</p>;
                }
                const data = (part as { data?: unknown }).data;
                if (part.type === "data-activity") {
                    const parsed = AgentActivityPartSchema.safeParse(data);
                    return parsed.success ? <p key={index} data-component={component("activity")} data-slot="activity" className="text-sm text-muted-foreground">{parsed.data.label}</p> : <SafePartFallback key={index} data-component={component("fallback")} />;
                }
                if (part.type === "data-error") {
                    const parsed = AgentErrorPartSchema.safeParse(data);
                    return parsed.success ? <ErrorPart key={index} data-component={component("error")} {...parsed.data} onRetry={onRetry} /> : <SafePartFallback key={index} data-component={component("fallback")} />;
                }
                if (part.type === "data-navigation") {
                    const parsed = AgentNavigationPartSchema.safeParse(data);
                    return parsed.success ? <a key={index} data-component={component("navigation")} data-slot="navigation" href={parsed.data.href} className="underline">{parsed.data.label}</a> : <SafePartFallback key={index} data-component={component("fallback")} />;
                }
                if (part.type === "data-action-proposal") {
                    const parsed = AgentActionProposalPartSchema.safeParse(data);
                    return parsed.success ? <AgentActionApprovalCard key={index} data-component={component("action-approval")} {...parsed.data} terminal={terminalActionIds?.has(parsed.data.actionId)} onApprove={onApproveAction} onReject={onRejectAction} /> : <SafePartFallback key={index} data-component={component("fallback")} />;
                }
                if (part.type === "data-action-result") {
                    const parsed = AgentActionResultPartSchema.safeParse(data);
                    return parsed.success ? <ActionResultPart key={index} data-component={component("action-result")} {...parsed.data} /> : <SafePartFallback key={index} data-component={component("fallback")} />;
                }
                if (part.type === "data-form") {
                    const parsed = AgentFormPartSchema.safeParse(data);
                    return parsed.success ? <FormRequestPart key={index} data-component={component("form-request")} {...parsed.data} onSubmit={onSubmitForm} /> : <SafePartFallback key={index} data-component={component("fallback")} />;
                }
                if (part.type === "data-form-submit") {
                    return AgentFormSubmitPartSchema.safeParse(data).success ? <p key={index} data-component={component("form-submit")} data-slot="form-submit" className="text-sm text-muted-foreground">구조화된 입력을 제출했습니다.</p> : <SafePartFallback key={index} data-component={component("fallback")} />;
                }
                if (part.type === "data-attachment") {
                    const parsed = AgentAttachmentPartSchema.safeParse(data);
                    return parsed.success ? <AttachmentPart key={index} data-component={component("attachment-part")} {...parsed.data} /> : <SafePartFallback key={index} data-component={component("fallback")} />;
                }
                if (part.type === "data-entity-choice") {
                    const parsed = AgentEntityChoicePartSchema.safeParse(data);
                    return parsed.success ? <div key={index} data-component={component("entity-choice")} data-slot="entity-choice" className="flex flex-wrap gap-2" role="group" aria-label={parsed.data.prompt}>{parsed.data.choices.map((choice) => <Button key={choice.id} data-component={component("entity-choice_choice")} type="button" variant="outline" size="sm" onClick={() => onEntitySelect?.(choice.id, parsed.data.entityType)}>{choice.label}</Button>)}</div> : <SafePartFallback key={index} data-component={component("fallback")} />;
                }
                if (part.type === "data-feedback") {
                    const parsed = AgentFeedbackPartSchema.safeParse(data);
                    return parsed.success ? <div key={index} data-component={component("feedback")} data-slot="feedback" className="flex items-center gap-2" role="group" aria-label="응답 평가"><span data-component={component("feedback_prompt")} className="text-sm text-muted-foreground">{parsed.data.prompt}</span><Button data-component={component("feedback_positive")} type="button" variant="ghost" size="sm" onClick={() => onFeedback?.("positive")}>좋아요</Button><Button data-component={component("feedback_negative")} type="button" variant="ghost" size="sm" onClick={() => onFeedback?.("negative")}>아쉬워요</Button></div> : <SafePartFallback key={index} data-component={component("fallback")} />;
                }
                return <SafePartFallback key={index} data-component={component("fallback")} />;
            })}
        </div>
    );
}

function SafePartFallback({ "data-component": dataComponent }: { "data-component": string }) {
    return <p data-component={dataComponent} data-slot="fallback" className="text-sm text-muted-foreground">이 응답의 새 형식은 현재 화면에서 안전하게 표시할 수 없습니다.</p>;
}
