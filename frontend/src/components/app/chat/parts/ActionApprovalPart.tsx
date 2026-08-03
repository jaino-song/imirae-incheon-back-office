"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";

type ActionApprovalPartProps = {
    actionId: string;
    capability: string;
    title: string;
    summary: string;
    expiresAt: string;
    expectedRevision: string;
    risk?: string;
    branchId?: string;
    target?: Record<string, unknown>;
    changes: Record<string, unknown>;
    provider?: string;
    estimatedCost?: string;
    acknowledgementToken?: string;
    terminal?: boolean;
    onApprove?: (actionId: string, expectedRevision: string, acknowledgementToken?: string) => void;
    onReject?: (actionId: string) => void;
};

export function ActionApprovalPart({ actionId, capability, title, summary, expiresAt, expectedRevision, risk, branchId, target, changes, provider, estimatedCost, acknowledgementToken, terminal = false, onApprove, onReject }: ActionApprovalPartProps) {
    const [now, setNow] = useState(0);
    const [acknowledged, setAcknowledged] = useState(false);
    useEffect(() => {
        const update = () => setNow(Date.now());
        update();
        const timer = window.setInterval(update, 30_000);
        return () => window.clearInterval(timer);
    }, []);
    const expired = now > 0 && new Date(expiresAt).getTime() <= now;
    const requiresStrongAcknowledgement = ["irreversible-write", "external-side-effect", "paid-action", "privileged-administration"].includes(risk ?? "");
    return (
        <section data-component="desktop_chat_agent-action-approval" data-source-component="ActionApprovalPart" className="flex flex-col gap-3 rounded-xl border border-amber-300 bg-amber-50 p-4 text-amber-950" aria-label="승인 대기 작업">
            <div data-slot="header" className="flex items-start justify-between gap-3"><div><p className="text-sm font-semibold">{title}</p><p className="text-xs opacity-75">{capability}</p></div><span data-slot="expiry" className="text-xs">{expired ? "만료됨" : `만료 ${new Date(expiresAt).toLocaleString()}`}</span></div>
            <p data-slot="summary" className="whitespace-pre-wrap text-sm">{summary}</p>
            <dl data-slot="details" className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                {risk && <><dt className="text-amber-800/70">위험도</dt><dd>{risk}</dd></>}
                {branchId && <><dt className="text-amber-800/70">지점</dt><dd className="truncate">{branchId}</dd></>}
                {target && <><dt className="text-amber-800/70">대상 변경</dt><dd className="col-span-2 whitespace-pre-wrap break-words">{JSON.stringify(target)}</dd></>}
                <dt className="text-amber-800/70">실제 변경값</dt><dd className="col-span-2 whitespace-pre-wrap break-words">{JSON.stringify(changes, null, 2)}</dd>
                {provider && <><dt className="text-amber-800/70">외부 제공자</dt><dd>{provider}</dd></>}
                {estimatedCost && <><dt className="text-amber-800/70">예상 비용</dt><dd>{estimatedCost}</dd></>}
            </dl>
            {requiresStrongAcknowledgement && <div data-slot="strong-acknowledgement" className="flex items-start gap-2"><Checkbox id={`agent-action-ack-${actionId}`} checked={acknowledged} onCheckedChange={(value) => setAcknowledged(value === true)} /><Label htmlFor={`agent-action-ack-${actionId}`} className="text-xs leading-5">수신자·변경값·외부 제공자와 비용을 확인했으며 이 작업의 실제 부작용을 이해했습니다.</Label></div>}
            <div data-slot="actions" className="flex flex-wrap gap-2"><Button type="button" size="sm" disabled={terminal || expired || (requiresStrongAcknowledgement && (!acknowledged || !acknowledgementToken))} onClick={() => onApprove?.(actionId, expectedRevision, acknowledgementToken)}>승인하고 실행</Button><Button type="button" size="sm" variant="outline" disabled={terminal || expired} onClick={() => onReject?.(actionId)}>거절</Button></div>
        </section>
    );
}
