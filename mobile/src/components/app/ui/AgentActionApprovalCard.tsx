"use client";

import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";

const SOURCE_COMPONENT = "AgentActionApprovalCard";
const CARD_CONTENT_SOURCE_COMPONENT = "CardContent";
const STRONG_ACKNOWLEDGEMENT_RISKS = [
    "irreversible-write",
    "external-side-effect",
    "paid-action",
    "privileged-administration",
] as const;

export interface AgentActionApprovalCardProps {
    "data-component": string;
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
}

export function AgentActionApprovalCard({
    "data-component": dataComponent,
    actionId,
    capability,
    title,
    summary,
    expiresAt,
    expectedRevision,
    risk,
    branchId,
    target,
    changes,
    provider,
    estimatedCost,
    acknowledgementToken,
    terminal = false,
    onApprove,
    onReject,
}: AgentActionApprovalCardProps) {
    const [now, setNow] = useState(0);
    const [acknowledgement, setAcknowledgement] = useState<{ actionId: string; checked: boolean }>({ actionId: "", checked: false });
    const sub = (suffix: string) => `${dataComponent}_${suffix}`;

    useEffect(() => {
        const update = () => setNow(Date.now());
        update();
        const timer = window.setInterval(update, 30_000);
        return () => window.clearInterval(timer);
    }, []);

    const expired = now > 0 && new Date(expiresAt).getTime() <= now;
    const acknowledged = acknowledgement.actionId === actionId && acknowledgement.checked;
    const requiresStrongAcknowledgement = Boolean(acknowledgementToken)
        || STRONG_ACKNOWLEDGEMENT_RISKS.some((strongRisk) => strongRisk === risk);
    const approvalDisabled = terminal
        || expired
        || (requiresStrongAcknowledgement && (!acknowledged || !acknowledgementToken));

    return (
        <Card
            data-component={dataComponent}
            data-source-component={SOURCE_COMPONENT}
            data-slot="action-proposal"
            className="border-amber-300 bg-amber-50 text-amber-950"
            aria-label="승인 대기 작업"
        >
            <CardContent
                data-component={sub("content")}
                data-source-component={CARD_CONTENT_SOURCE_COMPONENT}
                className="flex flex-col gap-3 p-4"
            >
                <div data-component={sub("header")} data-slot="header" className="flex items-start justify-between gap-3">
                    <div data-component={sub("header_copy")}>
                        <p data-slot="title" className="text-sm font-semibold">{title}</p>
                        <p data-slot="capability" className="text-xs opacity-75">{capability}</p>
                    </div>
                    <span data-slot="expiry" className="text-xs">{expired ? "만료됨" : `만료 ${new Date(expiresAt).toLocaleString()}`}</span>
                </div>
                <p data-slot="summary" className="whitespace-pre-wrap text-sm">{summary}</p>
                <dl data-slot="details" className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                    {risk && <><dt className="text-amber-800/70">위험도</dt><dd>{risk}</dd></>}
                    {branchId && <><dt className="text-amber-800/70">지점</dt><dd className="truncate">{branchId}</dd></>}
                    {target && <><dt className="text-amber-800/70">대상 변경</dt><dd className="col-span-2 whitespace-pre-wrap break-words">{JSON.stringify(target)}</dd></>}
                    <dt className="text-amber-800/70">실제 변경값</dt>
                    <dd className="col-span-2 whitespace-pre-wrap break-words">{JSON.stringify(changes, null, 2)}</dd>
                    {provider && <><dt className="text-amber-800/70">외부 제공자</dt><dd>{provider}</dd></>}
                    {estimatedCost && <><dt className="text-amber-800/70">예상 비용</dt><dd>{estimatedCost}</dd></>}
                </dl>
                {requiresStrongAcknowledgement && (
                    <div
                        data-component={sub("strong-acknowledgement")}
                        data-slot="strong-acknowledgement"
                        className="flex min-h-11 items-start gap-2"
                    >
                        <Checkbox
                            id={`mobile-agent-action-ack-${actionId}`}
                            className="h-11 w-11"
                            checked={acknowledged}
                            onCheckedChange={(value) => setAcknowledgement({ actionId, checked: value === true })}
                        />
                        <Label htmlFor={`mobile-agent-action-ack-${actionId}`} className="text-xs leading-5">
                            실제 부작용, 수신자, 제공자 및 비용을 확인했습니다.
                        </Label>
                    </div>
                )}
                <div data-component={sub("actions")} data-slot="actions" className="flex flex-wrap gap-2">
                    <Button
                        data-component={sub("actions_approve")}
                        type="button"
                        size="sm"
                        className="min-h-11 flex-1"
                        disabled={approvalDisabled}
                        onClick={() => onApprove?.(actionId, expectedRevision, acknowledgementToken)}
                    >
                        승인하고 실행
                    </Button>
                    <Button
                        data-component={sub("actions_reject")}
                        type="button"
                        size="sm"
                        variant="outline"
                        className="min-h-11 flex-1"
                        disabled={terminal || expired}
                        onClick={() => onReject?.(actionId)}
                    >
                        거절
                    </Button>
                </div>
            </CardContent>
        </Card>
    );
}
