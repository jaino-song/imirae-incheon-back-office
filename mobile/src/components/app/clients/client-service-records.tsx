"use client";

import { createContext, useContext, useMemo, useState, type KeyboardEvent, type ReactNode } from "react";
import { RefreshCw } from "lucide-react";

import {
    SERVICE_RECORD_FORM_LAYOUT,
    SERVICE_RECORD_LAYOUT_ANSWER_KEYS,
    type ServiceRecordFieldDescriptor,
} from "@babyjamjam/shared/constants/service-record-form-layout";
import type {
    ServiceRecordAssignment,
    ServiceRecordCase,
    ServiceRecordLinkStatus,
    ServiceRecordOverview,
    ServiceRecordSession,
    SignatureDocStatus,
} from "@babyjamjam/shared/types/service-record";
import { formatBirthdayYYMMDD } from "@babyjamjam/shared/utils/birthday";
import { calcEndDateBusinessDays } from "@babyjamjam/shared/utils/business-days";
import {
    formatDateForDisplay,
    formatDateTimeKo,
    parseDateForDisplay,
} from "@babyjamjam/shared/utils/date";

import { InfoCard, InfoRow } from "@/components/app/mobile-redesign/detail-sheet";
import { ApprovalTwoButtonModal } from "@/components/app/ui/ApprovalTwoButtonModal";
import { Skeleton } from "@/components/ui/skeleton";
import { useSendServiceRecordLink } from "@/hooks/useServiceRecords";
import { toast } from "@/hooks/use-toast";
import type { Client } from "@/lib/client/types";
import { ServiceRecordErrorBoundary } from "@/lib/observability/service-record-error-boundary";
import { cn } from "@/lib/utils";

interface ClientServiceRecordsProps {
    "data-component": string;
    client: Client;
    activeTab: string;
    overview?: ServiceRecordOverview;
    isLoading: boolean;
    isError: boolean;
    isRefreshing?: boolean;
    onRefresh?: () => void;
}

const ClientServiceRecordsDataComponentContext = createContext<string | null>(null);

function useClientServiceRecordsDataComponent(...parts: string[]): string {
    const root = useContext(ClientServiceRecordsDataComponentContext);
    if (!root) throw new Error("ClientServiceRecords requires a data-component owner path.");
    return [root, ...parts].join("_");
}

interface SessionSlot {
    sessionIndex: number;
    record: ServiceRecordSession | null;
    expectedDate: string | null;
}

type LinkBadgeTone = "gray" | "blue" | "green" | "burgundy";
type SessionTone = "green" | "orange" | "muted";

const LINK_STATUS_META: Record<ServiceRecordLinkStatus, { label: string; tone: LinkBadgeTone }> = {
    none: { label: "발송 전", tone: "gray" },
    scheduled: { label: "발송 예약", tone: "blue" },
    sent: { label: "발송됨", tone: "green" },
    failed: { label: "발송 실패", tone: "burgundy" },
    canceled: { label: "발송 취소", tone: "gray" },
};

const LINK_STATUS_TEXT_CLASS: Record<LinkBadgeTone, string> = {
    gray: "info-row-value-muted",
    blue: "info-row-value-primary",
    green: "info-row-value-green",
    burgundy: "info-row-value-burgundy",
};
const SERVICE_RECORD_SKELETON_CLASS = "service-record-skeleton-loader";

export function ClientServiceRecords({
    "data-component": dataComponent,
    ...props
}: ClientServiceRecordsProps) {
    return (
        <ServiceRecordErrorBoundary>
            <ClientServiceRecordsDataComponentContext.Provider value={dataComponent}>
                <ClientServiceRecordsContent {...props} />
            </ClientServiceRecordsDataComponentContext.Provider>
        </ServiceRecordErrorBoundary>
    );
}

function ClientServiceRecordsContent({
    client,
    activeTab,
    overview,
    isLoading,
    isError,
    isRefreshing = false,
    onRefresh,
}: Omit<ClientServiceRecordsProps, "data-component">) {
    const dataComponent = useClientServiceRecordsDataComponent();
    const record = overview?.record ?? null;
    const assignments = useMemo(
        () => sortAssignmentsNewestFirst(overview?.assignments ?? []),
        [overview?.assignments],
    );
    const [selectedEntry, setSelectedEntry] = useState<{
        key: string;
        assignmentScheduleId: number;
        sessionIndex: number;
    } | null>(null);

    const detailKey = `${activeTab}:${client.id}`;
    const selectedAssignment = selectedEntry?.key === detailKey
        ? assignments.find((assignment) => assignment.scheduleId === selectedEntry.assignmentScheduleId) ?? null
        : null;
    const selectedSession = selectedAssignment
        ? selectedAssignment.sessions.find((session) => session.sessionIndex === selectedEntry?.sessionIndex) ?? null
        : null;

    if (isLoading) {
        return <ServiceRecordsSkeleton />;
    }

    if (isError) {
        return (
            <div className="detail-empty-state" data-component={`${dataComponent}_error`}>
                제공기록지 정보를 불러오지 못했습니다.
            </div>
        );
    }

    if (assignments.length === 0 && !record) {
        return (
            <div className="detail-empty-state" data-component={`${dataComponent}_empty`}>
                제공기록지 배정 정보가 없습니다.
            </div>
        );
    }

    if (selectedAssignment && selectedEntry) {
        const selectedSlot = buildSessionSlots(selectedAssignment)
            .find((slot) => slot.sessionIndex === selectedEntry.sessionIndex) ?? null;
        return (
            <div data-component={dataComponent} data-source-component="ClientServiceRecords">
                <ServiceRecordSessionDetail
                    record={selectedSession ?? null}
                    sessionIndex={selectedEntry.sessionIndex}
                    expectedDate={selectedSlot?.expectedDate ?? null}
                    onBack={() => setSelectedEntry(null)}
                />
            </div>
        );
    }

    return (
        <div className="detail-column" data-component={dataComponent} data-source-component="ClientServiceRecords">
            {record ? <RecordStatusCard record={record} /> : null}
            {assignments.map((assignment, assignmentIndex) => (
                <div
                    key={assignment.scheduleId}
                    className="detail-column"
                    data-component={`${dataComponent}_assignment`}
                >
                    <LinkCard
                        assignment={assignment}
                        clientId={client.id}
                        delay={assignmentIndex * 180}
                        showStatus={!record}
                    />
                    <ServiceHeaderCard assignment={assignment} delay={assignmentIndex * 180 + 60} />
                    <ServiceSessionsCard
                        assignment={assignment}
                        delay={assignmentIndex * 180 + 120}
                        isRefreshing={isRefreshing}
                        onRefresh={onRefresh}
                        onSelectSession={(sessionIndex, trigger) => {
                            const selectSession = () => setSelectedEntry({
                                key: detailKey,
                                assignmentScheduleId: assignment.scheduleId,
                                sessionIndex,
                            });
                            const scrollContainer = trigger.closest(".detail-body");

                            if (scrollContainer instanceof HTMLElement && scrollContainer.scrollTop > 0) {
                                scrollContainer.scrollTop = 0;
                                window.requestAnimationFrame(selectSession);
                                return;
                            }

                            selectSession();
                        }}
                    />
                </div>
            ))}
            {record?.signatureDocs.map((signatureDoc) => (
                <SignatureDocumentCard
                    key={signatureDoc.documentId}
                    signatureDoc={signatureDoc}
                />
            ))}
        </div>
    );
}

function RecordStatusCard({ record }: { record: ServiceRecordCase }) {
    const dataComponent = useClientServiceRecordsDataComponent("status-card");
    const statusLabel = getRecordStatusLabel(record.status);
    const submitted = record.sessions.filter((session) => session.locked).length;

    return (
        <div data-component={dataComponent}>
            <InfoCard data-component={`${dataComponent}_info-card`} title="제공기록지 진행 상태">
                <InfoRow label="상태" value={statusLabel} />
                <InfoRow
                    label="서비스 기간"
                    value={`${formatDateKo(record.startDate)} - ${formatDateKo(record.endDate)}`}
                />
                <InfoRow label="작성 현황" value={`${submitted}/${record.totalSessions}회`} />
                <InfoRow label="기록 완료" value={formatDateTimeKo(record.completedAt)} />
                <InfoRow label="전자문서 생성" value={formatDateTimeKo(record.finalizedAt)} />
            </InfoCard>
        </div>
    );
}

function getRecordStatusLabel(status: string): string {
    switch (status) {
        case "WAITING_FOR_DETAILS": return "정보 대기";
        case "WAITING_FOR_ASSIGNMENT": return "배정 대기";
        case "SCHEDULED": return "시작 전";
        case "IN_PROGRESS": return "작성 중";
        case "WAITING_FOR_END": return "종료 대기";
        case "AWAITING_COMPLETION": return "기록 미완료";
        case "READY_TO_FINALIZE": return "문서 생성 대기";
        case "FINALIZING": return "문서 생성 중";
        case "DOCUMENTS_CREATED": return "기관 검토 중";
        case "COMPLETED": return "완료";
        case "FINALIZATION_FAILED": return "문서 생성 실패";
        case "TERMINATED_REVIEW_REQUIRED": return "중단 확인 필요";
        case "MIGRATION_REVIEW_REQUIRED": return "데이터 확인 필요";
        default: return "상태 확인";
    }
}

function LinkCard({
    assignment,
    clientId,
    delay,
    showStatus,
}: {
    assignment: ServiceRecordAssignment;
    clientId: number;
    delay: number;
    showStatus: boolean;
}) {
    const dataComponent = useClientServiceRecordsDataComponent("link-card");
    const sendLinkMutation = useSendServiceRecordLink();
    const [resendModalOpen, setResendModalOpen] = useState(false);
    const statusMeta = LINK_STATUS_META[assignment.link.status];
    const isResend = assignment.link.status === "sent" || assignment.link.status === "failed";
    const showSentMetadata = assignment.link.status === "sent"
        || assignment.link.status === "failed"
        || assignment.link.status === "canceled";
    const expiresAt = assignment.link.token?.expiresAt ?? endDateExpiry(assignment.endDate);
    // 토큰이 발급된 적 없는 배정(발송 전)은 예상 만료일만 보여주고 만료됨 배지는 달지 않는다.
    const isExpired = assignment.link.token
        ? assignment.link.token.state === "expired" || isPastDate(expiresAt)
        : false;

    const sendLink = async () => {
        try {
            await sendLinkMutation.mutateAsync({
                scheduleId: assignment.scheduleId,
                clientId,
            });
            toast({ description: "제공기록지 링크를 발송했습니다." });
        } catch (error) {
            toast({
                description: getErrorDescription(error),
                variant: "destructive",
            });
        }
    };

    const handleSendClick = () => {
        if (isResend) {
            setResendModalOpen(true);
            return;
        }

        void sendLink();
    };

    const handleConfirmResend = async () => {
        await sendLink();
        setResendModalOpen(false);
    };

    return (
        <InfoCard data-component={dataComponent} title="제공기록지 작성 링크" delay={delay}>
            {showStatus ? (
                <InfoRow
                    label="상태"
                    value={<span className={LINK_STATUS_TEXT_CLASS[statusMeta.tone]}>{statusMeta.label}</span>}
                />
            ) : null}
            <InfoRow
                label="제공인력"
                value={`${assignment.employee.name} · ${formatPhone(assignment.employee.phone)}`}
            />
            {showSentMetadata ? (
                <InfoRow
                    label="최근 발송"
                    value={assignment.link.status === "sent" ? formatDateTimeKo(assignment.link.lastSentAt) : "-"}
                    tone={assignment.link.status === "sent" ? undefined : "muted"}
                />
            ) : null}
            <InfoRow
                label="발송 이력"
                value={assignment.link.sentCount > 0 ? `${assignment.link.sentCount}회` : "-"}
                tone={assignment.link.sentCount > 0 ? undefined : "muted"}
            />
            {showSentMetadata || assignment.link.token ? (
                <InfoRow
                    label="링크 인증"
                    value={
                        assignment.link.token?.verifiedAt ? (
                            <span className="info-row-value-primary">전화번호 인증 완료</span>
                        ) : (
                            <span className="info-row-value">미인증</span>
                        )
                    }
                />
            ) : null}
            <InfoRow
                label="링크 만료"
                value={
                    <span className="status-value-with-time">
                        <span>{formatDateTimeKo(expiresAt)}</span>
                        {isExpired ? <span className="badge-mini burgundy">만료됨</span> : null}
                    </span>
                }
            />
            <div className="detail-actions card-actions">
                <button
                    type="button"
                    className={cn("btn", isResend ? "btn-secondary" : "btn-primary")}
                    data-component={isResend
                        ? `${dataComponent}_actions_resend`
                        : `${dataComponent}_actions_send`}
                    disabled={sendLinkMutation.isPending}
                    onClick={handleSendClick}
                >
                    {sendLinkMutation.isPending ? "발송 중..." : isResend ? "메시지 재전송" : "링크 수동 전송"}
                </button>
            </div>
            <ApprovalTwoButtonModal
                open={resendModalOpen}
                onOpenChange={(open) => {
                    if (!sendLinkMutation.isPending) {
                        setResendModalOpen(open);
                    }
                }}
                dataComponent={`${dataComponent}_resend-approval`}
                title="제공기록지 메시지를 재전송하시겠습니까?"
                description="기존 링크가 그대로 포함된 메시지를 다시 전송합니다."
                isDescriptionVisuallyHidden={false}
                approvalLabel="메시지 재전송"
                pendingLabel="메시지 재전송 중..."
                isPending={sendLinkMutation.isPending}
                onApprove={handleConfirmResend}
            />
        </InfoCard>
    );
}

function SignatureDocumentCard({ signatureDoc }: { signatureDoc: SignatureDocStatus }) {
    const dataComponent = useClientServiceRecordsDataComponent("signature-card");
    const title = signatureDoc.snapshotChunkIndex
        ? `제공기록지 전자문서 ${signatureDoc.snapshotChunkIndex}`
        : "제공기록지 전자문서";

    return (
        <div data-component={dataComponent}>
            <InfoCard data-component={`${dataComponent}_info-card`} title={title}>
                <InfoRow label="상태" value={formatSignatureStatus(signatureDoc.statusDetail)} />
                <InfoRow label="문서 발송" value={formatDateTimeKo(signatureDoc.createdDate)} />
                <InfoRow label="상태 갱신" value={formatDateTimeKo(signatureDoc.updatedDate)} />
                <InfoRow label="단계" value={signatureDoc.stepName || "-"} />
                <InfoRow label="문서 ID" value={signatureDoc.documentId} />
            </InfoCard>
        </div>
    );
}

function formatSignatureStatus(statusDetail: string): string {
    const normalized = statusDetail.trim().toLowerCase();
    if (!normalized) return "상태 확인";
    if (normalized.includes("complete")) return "서명 완료";
    if (normalized.includes("created")) return "발송됨";
    return statusDetail.trim();
}

function ServiceHeaderCard({
    assignment,
    delay,
}: {
    assignment: ServiceRecordAssignment;
    delay: number;
}) {
    const dataComponent = useClientServiceRecordsDataComponent("header-card");
    const header = assignment.header;

    return (
        <InfoCard data-component={dataComponent} title="서비스 기본정보" delay={delay}>
            {header ? (
                <>
                    <InfoRow label="산모 성명" value={header.momName ?? "-"} />
                    <InfoRow
                        label="산모 생년월일"
                        value={header.momBirth ? formatBirthdayYYMMDD(header.momBirth) : "-"}
                    />
                    <InfoRow label="신생아 성명" value={header.babyName ?? "-"} />
                    <InfoRow label="신생아 출생일자" value={header.babyBirth ?? "-"} />
                    <InfoRow label="분만형태" value={header.deliveryType ?? "-"} />
                    <InfoRow label="신생아 몸무게" value={formatBabyWeight(header.babyWeight)} />
                </>
            ) : (
                <div
                    className="detail-empty-state"
                    data-component={`${dataComponent}_empty`}
                >
                    아직 작성된 기본정보가 없습니다.<br />제공인력이 링크 접속 후 입력하면 표시됩니다.
                </div>
            )}
        </InfoCard>
    );
}

function ServiceSessionsCard({
    assignment,
    delay,
    isRefreshing,
    onRefresh,
    onSelectSession,
}: {
    assignment: ServiceRecordAssignment;
    delay: number;
    isRefreshing: boolean;
    onRefresh?: () => void;
    onSelectSession: (sessionIndex: number, trigger: HTMLElement) => void;
}) {
    const dataComponent = useClientServiceRecordsDataComponent("sessions-card");
    const slots = buildSessionSlots(assignment);
    const lockedCount = assignment.sessions.filter((session) => session.locked).length;
    const draftCount = assignment.sessions.filter((session) => !session.locked).length;

    return (
        <div
            className="info-card pop-up"
            data-component={dataComponent}
            style={{ animationDelay: `${delay}ms` }}
        >
            <div
                className="service-record-card-title-row"
                data-component={`${dataComponent}_header`}
            >
                <div className="info-card-title">회차별 제공기록</div>
                <div
                    className="service-record-progress-row"
                    data-component={`${dataComponent}_header_progress`}
                >
                    {onRefresh ? (
                        <button
                            type="button"
                            className="service-record-refresh-button"
                            data-component={`${dataComponent}_header_refresh`}
                            aria-label={isRefreshing ? "제공기록 새로고침 중" : "제공기록 새로고침"}
                            aria-busy={isRefreshing}
                            disabled={isRefreshing}
                            onClick={onRefresh}
                        >
                            <RefreshCw
                                size={14}
                                className={cn(isRefreshing && "animate-spin")}
                                aria-hidden="true"
                            />
                        </button>
                    ) : null}
                    <span className="info-row-value">
                        {`${lockedCount}/${slots.length} 제출완료${draftCount > 0 ? ` · 임시저장 ${draftCount}` : ""}`}
                    </span>
                </div>
            </div>
            {slots.map((slot) => (
                <SessionRow
                    key={slot.sessionIndex}
                    slot={slot}
                    onSelect={(trigger) => onSelectSession(slot.sessionIndex, trigger)}
                />
            ))}
        </div>
    );
}

function SessionRow({
    slot,
    onSelect,
}: {
    slot: SessionSlot;
    onSelect: (trigger: HTMLElement) => void;
}) {
    const dataComponent = useClientServiceRecordsDataComponent("sessions-card", "row");
    const record = slot.record;
    const tone: SessionTone = record ? (record.locked ? "green" : "orange") : "muted";
    const badge = record ? (record.locked ? "제출완료" : "임시저장") : "미작성";
    const titleDate = record ? formatShortDateKo(record.serviceDate) : null;
    const meta = record
        ? record.locked
            ? `제출 ${formatDateTimeKo(record.submittedAt ?? record.updatedAt)}`
            : `마지막 저장 ${formatDateTimeKo(record.updatedAt)} · 작성 중`
        : `예정일 ${formatDateKo(slot.expectedDate)}`;
    const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
        if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            onSelect(event.currentTarget);
        }
    };

    return (
        <div
            className="doc-row doc-row-tappable"
            role="button"
            tabIndex={0}
            data-component={dataComponent}
            onClick={(event) => onSelect(event.currentTarget)}
            onKeyDown={handleKeyDown}
        >
            <div className={`doc-icon doc-icon-${tone}`}>{slot.sessionIndex}</div>
            <div className="doc-info">
                <div className="doc-title">
                    {record && titleDate ? `${slot.sessionIndex}회차 · ${titleDate}` : `${slot.sessionIndex}회차`}
                </div>
                <div className="doc-meta">{meta}</div>
            </div>
            <span className={cn("badge-mini", tone === "muted" ? "gray" : tone)}>{badge}</span>
        </div>
    );
}

function ServiceRecordSessionDetail({
    record,
    sessionIndex,
    expectedDate,
    onBack,
}: {
    record: ServiceRecordSession | null;
    sessionIndex: number;
    expectedDate: string | null;
    onBack: () => void;
}) {
    const dataComponent = useClientServiceRecordsDataComponent("sessions-card", "row", "detail");
    const answers = getAnswerObject(record?.answers ?? {});
    const unknownEntries = Object.entries(answers)
        .filter(([key, value]) => !SERVICE_RECORD_LAYOUT_ANSWER_KEYS.has(key) && hasDisplayValue(value));
    const statusTone: SessionTone = record ? (record.locked ? "green" : "orange") : "muted";

    return (
        <div className="message-detail pop-up" data-component={dataComponent}>
            <button
                type="button"
                className="message-detail-back"
                data-component={`${dataComponent}_back`}
                onClick={onBack}
            >
                <span aria-hidden="true">‹ </span>
                목록으로
            </button>

            <div className="message-detail-head">
                <div className={`doc-icon doc-icon-${statusTone}`}>{sessionIndex}</div>
                <div className="message-detail-head-text">
                    <div className="message-detail-title">{sessionIndex}회차 제공기록</div>
                    <div className="message-detail-subtitle">
                        {record
                            ? <>제공일 {formatDateKo(record.serviceDate)} · {record.locked
                                ? `제출 ${formatTimeKo(record.submittedAt ?? record.updatedAt)}`
                                : `마지막 저장 ${formatTimeKo(record.updatedAt)}`}</>
                            : <>예정일 {formatDateKo(expectedDate)}</>}
                    </div>
                </div>
                <span className="message-detail-subtitle">
                    {record ? (record.locked ? "제출완료" : "임시저장") : "미작성"}
                </span>
            </div>

            {SERVICE_RECORD_FORM_LAYOUT.map((section) => (
                <InfoCard data-component={`${dataComponent}_section-${section.id}`} key={section.id} title={section.title}>
                    {section.fields.map((field) => (
                        <SessionFieldRow
                            key={field.key}
                            field={field}
                            answers={answers}
                            record={record}
                        />
                    ))}
                </InfoCard>
            ))}

            {unknownEntries.length > 0 ? (
                <InfoCard data-component={`${dataComponent}_other-fields`} title="기타 항목">
                    {unknownEntries.map(([key, value]) => (
                        <InfoRow key={key} label={key} value={formatUnknownValue(value)} />
                    ))}
                </InfoCard>
            ) : null}

            <div className="detail-empty-state service-record-snapshot-note">
                제출 시점의 양식 스냅샷 기준으로 표시됩니다. 양식에 없는 항목은 &quot;기타 항목&quot;으로 표시됩니다.
            </div>
        </div>
    );
}

function SessionFieldRow({
    field,
    answers,
    record,
}: {
    field: ServiceRecordFieldDescriptor;
    answers: Record<string, unknown>;
    record: ServiceRecordSession | null;
}) {
    const display = formatFieldValue(field, answers, record);

    if (field.kind === "text" && display.value) {
        return (
            <div className="info-row service-record-text-row">
                <span className="info-row-label">{field.label}</span>
                <span className={cn("message-detail-body", !display.value && "info-row-value-muted")}>
                    {display.value || "-"}
                </span>
            </div>
        );
    }

    return (
        <InfoRow
            label={field.label}
            value={display.value || "-"}
        />
    );
}

function formatFieldValue(
    field: ServiceRecordFieldDescriptor,
    answers: Record<string, unknown>,
    record: ServiceRecordSession | null,
): { value: ReactNode } {
    if (field.source === "session") {
        if (field.key === "etcService") return { value: record?.etcService ?? "" };
        if (field.key === "notes") return { value: record?.notes ?? "" };
        if (field.key === "paymentConfirmed") {
            if (!record) return { value: "" };
            return record.paymentConfirmed ? { value: "완료" } : { value: "미확인" };
        }
        if (field.key === "hasMomApproval") {
            if (!record) return { value: "" };
            return record.hasMomApproval ? { value: "서명함" } : { value: "서명 전" };
        }
    }

    if (field.kind === "multi") {
        const answerValue = answers[field.key];
        const values = Array.isArray(answerValue) ? answerValue.filter(hasDisplayValue).map(String) : [];
        const value = values.join(", ");
        return { value };
    }

    if (field.kind === "radio") {
        const value = hasDisplayValue(answers[field.key]) ? String(answers[field.key]) : "";
        const colorValue = field.key === "stool" && hasDisplayValue(answers.stool_color)
            ? String(answers.stool_color)
            : "";
        const displayValue = [value, colorValue].filter(Boolean).join(" · ");
        return { value: displayValue };
    }

    if (field.kind === "counts") {
        const parts = (field.subKeys ?? [])
            .map((subKey) => {
                const value = answers[subKey.key];
                if (!hasDisplayValue(value)) return null;
                const prefix = subKey.label === "횟수" || subKey.label === "체온" ? "" : `${subKey.label} `;
                return `${prefix}${String(value)}${subKey.unit}`;
            })
            .filter((part): part is string => Boolean(part));
        return { value: parts.join(" · ") };
    }

    return { value: "" };
}

function sortAssignmentsNewestFirst(assignments: ServiceRecordAssignment[]): ServiceRecordAssignment[] {
    return [...assignments].sort((a, b) => {
        const aTime = new Date(a.startDate).getTime();
        const bTime = new Date(b.startDate).getTime();
        const aSort = Number.isFinite(aTime) ? aTime : 0;
        const bSort = Number.isFinite(bTime) ? bTime : 0;
        return bSort - aSort || b.scheduleId - a.scheduleId;
    });
}

function buildSessionSlots(assignment: ServiceRecordAssignment): SessionSlot[] {
    const total = Math.max(
        assignment.totalSessions,
        assignment.sessions.reduce((max, session) => Math.max(max, session.sessionIndex), 0),
    );
    const sessionsByIndex = new Map(assignment.sessions.map((session) => [session.sessionIndex, session]));
    return Array.from({ length: total }, (_, index) => {
        const sessionIndex = index + 1;
        return {
            sessionIndex,
            record: sessionsByIndex.get(sessionIndex) ?? null,
            expectedDate: getExpectedSessionDate(assignment.startDate, sessionIndex),
        };
    });
}

function getExpectedSessionDate(startDate: string, sessionIndex: number): string | null {
    const datePart = datePartOf(startDate);
    if (!datePart) return null;
    return calcEndDateBusinessDays(datePart, sessionIndex) || null;
}

function endDateExpiry(endDate: string): string | null {
    const datePart = datePartOf(endDate);
    return datePart ? `${datePart}T20:00:00+09:00` : null;
}

function isPastDate(value: string | null): boolean {
    if (!value) return false;
    const date = new Date(value);
    return !Number.isNaN(date.getTime()) && date.getTime() < Date.now();
}

function datePartOf(value: string | null): string | null {
    if (!value) return null;
    const match = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
    return match?.[0] ?? null;
}

function formatDateKo(value: string | null): string {
    return formatDateForDisplay(value);
}

function formatShortDateKo(value: string | null): string {
    return formatDateKo(value);
}

function formatTimeKo(value: string | null): string {
    const date = parseDateForDisplay(value);
    if (!date) return "-";
    return new Intl.DateTimeFormat("ko-KR", {
        hour: "numeric",
        minute: "2-digit",
        hour12: true,
    }).format(date);
}

function formatPhone(phone: string): string {
    const digits = phone.replace(/\D/g, "");
    if (digits.length === 11) {
        return `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7)}`;
    }
    return phone || "-";
}

function formatBabyWeight(value: string | null): string {
    if (!value) return "-";
    return value.endsWith("kg") ? value : `${value}kg`;
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

function getErrorDescription(error: unknown): string {
    if (isRecord(error)) {
        const response = error.response;
        if (isRecord(response)) {
            const data = response.data;
            if (isRecord(data)) {
                const message = data.message ?? data.error;
                if (typeof message === "string" && message.trim()) {
                    return message;
                }
            }
        }

        if (typeof error.message === "string" && error.message.trim()) {
            return error.message;
        }
    }

    return "제공기록지 링크 발송 중 오류가 발생했습니다.";
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null;
}

function SkeletonInfoRow({
    labelClassName,
    valueClassName,
}: {
    labelClassName: string;
    valueClassName: string;
}) {
    return (
        <div className="info-row">
            <Skeleton className={cn(SERVICE_RECORD_SKELETON_CLASS, "info-row-label h-3 rounded-md", labelClassName)} />
            <Skeleton className={cn(SERVICE_RECORD_SKELETON_CLASS, "ml-auto h-3 rounded-md", valueClassName)} />
        </div>
    );
}

function ServiceRecordsSkeleton() {
    const dataComponent = useClientServiceRecordsDataComponent("skeleton");
    return (
        <div className="detail-column" data-component={dataComponent} aria-hidden>
            <div className="info-card pop-up" data-component={`${dataComponent}_link-card`}>
                <Skeleton className={cn(SERVICE_RECORD_SKELETON_CLASS, "info-card-title h-3 w-32 rounded-md")} />
                <SkeletonInfoRow labelClassName="w-8" valueClassName="w-14" />
                <SkeletonInfoRow labelClassName="w-14" valueClassName="w-36" />
                <SkeletonInfoRow labelClassName="w-16" valueClassName="w-28" />
                <SkeletonInfoRow labelClassName="w-16" valueClassName="w-10" />
                <SkeletonInfoRow labelClassName="w-16" valueClassName="w-24" />
                <SkeletonInfoRow labelClassName="w-16" valueClassName="w-36" />
                <Skeleton className={cn(SERVICE_RECORD_SKELETON_CLASS, "mt-3 h-10 w-full rounded-2xl")} />
            </div>
            <div className="info-card pop-up" data-component={`${dataComponent}_header-card`}>
                <Skeleton className={cn(SERVICE_RECORD_SKELETON_CLASS, "info-card-title h-3 w-24 rounded-md")} />
                {Array.from({ length: 6 }, (_, index) => (
                    <SkeletonInfoRow key={index} labelClassName="w-16" valueClassName="w-28" />
                ))}
            </div>
            <div className="info-card pop-up" data-component={`${dataComponent}_sessions-card`}>
                <div className="service-record-card-title-row">
                    <Skeleton className={cn(SERVICE_RECORD_SKELETON_CLASS, "info-card-title h-3 w-24 rounded-md")} />
                    <Skeleton className={cn(SERVICE_RECORD_SKELETON_CLASS, "h-3 w-20 rounded-md")} />
                </div>
                {Array.from({ length: 3 }, (_, index) => (
                    <div key={index} className="doc-row">
                        <Skeleton className={cn(SERVICE_RECORD_SKELETON_CLASS, "h-8 w-8 shrink-0 rounded-full")} />
                        <div className="flex-1 space-y-1.5">
                            <Skeleton className={cn(SERVICE_RECORD_SKELETON_CLASS, "h-3 w-20 rounded-md")} />
                            <Skeleton className={cn(SERVICE_RECORD_SKELETON_CLASS, "h-3 w-32 rounded-md")} />
                        </div>
                        <Skeleton className={cn(SERVICE_RECORD_SKELETON_CLASS, "h-6 w-14 rounded-full")} />
                    </div>
                ))}
            </div>
        </div>
    );
}
