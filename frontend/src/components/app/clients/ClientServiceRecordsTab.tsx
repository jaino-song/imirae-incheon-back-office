"use client";

import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import { ChevronDown, RefreshCw } from "lucide-react";
import { formatDateTimeKo } from "@babyjamjam/shared/utils/date";

import { DetailEmptyState, InfoCard, InfoRow } from "@/components/app/v3";
import { TwoButtonModal } from "@/components/app/ui/TwoButtonModal";
import { StatusPill } from "@/components/app/ui/status-badge";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { calcEndDateBusinessDays } from "@/lib/date/business-days";
import { formatDateForDisplay } from "@/lib/date/format-date-for-display";
import { cn } from "@/lib/utils";
import { ServiceRecordErrorBoundary } from "@/lib/observability/service-record-error-boundary";
import {
    SERVICE_RECORD_FORM_LAYOUT,
    SERVICE_RECORD_LAYOUT_ANSWER_KEYS,
    type ServiceRecordFieldDescriptor,
} from "@/features/service-records/constants/form-layout";
import { ServiceRecordHeaderCard } from "@/features/service-records/components/ServiceRecordHeaderCard";
import { useSendServiceRecordLink } from "@/features/service-records/hooks/use-service-records";
import type {
    ServiceRecordAssignment,
    ServiceRecordCase,
    ServiceRecordLinkStatus,
    ServiceRecordOverview,
    ServiceRecordSession,
    SignatureDocStatus,
} from "@/features/service-records/types";

interface ClientServiceRecordsTabProps {
    "data-component": string;
    overview?: ServiceRecordOverview;
    clientId: number | null;
    isLoading: boolean;
    isError: boolean;
    isRefreshing?: boolean;
    onRefresh?: () => void;
}

const ClientServiceRecordsDataComponentContext = createContext<string | null>(null);

function useClientServiceRecordsDataComponent(...parts: string[]): string {
    const root = useContext(ClientServiceRecordsDataComponentContext);
    if (!root) {
        throw new Error("ClientServiceRecordsTab requires a data-component owner path.");
    }
    return [root, ...parts].join("_");
}

interface SessionSlot {
    sessionIndex: number;
    record: ServiceRecordSession | null;
    expectedDate: string | null;
}

const LINK_STATUS_META: Record<ServiceRecordLinkStatus, {
    label: string;
    variant: "neutral" | "primary" | "success" | "warning" | "danger";
}> = {
    none: { label: "발송 전", variant: "neutral" },
    scheduled: { label: "발송 예약", variant: "primary" },
    sent: { label: "발송됨", variant: "success" },
    failed: { label: "발송 실패", variant: "danger" },
    canceled: { label: "발송 취소", variant: "neutral" },
};

export function ClientServiceRecordsTab({
    "data-component": dataComponent,
    ...props
}: ClientServiceRecordsTabProps) {
    return (
        <ServiceRecordErrorBoundary>
            <ClientServiceRecordsDataComponentContext.Provider value={dataComponent}>
                <ClientServiceRecordsTabContent {...props} />
            </ClientServiceRecordsDataComponentContext.Provider>
        </ServiceRecordErrorBoundary>
    );
}

function ClientServiceRecordsTabContent({
    overview,
    clientId,
    isLoading,
    isError,
    isRefreshing = false,
    onRefresh,
}: Omit<ClientServiceRecordsTabProps, "data-component">) {
    const dataComponent = useClientServiceRecordsDataComponent();
    const { toast } = useToast();
    const sendLinkMutation = useSendServiceRecordLink();
    const assignments = overview?.assignments ?? [];
    const record = overview?.record ?? null;
    const activeAssignment = assignments.find((assignment) => !assignment.replaced)
        ?? assignments[0]
        ?? null;
    const [pendingResendAssignment, setPendingResendAssignment] = useState<ServiceRecordAssignment | null>(null);

    const sendLink = async (assignment: ServiceRecordAssignment): Promise<boolean> => {
        try {
            await sendLinkMutation.mutateAsync({
                scheduleId: assignment.scheduleId,
                clientId: clientId ?? undefined,
            });
            toast({ description: "제공기록지 링크를 발송했습니다." });
            return true;
        } catch (error) {
            toast({
                description: getErrorDescription(error),
                variant: "destructive",
            });
            return false;
        }
    };

    const handleSendLink = async (assignment: ServiceRecordAssignment) => {
        const isResend = assignment.link.status === "sent" || assignment.link.status === "failed";
        if (isResend) {
            setPendingResendAssignment(assignment);
            return;
        }

        await sendLink(assignment);
    };

    const handleResendConfirm = async () => {
        if (!pendingResendAssignment) return;

        const sent = await sendLink(pendingResendAssignment);
        if (sent) {
            setPendingResendAssignment(null);
        }
    };

    if (clientId === null) {
        return (
            <DetailEmptyState
                name={`${dataComponent}_empty`}
                message="고객 정보가 없어 제공기록지를 조회할 수 없습니다"
            />
        );
    }

    if (isLoading) {
        return <ClientServiceRecordsSkeleton />;
    }

    if (isError) {
        return (
            <div
                data-component={`${dataComponent}_error`}
                className="py-12 text-center text-[calc(13px*var(--glint-ui-scale,1))] text-v3-text-muted"
            >
                제공기록지 정보를 불러오지 못했습니다
            </div>
        );
    }

    if (assignments.length === 0 && !record) {
        return (
            <DetailEmptyState
                name={`${dataComponent}_empty`}
                message="제공기록지 배정 정보가 없습니다"
            />
        );
    }

    return (
        <>
            <div data-component={dataComponent} data-source-component="ClientServiceRecordsTab" className="space-y-[calc(16px*var(--glint-ui-scale,1))]">
                {record ? (
                    <>
                        <div
                            data-component={`${dataComponent}_overview-grid`}
                            className="grid grid-cols-1 items-stretch gap-[calc(16px*var(--glint-ui-scale,1))] lg:grid-cols-3 [&>*]:content-start"
                        >
                            <RecordStatusCard record={record} />
                            <ServiceRecordHeaderCard
                                data-component={`${dataComponent}_overview-grid_header-card`}
                                header={record.header}
                                showStatusBadge={false}
                            />
                            {activeAssignment ? (
                                <LinkStatusCard
                                    assignment={activeAssignment}
                                    isPending={sendLinkMutation.isPending
                                        && sendLinkMutation.variables?.scheduleId === activeAssignment.scheduleId}
                                    onSendLink={() => void handleSendLink(activeAssignment)}
                                    showStatusBadge={false}
                                />
                            ) : (
                                <InfoCard
                                    data-component={`${dataComponent}_overview-grid_link-unassigned`}
                                    title="제공기록지 작성 링크"
                                    description="제공인력 배정 후 작성 링크가 생성됩니다"
                                >
                                <ServiceRecordInfoRow label="상태" value={<StatusPill variant="neutral">배정 대기</StatusPill>} />
                                </InfoCard>
                            )}
                        </div>
                        {assignments.length > 1 && <AssignmentHistoryCard assignments={assignments} />}
                        <ServiceSessionsCard
                            startDate={record.startDate}
                            totalSessions={record.totalSessions}
                            sessions={record.sessions}
                            isRefreshing={isRefreshing}
                            onRefresh={onRefresh}
                        />
                        {record.signatureDocs.map((signatureDoc) => (
                            <SignatureDocCard key={signatureDoc.documentId} signatureDoc={signatureDoc} />
                        ))}
                    </>
                ) : assignments.map((assignment, index) => (
                    <div
                        key={assignment.scheduleId}
                        data-component={`${dataComponent}_assignment`}
                        className="space-y-[calc(16px*var(--glint-ui-scale,1))]"
                    >
                        {assignments.length > 1 && (
                            <div
                                data-component={`${dataComponent}_assignment_period`}
                                className="flex items-center gap-[calc(10px*var(--glint-ui-scale,1))] text-[calc(11.5px*var(--glint-ui-scale,1))] font-semibold text-v3-text-muted"
                            >
                                <span className="h-px flex-1 bg-v3-border" />
                                <span>배정 기간 {formatDateKo(assignment.startDate)} - {formatDateKo(assignment.endDate)}</span>
                                <span className="h-px flex-1 bg-v3-border" />
                            </div>
                        )}
                        <LinkStatusCard
                            assignment={assignment}
                            isPending={sendLinkMutation.isPending
                                && sendLinkMutation.variables?.scheduleId === assignment.scheduleId}
                            onSendLink={() => void handleSendLink(assignment)}
                        />
                        <ServiceRecordHeaderCard
                            data-component={`${dataComponent}_assignment_header-card`}
                            header={assignment.header}
                        />
                        <ServiceSessionsCard
                            startDate={assignment.startDate}
                            totalSessions={assignment.totalSessions}
                            sessions={assignment.sessions}
                            isRefreshing={isRefreshing}
                            onRefresh={onRefresh}
                        />
                        {assignment.signatureDoc && (
                            <SignatureDocCard signatureDoc={assignment.signatureDoc} />
                        )}
                        {index < assignments.length - 1 && <div className="h-px bg-v3-border" />}
                    </div>
                ))}
            </div>

            <TwoButtonModal
                open={pendingResendAssignment !== null}
                onOpenChange={(open) => {
                    if (!open) setPendingResendAssignment(null);
                }}
                dataComponent={`${dataComponent}_resend-approval`}
                title="제공기록지 메시지를 재전송하시겠습니까?"
                description="기존 링크가 그대로 포함된 메시지를 다시 전송합니다."
                isDescriptionVisuallyHidden={false}
                approvalLabel="메시지 재전송"
                pendingLabel="메시지 재전송 중..."
                isPending={sendLinkMutation.isPending}
                onApprove={() => void handleResendConfirm()}
            />
        </>
    );
}

function ClientServiceRecordsSkeleton() {
    const dataComponent = useClientServiceRecordsDataComponent();
    return (
        <div data-component={dataComponent} data-source-component="ClientServiceRecordsTab" className="space-y-[calc(16px*var(--glint-ui-scale,1))]">
            <div
                data-component={`${dataComponent}_overview-grid`}
                className="grid grid-cols-1 items-stretch gap-[calc(16px*var(--glint-ui-scale,1))] lg:grid-cols-3 [&>*]:content-start"
            >
                <InfoCard
                    title="제공기록지 진행 상태"
                    data-component={`${dataComponent}_overview-grid_status-card`}
                >
                    {[
                        "상태",
                        "서비스 기간",
                        "작성 현황",
                        "기록 완료",
                        "전자문서 생성",
                    ].map((label) => (
                        <ServiceRecordInfoRowSkeleton key={label} label={label} />
                    ))}
                </InfoCard>

                <InfoCard
                    title="서비스 기본정보"
                    data-component={`${dataComponent}_overview-grid_header-card`}
                >
                    {[
                        "산모 성명",
                        "산모 생년월일",
                        "신생아 성명",
                        "신생아 출생일자",
                        "분만형태",
                        "신생아 몸무게",
                    ].map((label) => (
                        <ServiceRecordInfoRowSkeleton key={label} label={label} />
                    ))}
                </InfoCard>

                <InfoCard
                    title="제공기록지 작성 링크"
                    data-component={`${dataComponent}_overview-grid_link-card`}
                >
                    {[
                        "제공인력 이름",
                        "제공인력 연락처",
                        "메시지 최근 발송",
                        "제공기록지 본인 인증",
                    ].map((label) => (
                        <ServiceRecordInfoRowSkeleton key={label} label={label} />
                    ))}
                    <Skeleton className="mt-[calc(14px*var(--glint-ui-scale,1))] h-9 w-full rounded-full bg-white/70" />
                </InfoCard>
            </div>

            <InfoCard
                title="회차별 제공기록"
                data-component={`${dataComponent}_sessions`}
                titleTrailing={(
                    <Skeleton className="ml-auto h-[calc(14px*var(--glint-ui-scale,1))] w-[calc(96px*var(--glint-ui-scale,1))] bg-white/70" />
                )}
            >
                <div className="mt-[calc(8px*var(--glint-ui-scale,1))]">
                    {[0, 1, 2].map((index) => (
                        <div
                            key={index}
                            className="flex items-center gap-[calc(12px*var(--glint-ui-scale,1))] border-b border-v3-border px-[calc(4px*var(--glint-ui-scale,1))] py-[calc(13px*var(--glint-ui-scale,1))] last:border-b-0"
                        >
                            <Skeleton className="h-[calc(30px*var(--glint-ui-scale,1))] w-[calc(30px*var(--glint-ui-scale,1))] shrink-0 rounded-full bg-white/70" />
                            <div className="min-w-0 flex-1 space-y-1.5">
                                <Skeleton className="h-[calc(13px*var(--glint-ui-scale,1))] w-[calc(72px*var(--glint-ui-scale,1))] bg-white/70" />
                                <Skeleton className="h-[calc(11px*var(--glint-ui-scale,1))] w-[calc(132px*var(--glint-ui-scale,1))] bg-white/70" />
                            </div>
                            <Skeleton className="h-[calc(24px*var(--glint-ui-scale,1))] w-[calc(58px*var(--glint-ui-scale,1))] shrink-0 rounded-full bg-white/70" />
                        </div>
                    ))}
                </div>
            </InfoCard>
        </div>
    );
}

function ServiceRecordInfoRowSkeleton({ label }: { label: string }) {
    const dataComponent = useClientServiceRecordsDataComponent("skeleton", "row");
    return (
        <div
            data-component={dataComponent}
            className="flex items-start gap-[calc(16px*var(--glint-ui-scale,1))] border-b border-v3-border py-[calc(10px*var(--glint-ui-scale,1))] last:border-b-0"
        >
            <span className="shrink-0 text-[calc(12px*var(--glint-ui-scale,1))] text-v3-text-muted">
                {label}
            </span>
            <Skeleton className="ml-auto h-[calc(14px*var(--glint-ui-scale,1))] w-[calc(88px*var(--glint-ui-scale,1))] bg-white/70" />
        </div>
    );
}

function ServiceRecordInfoRow({ label, value }: { label: string; value: ReactNode }) {
    return <InfoRow label={label} value={value} size="compact" />;
}

function RecordStatusCard({ record }: { record: ServiceRecordCase }) {
    const dataComponent = useClientServiceRecordsDataComponent("overview-grid", "status-card");
    const status = getRecordStatusMeta(record.status);
    const submitted = record.sessions.filter((session) => session.locked).length;

    return (
        <InfoCard
            title="제공기록지 진행 상태"
            data-component={dataComponent}
        >
            <ServiceRecordInfoRow label="상태" value={status.label} />
            <ServiceRecordInfoRow label="서비스 기간" value={`${formatDateKo(record.startDate)} - ${formatDateKo(record.endDate)}`} />
            <ServiceRecordInfoRow label="작성 현황" value={`${submitted}/${record.totalSessions}회`} />
            <ServiceRecordInfoRow label="기록 완료" value={formatDateTimeKo(record.completedAt)} />
            <ServiceRecordInfoRow
                label="전자문서 생성"
                value={formatDateTimeKo(record.finalizedAt)}
            />
        </InfoCard>
    );
}

function AssignmentHistoryCard({ assignments }: { assignments: ServiceRecordAssignment[] }) {
    const dataComponent = useClientServiceRecordsDataComponent("assignment-history");
    const ordered = [...assignments].sort((left, right) => (
        new Date(left.startDate).getTime() - new Date(right.startDate).getTime()
    ));
    return (
        <InfoCard
            data-component={dataComponent}
            title="제공인력 배정 이력"
            description="담당자가 바뀌어도 회차 기록은 연속해서 이어집니다"
        >
            <div>
                {ordered.map((assignment) => (
                    <div
                        key={assignment.scheduleId}
                        className="flex items-center gap-[calc(12px*var(--glint-ui-scale,1))] border-b border-v3-dim-white py-[calc(8px*var(--glint-ui-scale,1))] last:border-b-0"
                    >
                        <div className="min-w-0 flex-1">
                            <div className="truncate text-[calc(12.5px*var(--glint-ui-scale,1))] font-semibold text-v3-dark">
                                {assignment.employee.name}
                            </div>
                            <div className="mt-0.5 text-[calc(11.3px*var(--glint-ui-scale,1))] text-v3-text-muted">
                                {formatDateKo(assignment.startDate)} - {formatDateKo(assignment.endDate)}
                            </div>
                        </div>
                        <StatusPill variant={assignment.replaced ? "neutral" : "primary"}>
                            {assignment.replaced ? "이전 배정" : "현재 배정"}
                        </StatusPill>
                    </div>
                ))}
            </div>
        </InfoCard>
    );
}

function getRecordStatusMeta(status: string): {
    label: string;
    variant: "neutral" | "primary" | "success" | "warning" | "danger";
} {
    switch (status) {
        case "WAITING_FOR_DETAILS": return { label: "정보 대기", variant: "neutral" };
        case "WAITING_FOR_ASSIGNMENT": return { label: "배정 대기", variant: "warning" };
        case "SCHEDULED": return { label: "시작 전", variant: "primary" };
        case "IN_PROGRESS": return { label: "작성 중", variant: "primary" };
        case "WAITING_FOR_END": return { label: "종료 대기", variant: "success" };
        case "AWAITING_COMPLETION": return { label: "기록 미완료", variant: "warning" };
        case "READY_TO_FINALIZE": return { label: "문서 생성 대기", variant: "primary" };
        case "FINALIZING": return { label: "문서 생성 중", variant: "primary" };
        case "DOCUMENTS_CREATED": return { label: "기관 검토 중", variant: "success" };
        case "COMPLETED": return { label: "완료", variant: "success" };
        case "FINALIZATION_FAILED": return { label: "문서 생성 실패", variant: "danger" };
        case "TERMINATED_REVIEW_REQUIRED": return { label: "중단 확인 필요", variant: "warning" };
        case "MIGRATION_REVIEW_REQUIRED": return { label: "데이터 확인 필요", variant: "warning" };
        default: return { label: "상태 확인", variant: "neutral" };
    }
}

function LinkStatusCard({
    assignment,
    isPending,
    onSendLink,
    showStatusBadge = true,
}: {
    assignment: ServiceRecordAssignment;
    isPending: boolean;
    onSendLink: () => void;
    showStatusBadge?: boolean;
}) {
    const dataComponent = useClientServiceRecordsDataComponent("overview-grid", "link-card");
    const { link, employee } = assignment;
    const statusMeta = LINK_STATUS_META[link.status];
    const isResend = link.status === "sent" || link.status === "failed";

    return (
        <InfoCard
            data-component={dataComponent}
            title="제공기록지 작성 링크"
            titleTrailing={showStatusBadge ? (
                <div className="ml-auto flex shrink-0 items-center gap-[calc(8px*var(--glint-ui-scale,1))]">
                    <StatusPill variant={statusMeta.variant}>{statusMeta.label}</StatusPill>
                </div>
            ) : undefined}
        >
            <ServiceRecordInfoRow label="제공인력 이름" value={employee.name} />
            <ServiceRecordInfoRow label="제공인력 연락처" value={formatPhone(employee.phone)} />
            <ServiceRecordInfoRow label="메시지 최근 발송" value={formatDateTimeKo(link.lastSentAt)} />
            <ServiceRecordInfoRow label="제공기록지 본인 인증" value={<TokenVerificationValue assignment={assignment} />} />
            <div className="mt-[calc(14px*var(--glint-ui-scale,1))] flex flex-wrap items-center justify-end gap-[calc(12px*var(--glint-ui-scale,1))]">
                {!isResend && (
                    <p className="min-w-[200px] flex-1 text-[calc(11.5px*var(--glint-ui-scale,1))] leading-6 text-v3-text-muted">
                        서비스 시작일 15:00에 자동 발송됩니다. 지금 바로 보내려면 수동 전송하세요.
                    </p>
                )}
                <Button
                    type="button"
                    variant="positive"
                    size="sm"
                    width={isResend ? "lg" : undefined}
                    disabled={isPending}
                    onClick={onSendLink}
                    data-component={isResend
                        ? `${dataComponent}_actions_resend`
                        : `${dataComponent}_actions_send`}
                >
                    {isPending ? "발송 중..." : isResend ? "메시지 재전송" : "링크 수동 전송"}
                </Button>
            </div>
        </InfoCard>
    );
}

function TokenVerificationValue({ assignment }: { assignment: ServiceRecordAssignment }) {
    const token = assignment.link.token;
    return token?.verifiedAt ? "완료" : "미완료";
}

function ServiceSessionsCard({
    startDate,
    totalSessions: configuredSessions,
    sessions,
    isRefreshing,
    onRefresh,
}: {
    startDate: string | null;
    totalSessions: number;
    sessions: ServiceRecordSession[];
    isRefreshing: boolean;
    onRefresh?: () => void;
}) {
    const dataComponent = useClientServiceRecordsDataComponent("sessions");
    const slots = useMemo(
        () => buildSessionSlots(startDate, configuredSessions, sessions),
        [configuredSessions, sessions, startDate],
    );
    const lockedCount = sessions.filter((session) => session.locked).length;
    const draftCount = sessions.filter((session) => !session.locked).length;
    const totalSessions = slots.length;

    return (
        <InfoCard
            data-component={dataComponent}
            title="회차별 제공기록"
            titleTrailing={
                <div className="ml-auto flex shrink-0 items-center gap-[calc(4px*var(--glint-ui-scale,1))]">
                    {onRefresh ? (
                        <button
                            type="button"
                            data-component={`${dataComponent}_head_refresh`}
                            className="inline-flex h-[calc(24px*var(--glint-ui-scale,1))] w-[calc(24px*var(--glint-ui-scale,1))] cursor-pointer items-center justify-center rounded-full text-v3-text-muted transition-colors hover:bg-white/70 hover:text-v3-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-v3-primary/30 disabled:cursor-wait disabled:opacity-70"
                            aria-label={isRefreshing ? "제공기록 새로고침 중" : "제공기록 새로고침"}
                            aria-busy={isRefreshing}
                            disabled={isRefreshing}
                            onClick={onRefresh}
                        >
                            <RefreshCw
                                aria-hidden="true"
                                className={cn(
                                    "h-[calc(14px*var(--glint-ui-scale,1))] w-[calc(14px*var(--glint-ui-scale,1))]",
                                    isRefreshing && "service-record-refresh-icon--spinning",
                                )}
                            />
                        </button>
                    ) : null}
                    <span className="text-[calc(12px*var(--glint-ui-scale,1))] font-semibold text-v3-text-muted">
                        <b className="text-v3-primary">{lockedCount}</b>/{totalSessions} 제출완료
                        {draftCount > 0 ? ` · 임시저장 ${draftCount}` : ""}
                    </span>
                </div>
            }
        >
            <div data-component={`${dataComponent}_list`} className="mt-[calc(8px*var(--glint-ui-scale,1))]">
                {slots.map((slot, index) => (
                    <SessionRow
                        key={slot.sessionIndex}
                        slot={slot}
                        defaultOpen={Boolean(slot.record && index === 0)}
                    />
                ))}
            </div>
        </InfoCard>
    );
}

function SessionRow({ slot, defaultOpen }: { slot: SessionSlot; defaultOpen: boolean }) {
    const dataComponent = useClientServiceRecordsDataComponent("sessions", "list", "row");
    const { record } = slot;
    if (!record) {
        return (
            <Collapsible
                defaultOpen={defaultOpen}
                data-component={dataComponent}
                className="border-b border-v3-dim-white last:border-b-0"
            >
                <CollapsibleTrigger asChild>
                    <button
                        type="button"
                        className="group flex w-full items-center gap-[calc(12px*var(--glint-ui-scale,1))] px-[calc(4px*var(--glint-ui-scale,1))] py-[calc(13px*var(--glint-ui-scale,1))] text-left opacity-75"
                    >
                        <SessionNumber index={slot.sessionIndex} state="idle" />
                        <div className="min-w-0">
                            <div className="text-[calc(13px*var(--glint-ui-scale,1))] font-semibold text-v3-dark">{slot.sessionIndex}회차</div>
                            <div className="mt-0.5 text-[calc(11.5px*var(--glint-ui-scale,1))] text-v3-text-muted">예정일 {formatDateKo(slot.expectedDate)}</div>
                        </div>
                        <div className="ml-auto flex shrink-0 items-center gap-[calc(10px*var(--glint-ui-scale,1))] text-right">
                            <StatusPill variant="neutral">미작성</StatusPill>
                            <ChevronDown className="h-[calc(14px*var(--glint-ui-scale,1))] w-[calc(14px*var(--glint-ui-scale,1))] text-v3-text-muted transition-transform group-data-[state=open]:rotate-180" />
                        </div>
                    </button>
                </CollapsibleTrigger>
                <CollapsibleContent>
                    <EmptySessionRecordDetail />
                </CollapsibleContent>
            </Collapsible>
        );
    }

    const state = record.locked ? "done" : "draft";

    return (
        <Collapsible
            defaultOpen={defaultOpen}
            data-component={dataComponent}
            className="border-b border-v3-dim-white last:border-b-0"
        >
            <CollapsibleTrigger asChild>
                <button
                    type="button"
                    className="group flex w-full items-center gap-[calc(12px*var(--glint-ui-scale,1))] px-[calc(4px*var(--glint-ui-scale,1))] py-[calc(13px*var(--glint-ui-scale,1))] text-left"
                >
                    <SessionNumber index={slot.sessionIndex} state={state} />
                    <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-[calc(8px*var(--glint-ui-scale,1))] text-[calc(13px*var(--glint-ui-scale,1))] font-semibold text-v3-dark">
                            <span>{slot.sessionIndex}회차 · {formatDateKo(record.serviceDate)}</span>
                        </div>
                        <div className="mt-0.5 text-[calc(11.5px*var(--glint-ui-scale,1))] text-v3-text-muted">
                            {record.employeeName ? `${record.employeeName} · ` : ""}
                            {record.locked
                                ? <>제출 {formatDateTimeKo(record.submittedAt)}</>
                                : <>마지막 저장 {formatDateTimeKo(record.updatedAt)} · 작성 중</>}
                        </div>
                    </div>
                    <div className="ml-auto flex shrink-0 items-center gap-[calc(10px*var(--glint-ui-scale,1))] text-right">
                        <StatusPill variant={record.locked ? "success" : "warning"}>
                            {record.locked ? "제출완료" : "임시저장"}
                        </StatusPill>
                        <ChevronDown className="h-[calc(14px*var(--glint-ui-scale,1))] w-[calc(14px*var(--glint-ui-scale,1))] text-v3-text-muted transition-transform group-data-[state=open]:rotate-180" />
                    </div>
                </button>
            </CollapsibleTrigger>
            <CollapsibleContent>
                <SessionRecordDetail record={record} />
            </CollapsibleContent>
        </Collapsible>
    );
}

function SessionNumber({ index, state }: { index: number; state: "done" | "draft" | "idle" }) {
    return (
        <div
            className={cn(
                "flex h-[calc(30px*var(--glint-ui-scale,1))] w-[calc(30px*var(--glint-ui-scale,1))] shrink-0 items-center justify-center rounded-full text-[calc(12px*var(--glint-ui-scale,1))] font-bold",
                state === "done" && "bg-v3-green-light text-v3-green",
                state === "draft" && "bg-v3-primary-light text-v3-primary",
                state === "idle" && "bg-v3-dim-white text-v3-text-muted",
            )}
        >
            {index}
        </div>
    );
}

function SessionRecordDetail({ record }: { record: ServiceRecordSession }) {
    const dataComponent = useClientServiceRecordsDataComponent("sessions", "list", "row", "detail");
    const answers = getAnswerObject(record.answers);
    const unknownEntries = Object.entries(answers)
        .filter(([key, value]) => !SERVICE_RECORD_LAYOUT_ANSWER_KEYS.has(key) && hasDisplayValue(value));

    return (
        <div
            data-component={dataComponent}
            className="px-[calc(4px*var(--glint-ui-scale,1))] pb-[calc(18px*var(--glint-ui-scale,1))] pl-[calc(46px*var(--glint-ui-scale,1))]"
        >
            {SERVICE_RECORD_FORM_LAYOUT.map((section) => (
                <div key={section.id}>
                    <div className="mb-[calc(4px*var(--glint-ui-scale,1))] mt-[calc(14px*var(--glint-ui-scale,1))] flex items-center gap-[calc(6px*var(--glint-ui-scale,1))] text-[calc(11px*var(--glint-ui-scale,1))] font-bold tracking-[0.05em] text-v3-text-muted">
                        <span
                            className={cn(
                                "h-[calc(7px*var(--glint-ui-scale,1))] w-[calc(7px*var(--glint-ui-scale,1))] rounded-full",
                                section.tone === "mom" && "bg-v3-burgundy",
                                section.tone === "baby" && "bg-v3-primary",
                                section.tone === "finish" && "bg-v3-green",
                            )}
                        />
                        {section.title}
                    </div>
                    <div className="grid grid-cols-2 gap-x-[calc(28px*var(--glint-ui-scale,1))] max-sm:grid-cols-1">
                        {section.fields.map((field) => (
                            <RecordFieldRow key={field.key} field={field} answers={answers} record={record} />
                        ))}
                    </div>
                </div>
            ))}
            {unknownEntries.length > 0 && (
                <div>
                    <div className="mb-[calc(4px*var(--glint-ui-scale,1))] mt-[calc(14px*var(--glint-ui-scale,1))] flex items-center gap-[calc(6px*var(--glint-ui-scale,1))] text-[calc(11px*var(--glint-ui-scale,1))] font-bold tracking-[0.05em] text-v3-text-muted">
                        <span className="h-[calc(7px*var(--glint-ui-scale,1))] w-[calc(7px*var(--glint-ui-scale,1))] rounded-full bg-v3-text-muted" />
                        기타 항목
                    </div>
                    <div className="grid grid-cols-2 gap-x-[calc(28px*var(--glint-ui-scale,1))] max-sm:grid-cols-1">
                        {unknownEntries.map(([key, value]) => (
                            <div key={key} className="flex items-center justify-between gap-[calc(12px*var(--glint-ui-scale,1))] border-b border-dashed border-v3-dim-white py-[calc(7px*var(--glint-ui-scale,1))]">
                                <span className="shrink-0 text-[calc(12px*var(--glint-ui-scale,1))] text-v3-text-muted">{key}</span>
                                <span className="text-right text-[calc(12.3px*var(--glint-ui-scale,1))] font-medium text-v3-dark">{formatUnknownValue(value)}</span>
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}

function EmptySessionRecordDetail() {
    const dataComponent = useClientServiceRecordsDataComponent("sessions", "list", "row", "detail");
    return (
        <div
            data-component={dataComponent}
            className="px-[calc(4px*var(--glint-ui-scale,1))] pb-[calc(18px*var(--glint-ui-scale,1))] pl-[calc(46px*var(--glint-ui-scale,1))]"
        >
            {SERVICE_RECORD_FORM_LAYOUT.map((section) => (
                <div key={section.id}>
                    <div className="mb-[calc(4px*var(--glint-ui-scale,1))] mt-[calc(14px*var(--glint-ui-scale,1))] flex items-center gap-[calc(6px*var(--glint-ui-scale,1))] text-[calc(11px*var(--glint-ui-scale,1))] font-bold tracking-[0.05em] text-v3-text-muted">
                        <span
                            className={cn(
                                "h-[calc(7px*var(--glint-ui-scale,1))] w-[calc(7px*var(--glint-ui-scale,1))] rounded-full",
                                section.tone === "mom" && "bg-v3-burgundy",
                                section.tone === "baby" && "bg-v3-primary",
                                section.tone === "finish" && "bg-v3-green",
                            )}
                        />
                        {section.title}
                    </div>
                    <div className="grid grid-cols-2 gap-x-[calc(28px*var(--glint-ui-scale,1))] max-sm:grid-cols-1">
                        {section.fields.map((field) => (
                            <div
                                key={field.key}
                                className={cn(
                                    "flex items-center justify-between gap-[calc(12px*var(--glint-ui-scale,1))] border-b border-dashed border-v3-dim-white py-[calc(7px*var(--glint-ui-scale,1))]",
                                    field.kind === "text" && "col-span-full items-start",
                                )}
                            >
                                <span className="shrink-0 text-[calc(12px*var(--glint-ui-scale,1))] text-v3-text-muted">{field.label}</span>
                                <span
                                    data-component={`${dataComponent}_field_empty-value`}
                                    className="text-right text-[calc(12px*var(--glint-ui-scale,1))] font-medium text-v3-dark"
                                >
                                    -
                                </span>
                            </div>
                        ))}
                    </div>
                </div>
            ))}
        </div>
    );
}

function RecordFieldRow({
    field,
    answers,
    record,
}: {
    field: ServiceRecordFieldDescriptor;
    answers: Record<string, unknown>;
    record: ServiceRecordSession;
}) {
    const dataComponent = useClientServiceRecordsDataComponent("sessions", "list", "row", "detail", "field");
    const isWide = field.kind === "text";
    return (
        <div
            className={cn(
                "flex items-center justify-between gap-[calc(12px*var(--glint-ui-scale,1))] border-b border-dashed border-v3-dim-white py-[calc(7px*var(--glint-ui-scale,1))]",
                isWide && "col-span-full items-start",
            )}
        >
            <span className="shrink-0 text-[calc(12px*var(--glint-ui-scale,1))] text-v3-text-muted">{field.label}</span>
            <div
                data-component={`${dataComponent}_value`}
                className="flex min-w-0 flex-wrap items-center justify-end gap-[calc(5px*var(--glint-ui-scale,1))] text-right text-[calc(12px*var(--glint-ui-scale,1))] font-medium text-v3-dark"
            >
                {renderFieldValue(field, answers, record)}
            </div>
        </div>
    );
}

function renderFieldValue(
    field: ServiceRecordFieldDescriptor,
    answers: Record<string, unknown>,
    record: ServiceRecordSession,
) {
    if (field.source === "session") {
        if (field.key === "etcService") return <FreeTextValue value={record.etcService} />;
        if (field.key === "notes") return <FreeTextValue value={record.notes} />;
        if (field.key === "paymentConfirmed") {
            return record.paymentConfirmed
                ? <span>완료</span>
                : <span className="text-v3-text-muted">미확인</span>;
        }
        if (field.key === "hasMomApproval") {
            return record.hasMomApproval
                ? <span>서명함</span>
                : <span className="text-v3-text-muted">서명 전</span>;
        }
    }

    if (field.kind === "multi") {
        const values = Array.isArray(answers[field.key]) ? answers[field.key] as unknown[] : [];
        if (values.length === 0) return <EmptyValue />;
        return values.map((value) => (
            <AnswerText key={String(value)} value={String(value)} />
        ));
    }

    if (field.kind === "radio") {
        const value = answers[field.key];
        const colorValue = field.key === "stool" ? answers.stool_color : null;
        if (!hasDisplayValue(value)) return <EmptyValue />;
        return (
            <>
                <AnswerText value={String(value)} />
                {hasDisplayValue(colorValue) && <AnswerText value={String(colorValue)} />}
            </>
        );
    }

    if (field.kind === "counts") {
        const parts = (field.subKeys ?? [])
            .map((subKey) => {
                const value = answers[subKey.key];
                if (!hasDisplayValue(value)) return null;
                return `${subKey.label} ${String(value)}${subKey.unit}`;
            })
            .filter((part): part is string => part !== null);
        return parts.length > 0 ? parts.join(" · ") : <EmptyValue />;
    }

    return <EmptyValue />;
}

function AnswerText({ value }: { value: string }) {
    return <span>{value}</span>;
}

function FreeTextValue({ value }: { value: string | null }) {
    if (!value) return <EmptyValue />;
    return <span className="min-w-0 whitespace-pre-wrap text-left">{value}</span>;
}

function EmptyValue() {
    return <span className="text-v3-text-muted">미입력</span>;
}

function SignatureDocCard({ signatureDoc }: { signatureDoc: SignatureDocStatus }) {
    const dataComponent = useClientServiceRecordsDataComponent("signature-card");
    return (
        <InfoCard
            data-component={dataComponent}
            title={signatureDoc.snapshotChunkIndex
                ? `제공기록지 전자문서 ${signatureDoc.snapshotChunkIndex}`
                : "제공기록지 전자문서"}
            description="서비스 종료 후 자동 생성 · 제공기관 검토"
            titleTrailing={
                <div className="ml-auto flex shrink-0 items-center gap-[calc(8px*var(--glint-ui-scale,1))]">
                    <StatusPill variant={getSignatureVariant(signatureDoc.statusDetail)}>{formatSignatureStatus(signatureDoc.statusDetail)}</StatusPill>
                </div>
            }
        >
            <div className="grid grid-cols-2 gap-x-[calc(24px*var(--glint-ui-scale,1))] gap-y-[calc(6px*var(--glint-ui-scale,1))] max-sm:grid-cols-1">
                <MetaRow label="문서 발송" value={formatDateTimeKo(signatureDoc.createdDate)} />
                <MetaRow label="상태 갱신" value={formatDateTimeKo(signatureDoc.updatedDate)} />
                <MetaRow label="단계" value={signatureDoc.stepName} />
                <MetaRow label="문서 ID" value={signatureDoc.documentId} />
            </div>
        </InfoCard>
    );
}

function MetaRow({ label, value }: { label: string; value: ReactNode }) {
    return (
        <div className="flex min-w-0 items-center justify-between gap-[calc(12px*var(--glint-ui-scale,1))] py-[calc(4px*var(--glint-ui-scale,1))]">
            <span className="shrink-0 text-[calc(12px*var(--glint-ui-scale,1))] text-v3-text-muted">{label}</span>
            <span className="min-w-0 text-right text-[calc(12.5px*var(--glint-ui-scale,1))] font-medium text-v3-dark">{value}</span>
        </div>
    );
}

function buildSessionSlots(
    startDate: string | null,
    configuredSessions: number,
    sessions: ServiceRecordSession[],
): SessionSlot[] {
    const total = Math.max(
        configuredSessions,
        sessions.reduce((max, session) => Math.max(max, session.sessionIndex), 0),
    );
    const sessionsByIndex = new Map(sessions.map((session) => [session.sessionIndex, session]));
    return Array.from({ length: total }, (_, index) => {
        const sessionIndex = index + 1;
        return {
            sessionIndex,
            record: sessionsByIndex.get(sessionIndex) ?? null,
            expectedDate: getExpectedSessionDate(startDate, sessionIndex),
        };
    });
}

function getExpectedSessionDate(startDate: string | null, sessionIndex: number): string | null {
    const datePart = datePartOf(startDate);
    if (!datePart) return null;
    return calcEndDateBusinessDays(datePart, sessionIndex) || null;
}

function datePartOf(value: string | null): string | null {
    if (!value) return null;
    const match = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
    return match?.[0] ?? null;
}

function formatDateKo(value: string | null): string {
    return formatDateForDisplay(value);
}

function formatPhone(phone: string): string {
    const digits = phone.replace(/\D/g, "");
    if (digits.length === 11) {
        return `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7)}`;
    }
    return phone || "-";
}

function getAnswerObject(value: Record<string, unknown>): Record<string, unknown> {
    if (value && typeof value === "object" && !Array.isArray(value)) {
        return value;
    }
    return {};
}

function hasDisplayValue(value: unknown): boolean {
    if (value === null || value === undefined) return false;
    if (typeof value === "string") return value.trim().length > 0;
    if (Array.isArray(value)) return value.length > 0;
    return true;
}

function formatUnknownValue(value: unknown): string {
    if (Array.isArray(value)) return value.map(String).join(", ");
    if (typeof value === "object" && value !== null) return JSON.stringify(value);
    return String(value);
}

function formatSignatureStatus(statusDetail: string): string {
    const normalized = statusDetail.trim().toLowerCase();
    if (normalized.includes("complete")) return "서명 완료";
    if (normalized.includes("created")) return "발송됨";
    return statusDetail.trim() || "상태 확인";
}

function getSignatureVariant(statusDetail: string): "neutral" | "primary" | "success" | "warning" | "danger" {
    const normalized = statusDetail.trim().toLowerCase();
    if (normalized.includes("complete")) return "success";
    if (normalized.includes("reject") || normalized.includes("fail")) return "danger";
    if (normalized.includes("created")) return "primary";
    return "neutral";
}

function getErrorDescription(error: unknown): string {
    if (error && typeof error === "object" && "response" in error) {
        const response = (error as { response?: { data?: unknown } }).response;
        const data = response?.data;
        if (data && typeof data === "object") {
            const message = (data as { message?: unknown; error?: unknown }).message
                ?? (data as { message?: unknown; error?: unknown }).error;
            if (typeof message === "string") return message;
        }
    }

    return "제공기록지 링크 발송에 실패했습니다.";
}
