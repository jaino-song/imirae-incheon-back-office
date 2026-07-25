"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { MESSAGE_HISTORY_STATUS_LABELS } from "@babyjamjam/shared";
import { formatBirthdayYYMMDD } from "@babyjamjam/shared/utils/birthday";

import { Button } from "@/components/ui/button";
import {
    useApproveScheduleChange,
    useRejectScheduleChange,
} from "@/features/clients/hooks/use-clients";
import type { Client } from "@/lib/client/types";
import { getClientBadgeAvatarClassName, getClientBadges, getPrimaryClientBadge } from "@/lib/client/badges";
import { useToast } from "@/hooks/use-toast";
import { useMessageHistory } from "@/features/message-triggers/hooks/use-message-triggers";
import type { MessageLogRecord } from "@/features/message-triggers/types";
import {
    getMessageHistoryTimestamp,
    MessageHistoryDetailPanel,
    MESSAGE_HISTORY_STATUS_META,
    normalizeMessageHistoryRecord,
    type MessageHistoryRecord,
} from "@/components/app/messages/MessageHistoryDetailPanel";
import { ClientServiceRecordsTab } from "@/components/app/clients/ClientServiceRecordsTab";
import { clientKeys } from "@/features/clients/hooks/keys";
import { useClientServiceRecords } from "@/features/service-records/hooks/use-service-records";
import { dashboardQueryKeys } from "@/hooks/useDashboardStats";
import { useLocale } from "@/providers/LocaleProvider";
import { t } from "@/lib/i18n/translations";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { formatDateForDisplay } from "@/lib/date/format-date-for-display";
import {
    DetailPanel,
    InfoCard,
    InfoRow,
    StatusBadge,
    AnimatedSlotList,
    AnimatedSlotListItemContent,
    DetailEmptyState,
    DetailTabPanels,
    DetailTabs,
} from "@/components/app/v3";
import { formatKoreanPhoneNumber, normalizeKoreanPhoneLookupKey } from "@/lib/phone";
import { matchesMessageHistoryClient } from "@/lib/message-history/client-match";
import { mapStatusToLabel, type DocumentStatusLabel } from "@/lib/eformsign/status-codes";
import { eformsignApi, withEformsignReauth, type LocalEformsignDocRecord } from "@/services/api";
import { Users } from "lucide-react";

const CLIENT_DETAIL_TABS = [
    { key: "basic", label: "기본 정보" },
    { key: "contracts", label: "계약서 정보" },
    { key: "messages", label: "알림 발송" },
    { key: "service-records", label: "제공기록지" },
] as const;

const SCHEDULE_CHANGE_DETAIL_TAB = { key: "schedule-change", label: "일정 변경" } as const;

type ClientDetailTabKey =
    | (typeof CLIENT_DETAIL_TABS)[number]["key"]
    | typeof SCHEDULE_CHANGE_DETAIL_TAB["key"];

const CLIENT_MESSAGE_HISTORY_LIMIT = 500;
const CLIENT_MESSAGE_DETAIL_SLIDE_DURATION_MS = 300;
const formatDate = (dateStr: string | null): string => {
    return formatDateForDisplay(dateStr);
};

const formatDateTime = (dateStr: string | null): string => {
    if (!dateStr) return "-";
    const date = new Date(dateStr);
    if (Number.isNaN(date.getTime())) return "-";
    return date.toLocaleString("ko-KR", {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
    });
};

const DOCUMENT_STATUS_BADGE_STATUS = {
    "대기": "pending",
    "검토 필요": "review",
    "완료": "signed",
    "기간 만료": "expired",
} satisfies Record<DocumentStatusLabel, Parameters<typeof StatusBadge>[0]["status"]>;

function getClientDocumentStatusFallback(status: Client["documentStatus"]): Partial<LocalEformsignDocRecord> | null {
    if (status === "completed") {
        return { statusType: "003", statusDetail: "완료", stepName: "완료" };
    }

    if (status === "opened" || status === "requested") {
        return { statusType: "070", statusDetail: "검토 필요", stepName: "검토 필요" };
    }

    return null;
}

const formatScheduleChangeMonthDay = (dateStr: string): string => {
    return formatDateForDisplay(dateStr, dateStr);
};

const getScheduleChangeErrorCode = (error: unknown): string | null => {
    if (!error || typeof error !== "object" || !("response" in error)) {
        return null;
    }

    const response = error.response;
    if (!response || typeof response !== "object" || !("data" in response)) {
        return null;
    }

    const data = response.data;
    if (!data || typeof data !== "object" || !("code" in data)) {
        return null;
    }

    return typeof data.code === "string" ? data.code : null;
};

const formatPrice = (price: string | null): string => {
    if (!price) return "-";
    const cleaned = price.replace(/,/g, "");
    const num = parseInt(cleaned, 10);
    if (isNaN(num)) return "-";
    return `${num.toLocaleString("ko-KR")}원`;
};

export function getClientDetailSubtitle(
    client: Pick<Client, "type" | "duration" | "serviceStatus">,
): string {
    const clientType = client.type || "일반";
    const hasDuration = client.duration !== null;

    if (client.serviceStatus === "pre_booking" && !hasDuration) {
        return clientType;
    }

    return `${clientType} · ${hasDuration ? `${client.duration}일` : "-"}`;
}

function getClientMessageHistoryTime(record: MessageLogRecord) {
    const timestamp = getMessageHistoryTimestamp(record);
    const time = new Date(timestamp).getTime();
    return Number.isNaN(time) ? 0 : time;
}

function ClientMessageHistoryList({
    records,
    canLookupMessages,
    isError,
    isLoading,
    clientName,
    selectedRecordId,
    onSelectRecord,
    dataComponentPrefix,
}: {
    records: MessageLogRecord[];
    canLookupMessages: boolean;
    isError: boolean;
    isLoading: boolean;
    clientName: string;
    selectedRecordId: number | string | null;
    onSelectRecord: (record: MessageLogRecord) => void;
    dataComponentPrefix: string;
}) {
    if (!canLookupMessages) {
        return (
            <DetailEmptyState
                name={`${dataComponentPrefix}-messages-empty`}
                message="고객 정보가 없어 메시지 발송 내역을 조회할 수 없습니다"
            />
        );
    }

    if (isLoading) {
        return (
            <div data-component={`${dataComponentPrefix}-messages-skeleton-list`} className="space-y-2">
                {[0, 1, 2].map((index) => (
                    <div
                        key={index}
                        data-component={`${dataComponentPrefix}-messages-skeleton-item`}
                        className="flex items-center gap-[calc(12px*var(--glint-ui-scale,1))] rounded-[18px] border-2 border-transparent bg-white p-[calc(16px*var(--glint-ui-scale,1))]"
                    >
                        <Skeleton className="h-[calc(44px*var(--glint-ui-scale,1))] w-[calc(44px*var(--glint-ui-scale,1))] shrink-0 rounded-[14px] bg-v3-dim-white" />
                        <div data-component={`${dataComponentPrefix}-messages-skeleton-copy`} className="min-w-0 flex-1 space-y-2">
                            <Skeleton className="h-[calc(16px*var(--glint-ui-scale,1))] w-[calc(96px*var(--glint-ui-scale,1))] bg-v3-dim-white" />
                            <Skeleton className="h-[calc(12px*var(--glint-ui-scale,1))] w-[calc(160px*var(--glint-ui-scale,1))] bg-v3-dim-white" />
                            <Skeleton className="h-[calc(12px*var(--glint-ui-scale,1))] w-[calc(208px*var(--glint-ui-scale,1))] bg-v3-dim-white" />
                        </div>
                        <div data-component={`${dataComponentPrefix}-messages-skeleton-meta`} className="ml-auto flex shrink-0 flex-col items-end gap-1">
                            <Skeleton className="h-[calc(24px*var(--glint-ui-scale,1))] w-[calc(56px*var(--glint-ui-scale,1))] rounded-full bg-v3-dim-white" />
                            <Skeleton className="h-[calc(12px*var(--glint-ui-scale,1))] w-[calc(80px*var(--glint-ui-scale,1))] bg-v3-dim-white" />
                        </div>
                    </div>
                ))}
            </div>
        );
    }

    if (isError) {
        return (
            <div data-component={`${dataComponentPrefix}-messages-error`} className="text-center py-12 text-v3-text-muted text-[0.85rem]">
                메시지 발송 내역을 불러오지 못했습니다
            </div>
        );
    }

    if (records.length === 0) {
        return (
            <DetailEmptyState
                name={`${dataComponentPrefix}-messages-empty`}
                message="메시지 발송 내역이 없습니다"
            />
        );
    }

    return (
        <div data-component={`${dataComponentPrefix}-messages-list`}>
            <AnimatedSlotList<MessageLogRecord>
                items={records}
                isLoading={false}
                itemVariant="card"
                itemDataComponent={`${dataComponentPrefix}-messages-list-item`}
                getItemKey={(record) => String(record.id)}
                getSlotState={({ item }) => ({
                    isActive: item?.id === selectedRecordId,
                    isInteractive: Boolean(item),
                })}
                onSlotClick={(record) => onSelectRecord(record)}
                render={({ item: record }) => {
                    if (!record) return null;

                    const normalizedRecord = normalizeMessageHistoryRecord(record, {
                        recipientNameFallback: clientName,
                        recipientListLabelFallback: clientName,
                    });
                    const statusMeta = MESSAGE_HISTORY_STATUS_META[normalizedRecord.status] ?? MESSAGE_HISTORY_STATUS_META.failed;
                    const statusBorderClassName =
                        normalizedRecord.status === "sent"
                            ? "border-[hsl(137,34%,84%)]"
                            : normalizedRecord.status === "pending"
                                ? "border-amber-100"
                                : "border-red-100";
                    const ItemIcon = normalizedRecord.icon;

                    return (
                        <AnimatedSlotListItemContent
                            dataComponent={`${dataComponentPrefix}-messages-list-item`}
                            icon={ItemIcon}
                            iconContainerClassName="text-v3-primary"
                            title={normalizedRecord.title}
                            subtitle={normalizedRecord.messagePreview}
                            status={
                                <div
                                    data-component={`${dataComponentPrefix}-messages-list-item-meta`}
                                    className="flex shrink-0 flex-col items-end justify-end gap-1 text-right"
                                >
                                    <span
                                        data-component={`${dataComponentPrefix}-messages-list-item-status`}
                                        className={cn(
                                            "inline-flex shrink-0 items-center justify-center overflow-hidden rounded-[50px] border px-[calc(12px*var(--glint-ui-scale,1))] py-[calc(4px*var(--glint-ui-scale,1))] text-[calc(10.4px*var(--glint-ui-scale,1))] font-semibold whitespace-nowrap transition-colors",
                                            statusMeta.tone,
                                            statusBorderClassName
                                        )}
                                    >
                                        {MESSAGE_HISTORY_STATUS_LABELS[normalizedRecord.status]}
                                    </span>
                                </div>
                            }
                        />
                    );
                }}
            />
        </div>
    );
}

function ClientContractsList({
    docs,
    isError,
    isLoading,
    dataComponentPrefix,
}: {
    docs: LocalEformsignDocRecord[];
    isError: boolean;
    isLoading: boolean;
    dataComponentPrefix: string;
}) {
    if (isLoading) {
        return (
            <div data-component={`${dataComponentPrefix}-contracts-skeleton-list`} className="space-y-3">
                {[0, 1].map((index) => (
                    <div
                        key={index}
                        data-component={`${dataComponentPrefix}-contracts-skeleton-card`}
                        className="rounded-[18px] bg-v3-dim-white p-[calc(16px*var(--glint-ui-scale,1))]"
                    >
                        <div data-component={`${dataComponentPrefix}-contracts-skeleton-card-head`} className="flex items-center justify-between gap-3">
                            <Skeleton className="h-[calc(14px*var(--glint-ui-scale,1))] w-[calc(112px*var(--glint-ui-scale,1))] bg-white/70" />
                            <Skeleton className="h-[calc(24px*var(--glint-ui-scale,1))] w-[calc(64px*var(--glint-ui-scale,1))] rounded-full bg-white/70" />
                        </div>
                        <div data-component={`${dataComponentPrefix}-contracts-skeleton-card-body`} className="mt-3 space-y-2">
                            <Skeleton className="h-[calc(14px*var(--glint-ui-scale,1))] w-full bg-white/70" />
                            <Skeleton className="h-[calc(14px*var(--glint-ui-scale,1))] w-3/4 bg-white/70" />
                        </div>
                    </div>
                ))}
            </div>
        );
    }

    if (isError && docs.length === 0) {
        return (
            <div data-component={`${dataComponentPrefix}-contracts-error`} className="py-12 text-center text-[0.85rem] text-v3-text-muted">
                계약서 정보를 불러오지 못했습니다
            </div>
        );
    }

    if (docs.length === 0) {
        return (
            <DetailEmptyState
                name={`${dataComponentPrefix}-contracts-empty`}
                message="계약서 정보가 없습니다"
            />
        );
    }

    return (
        <div data-component={`${dataComponentPrefix}-contracts-list`} className="space-y-3">
            {docs.map((doc) => {
                const statusLabel = doc.statusDetail === "검토 필요"
                    ? "검토 필요"
                    : mapStatusToLabel(doc.statusType);
                return (
                    <InfoCard
                        key={doc.documentId}
                        title={doc.stepRecipientName || "계약서"}
                        data-component={`${dataComponentPrefix}-contracts-card`}
                    >
                        <InfoRow
                            label="상태"
                            value={
                                <StatusBadge
                                    status={DOCUMENT_STATUS_BADGE_STATUS[statusLabel]}
                                    label={statusLabel}
                                />
                            }
                        />
                        <InfoRow label="문서 ID" value={doc.documentId} />
                        <InfoRow label="생성일" value={formatDateTime(doc.createdDate)} />
                        <InfoRow label="현재 단계" value={doc.stepName || "-"} />
                        <InfoRow
                            label="수신 연락처"
                            value={doc.stepRecipientSms ? formatKoreanPhoneNumber(doc.stepRecipientSms) : "-"}
                        />
                    </InfoCard>
                );
            })}
        </div>
    );
}

function ClientMessageDetailSlide({
    isMessageDetailActive,
    selectedRecord,
    onBack,
    children,
    dataComponentPrefix,
    messageHistoryDataComponentPrefix,
}: {
    isMessageDetailActive: boolean;
    selectedRecord: MessageHistoryRecord | null;
    onBack: () => void;
    children: ReactNode;
    dataComponentPrefix: string;
    messageHistoryDataComponentPrefix: string;
}) {
    const shouldRenderMessageDetail = selectedRecord !== null;

    return (
        <div
            data-component={`${dataComponentPrefix}-message-slide`}
            data-active-panel={isMessageDetailActive ? "message" : "client"}
            className="h-full min-h-0 overflow-hidden"
        >
            <div
                data-component={`${dataComponentPrefix}-message-slide-track`}
                className={cn(
                    "flex h-full min-h-0 gap-[var(--compact-panel-gap,16px)] transition-transform duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] will-change-transform motion-reduce:transition-none",
                )}
                style={{
                    transform: isMessageDetailActive
                        ? "translateX(calc(-100% - var(--compact-panel-gap, 16px)))"
                        : "translateX(0)",
                }}
            >
                <div
                    data-component={`${dataComponentPrefix}-message-slide-panel`}
                    data-panel="client"
                    aria-hidden={isMessageDetailActive}
                    className={cn("h-full min-h-0 w-full min-w-0 shrink-0", isMessageDetailActive && "pointer-events-none")}
                >
                    {children}
                </div>
                <div
                    data-component={`${dataComponentPrefix}-message-slide-panel`}
                    data-panel="message"
                    aria-hidden={!isMessageDetailActive}
                    className={cn(
                        "h-full min-h-0 w-full min-w-0 shrink-0",
                        !isMessageDetailActive && "pointer-events-none"
                    )}
                >
                    {shouldRenderMessageDetail ? (
                        <MessageHistoryDetailPanel
                            selectedRecord={selectedRecord}
                            backAction={{
                                label: "고객 상세로 돌아가기",
                                onClick: onBack,
                            }}
                            dataComponentPrefix={messageHistoryDataComponentPrefix}
                        />
                    ) : null}
                </div>
            </div>
        </div>
    );
}

export interface ClientDetailPanelProps {
    /** The currently selected client to render detail for. */
    client: Client;
    /** Page-specific trailing action (e.g. edit/delete menu, or a link-only menu). */
    trailing: ReactNode;
    /** Called after a schedule-change request is approved/rejected so the caller can clear its own local client state. */
    onScheduleChangeDecided?: (clientId: number) => void;
    /** Prefix applied to every `data-component` attribute rendered by this panel. */
    dataComponentPrefix?: string;
    /** Prefix forwarded to `MessageHistoryDetailPanel`'s own `dataComponentPrefix`. */
    messageHistoryDataComponentPrefix?: string;
    /** Forwarded to `DetailTabs`/`DetailTabPanels` for stable aria ids. */
    idPrefix?: string;
    /** Forwarded to `DetailTabs`'s `ariaLabel`. */
    tabsAriaLabel?: string;
    /** Forwarded to `DetailPanel`'s `compactBackLabel`. */
    compactBackLabel?: ReactNode;
    /** Forwarded to `DetailTabPanels`'s `className`. */
    tabPanelsClassName?: string;
    /** Forwarded to `DetailTabPanels`'s `trackClassName`. */
    tabPanelsTrackClassName?: string;
    /** Forwarded to `DetailTabPanels`'s `panelClassName`. */
    tabPanelsPanelClassName?: string;
}

function ClientDetailPanelBody({
    client,
    trailing,
    onScheduleChangeDecided,
    dataComponentPrefix = "desktop_clients-detail_panel",
    messageHistoryDataComponentPrefix = "desktop_clients-detail_panel_message-history",
    idPrefix,
    tabsAriaLabel,
    compactBackLabel,
    tabPanelsClassName = "min-h-full shrink-0",
    tabPanelsTrackClassName = "min-h-full",
    tabPanelsPanelClassName = "[&[aria-hidden=false]]:min-h-full",
}: ClientDetailPanelProps) {
    const locale = useLocale();
    const queryClient = useQueryClient();
    const { toast } = useToast();
    const approveScheduleChange = useApproveScheduleChange();
    const rejectScheduleChange = useRejectScheduleChange();

    const [detailTabState, setDetailTabState] = useState<{ key: ClientDetailTabKey; clientId: number | null }>({
        key: "basic",
        clientId: null,
    });
    const [selectedMessageHistoryId, setSelectedMessageHistoryId] = useState<number | string | null>(null);
    const [isMessageHistoryDetailVisible, setIsMessageHistoryDetailVisible] = useState(false);
    const clearMessageHistorySelectionTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const {
        data: messageHistoryData = [],
        isLoading: isMessageHistoryLoading,
        isError: isMessageHistoryError,
    } = useMessageHistory(CLIENT_MESSAGE_HISTORY_LIMIT);

    const clientBadges = useMemo(() => getClientBadges(client), [client]);
    const clientPhoneKey = useMemo(
        () => normalizeKoreanPhoneLookupKey(client.phone ?? ""),
        [client.phone]
    );
    const clientId = client.id;

    const activeScheduleChange = client.pendingScheduleChange ?? null;
    const hasActiveScheduleChange = Boolean(activeScheduleChange);
    const activeClientDetailTabs = useMemo(
        () => hasActiveScheduleChange ? [SCHEDULE_CHANGE_DETAIL_TAB, ...CLIENT_DETAIL_TABS] : [...CLIENT_DETAIL_TABS],
        [hasActiveScheduleChange]
    );

    const activeDetailTab = useMemo<ClientDetailTabKey>(() => {
        if (detailTabState.clientId !== clientId) {
            if (activeScheduleChange) {
                return "schedule-change";
            }

            return detailTabState.key === "schedule-change" ? "basic" : detailTabState.key;
        }

        if (detailTabState.key === "schedule-change" && !hasActiveScheduleChange) {
            return "basic";
        }

        return detailTabState.key;
    }, [activeScheduleChange, clientId, detailTabState, hasActiveScheduleChange]);

    const setActiveDetailTab = (key: ClientDetailTabKey, nextClientId: number | null = clientId) => {
        setDetailTabState({ key, clientId: nextClientId });
    };

    const isScheduleChangeActionPending = approveScheduleChange.isPending || rejectScheduleChange.isPending;
    const serviceRecordsQuery = useClientServiceRecords(clientId, {
        enabled: activeDetailTab === "service-records",
    });

    const {
        data: clientContracts,
        isLoading: isClientContractsLoading,
        isError: isClientContractsError,
        isSuccess: isClientContractsSuccess,
        dataUpdatedAt: clientContractsUpdatedAt,
    } = useQuery({
        queryKey: ["eformsign-docs", "client", clientId],
        queryFn: async () => {
            const documents = await eformsignApi.getDocumentsByClientId(clientId);
            const contractDocuments = documents.filter(
                (document) => document.documentKind !== "service_record_snapshot" && document.documentId,
            );
            const syncResults = await Promise.allSettled(
                contractDocuments.map((document) => withEformsignReauth(
                    () => eformsignApi.syncDocumentStatus(document.documentId),
                )),
            );
            const syncedByDocumentId = new Map(
                syncResults.flatMap((result) => result.status === "fulfilled"
                    ? [[result.value.documentId, result.value] as const]
                    : []),
            );

            return documents.map((document) => {
                const syncedDocument = syncedByDocumentId.get(document.documentId);
                const fallbackDocument = document.documentId === client.eDocId
                    ? getClientDocumentStatusFallback(client.documentStatus)
                    : null;

                return {
                    ...document,
                    ...fallbackDocument,
                    ...syncedDocument,
                };
            });
        },
        staleTime: 0,
        refetchOnMount: "always",
        refetchOnReconnect: true,
        refetchOnWindowFocus: true,
    });

    const clientContractDocs = useMemo(
        () => (clientContracts ?? []).filter((doc) => doc.documentKind !== "service_record_snapshot"),
        [clientContracts],
    );

    useEffect(() => {
        if (!isClientContractsSuccess) {
            return;
        }

        void queryClient.invalidateQueries({ queryKey: clientKeys.all });
        void queryClient.invalidateQueries({ queryKey: clientKeys.detail(clientId) });
    }, [clientContractsUpdatedAt, clientId, isClientContractsSuccess, queryClient]);

    const clientMessageHistory = useMemo(
        () =>
            messageHistoryData
                .filter((record) => matchesMessageHistoryClient(record, client))
                .sort((left, right) => getClientMessageHistoryTime(right) - getClientMessageHistoryTime(left)),
        [client, messageHistoryData]
    );

    const selectedClientMessageRecord = useMemo(
        () =>
            selectedMessageHistoryId === null
                ? null
                : clientMessageHistory.find((record) => record.id === selectedMessageHistoryId) ?? null,
        [clientMessageHistory, selectedMessageHistoryId]
    );

    const selectedClientMessageDetailRecord = useMemo<MessageHistoryRecord | null>(() => {
        if (!selectedClientMessageRecord || activeDetailTab !== "messages") {
            return null;
        }

        return normalizeMessageHistoryRecord(selectedClientMessageRecord, {
            recipientNameFallback: client.name,
            recipientListLabelFallback: client.name,
        });
    }, [activeDetailTab, client.name, selectedClientMessageRecord]);

    useEffect(() => {
        return () => {
            if (clearMessageHistorySelectionTimeoutRef.current) {
                clearTimeout(clearMessageHistorySelectionTimeoutRef.current);
                clearMessageHistorySelectionTimeoutRef.current = null;
            }
        };
    }, []);

    const clearClientMessageHistoryDetail = () => {
        if (clearMessageHistorySelectionTimeoutRef.current) {
            clearTimeout(clearMessageHistorySelectionTimeoutRef.current);
            clearMessageHistorySelectionTimeoutRef.current = null;
        }

        setIsMessageHistoryDetailVisible(false);
        setSelectedMessageHistoryId(null);
    };

    const handleSelectClientMessageHistoryRecord = (record: MessageLogRecord) => {
        if (clearMessageHistorySelectionTimeoutRef.current) {
            clearTimeout(clearMessageHistorySelectionTimeoutRef.current);
            clearMessageHistorySelectionTimeoutRef.current = null;
        }

        setSelectedMessageHistoryId(record.id);
        setIsMessageHistoryDetailVisible(true);
    };

    const handleClientMessageHistoryDetailBack = () => {
        if (clearMessageHistorySelectionTimeoutRef.current) {
            clearTimeout(clearMessageHistorySelectionTimeoutRef.current);
        }

        setIsMessageHistoryDetailVisible(false);
        clearMessageHistorySelectionTimeoutRef.current = setTimeout(() => {
            setSelectedMessageHistoryId(null);
            clearMessageHistorySelectionTimeoutRef.current = null;
        }, CLIENT_MESSAGE_DETAIL_SLIDE_DURATION_MS);
    };

    const handleDetailTabChange = (nextTab: string) => {
        const nextDetailTab = activeClientDetailTabs.find((tab) => tab.key === nextTab)?.key;

        if (!nextDetailTab) return;
        if (nextDetailTab === activeDetailTab) return;

        setActiveDetailTab(nextDetailTab);
        if (nextDetailTab !== "messages") {
            clearClientMessageHistoryDetail();
        }
    };

    const showScheduleChangeErrorToast = (error: unknown, fallbackMessage: string) => {
        toast({
            variant: "destructive",
            description: getScheduleChangeErrorCode(error) === "REQUEST_STALE"
                ? "요청이 최신 상태와 달라 만료되었습니다"
                : fallbackMessage,
        });
    };

    const handleApproveScheduleChange = async () => {
        const pendingScheduleChange = client.pendingScheduleChange;
        if (!pendingScheduleChange) return;

        try {
            await approveScheduleChange.mutateAsync({
                requestId: pendingScheduleChange.id,
                clientId: client.id,
            });
            // The dashboard overview cache uses its own key namespace, and its list row
            // wins over the locally cleared client (clients.find(...) ?? selectedClient),
            // so the decision must invalidate it directly for the badge/tab to clear.
            void queryClient.invalidateQueries({ queryKey: dashboardQueryKeys.overviewAll() });
            onScheduleChangeDecided?.(client.id);
            setActiveDetailTab("basic");
            toast({ description: "일정 변경 요청을 승인했습니다." });
        } catch (error) {
            showScheduleChangeErrorToast(error, "일정 변경 요청 승인 중 오류가 발생했습니다.");
        }
    };

    const handleRejectScheduleChange = async () => {
        const pendingScheduleChange = client.pendingScheduleChange;
        if (!pendingScheduleChange) return;

        try {
            await rejectScheduleChange.mutateAsync({
                requestId: pendingScheduleChange.id,
                clientId: client.id,
            });
            void queryClient.invalidateQueries({ queryKey: dashboardQueryKeys.overviewAll() });
            onScheduleChangeDecided?.(client.id);
            setActiveDetailTab("basic");
            toast({ description: "일정 변경 요청을 거부했습니다." });
        } catch (error) {
            showScheduleChangeErrorToast(error, "일정 변경 요청 거부 중 오류가 발생했습니다.");
        }
    };

    return (
        <ClientMessageDetailSlide
            isMessageDetailActive={isMessageHistoryDetailVisible && selectedClientMessageDetailRecord !== null}
            selectedRecord={selectedClientMessageDetailRecord}
            onBack={handleClientMessageHistoryDetailBack}
            dataComponentPrefix={dataComponentPrefix}
            messageHistoryDataComponentPrefix={messageHistoryDataComponentPrefix}
        >
            <DetailPanel
                data-component={dataComponentPrefix}
                data-source-component="ClientDetailPanel"
                compactBackLabel={compactBackLabel}
                avatar={
                    <div
                        data-component={`${dataComponentPrefix}_header_avatar`}
                        className={cn(
                            "w-16 h-16 rounded-[20px] flex items-center justify-center shadow-lg shrink-0",
                            getClientBadgeAvatarClassName(getPrimaryClientBadge(clientBadges))
                        )}
                    >
                        <Users className="w-7 h-7 shrink-0 transition-colors text-current" aria-hidden="true" />
                    </div>
                }
                title={client.name}
                badges={
                    <>
                        {clientBadges
                            .filter((badge) => badge.key !== "breast_pump")
                            .map((badge) => (
                                <StatusBadge
                                    key={badge.key}
                                    status={badge.status}
                                    label={badge.label}
                                />
                            ))}
                    </>
                }
                badgesRight={
                    <>
                        {clientBadges
                            .filter((badge) => badge.key === "breast_pump")
                            .map((badge) => (
                                <StatusBadge
                                    key={badge.key}
                                    status={badge.status}
                                    label={badge.label}
                                />
                            ))}
                    </>
                }
                subtitle={getClientDetailSubtitle(client)}
                trailing={trailing}
                tabs={
                    <DetailTabs
                        tabs={activeClientDetailTabs}
                        activeTab={activeDetailTab}
                        onTabChange={handleDetailTabChange}
                        ariaLabel={tabsAriaLabel}
                        idPrefix={idPrefix}
                    />
                }
            >
                <DetailTabPanels
                    activeTab={activeDetailTab}
                    dataComponent={`${dataComponentPrefix}_content`}
                    panelDataComponent={`${dataComponentPrefix}_content_panel`}
                    idPrefix={idPrefix}
                    className={tabPanelsClassName}
                    trackClassName={tabPanelsTrackClassName}
                    panelClassName={tabPanelsPanelClassName}
                    panels={[
                        ...(activeScheduleChange
                            ? [
                                {
                                    key: "schedule-change",
                                    children: (
                                        <InfoCard
                                            title="서비스 일정 변경 요청이 있습니다."
                                            data-component={`${dataComponentPrefix}_content_schedule-change_info-card`}
                                        >
                                            <InfoRow
                                                label="기존 날짜"
                                                value={formatScheduleChangeMonthDay(activeScheduleChange.fromDate)}
                                                size="compact"
                                            />
                                            <InfoRow
                                                label="변경 날짜"
                                                value={formatScheduleChangeMonthDay(activeScheduleChange.toDate)}
                                                size="compact"
                                            />
                                            <InfoRow
                                                label="회차"
                                                value={`${activeScheduleChange.sessionIndex}회차`}
                                                size="compact"
                                            />
                                            <InfoRow
                                                label="종료일"
                                                value={`${activeScheduleChange.oldEndDate} → ${activeScheduleChange.newEndDate}`}
                                                size="compact"
                                            />
                                            <div
                                                data-component={`${dataComponentPrefix}_content_schedule-change_info-card_actions`}
                                                className="mt-[calc(14px*var(--glint-ui-scale,1))] flex flex-wrap items-center justify-end gap-[calc(12px*var(--glint-ui-scale,1))]"
                                            >
                                                <Button
                                                    type="button"
                                                    variant="outline"
                                                    size="sm"
                                                    width="sm"
                                                    disabled={isScheduleChangeActionPending}
                                                    onClick={() => void handleRejectScheduleChange()}
                                                >
                                                    거부
                                                </Button>
                                                <Button
                                                    type="button"
                                                    variant="positive"
                                                    size="sm"
                                                    width="sm"
                                                    disabled={isScheduleChangeActionPending}
                                                    onClick={() => void handleApproveScheduleChange()}
                                                >
                                                    승인
                                                </Button>
                                            </div>
                                        </InfoCard>
                                    ),
                                },
                            ]
                            : []),
                        {
                            key: "basic",
                            children: (
                                <div data-component={`${dataComponentPrefix}_content_basic_grid`} className="grid grid-cols-2 gap-4">
                                    <InfoCard data-component={`${dataComponentPrefix}_content_basic_grid_client-card`} title="고객 정보" className="col-start-1 row-start-1 row-end-3">
                                        <InfoRow
                                            label={t(locale, "clients.form.name")}
                                            value={client.name}
                                        />
                                        <InfoRow
                                            label={t(locale, "clients.form.birthday")}
                                            value={formatBirthdayYYMMDD(client.birthday ?? "") || "-"}
                                        />
                                        <InfoRow
                                            label={t(locale, "clients.form.due-date")}
                                            value={formatDate(client.dueDate)}
                                        />
                                        <InfoRow
                                            label={t(locale, "clients.form.phone")}
                                            value={client.phone
                                                ? formatKoreanPhoneNumber(client.phone)
                                                : "-"}
                                        />
                                        <InfoRow
                                            label={t(locale, "clients.form.address")}
                                            value={client.address || "-"}
                                        />
                                    </InfoCard>

                                    <InfoCard data-component={`${dataComponentPrefix}_content_basic_grid_employee-card`} title="담당 관리사" className="col-start-1 row-start-3 row-end-5">
                                        <InfoRow
                                            label={t(locale, "clients.form.primary-employee")}
                                            value={
                                                client.primaryEmployee?.name ??
                                                "-"
                                            }
                                        />
                                        <InfoRow
                                            label={t(locale, "clients.form.primary-employee-phone")}
                                            value={client.primaryEmployee?.phone
                                                ? formatKoreanPhoneNumber(client.primaryEmployee.phone)
                                                : "-"}
                                        />
                                        <InfoRow
                                            label={t(locale, "clients.form.secondary-employee")}
                                            value={
                                                client.secondaryEmployee
                                                    ?.name ?? "-"
                                            }
                                        />
                                        <InfoRow
                                            label={t(locale, "clients.form.secondary-employee-phone")}
                                            value={client.secondaryEmployee?.phone
                                                ? formatKoreanPhoneNumber(client.secondaryEmployee.phone)
                                                : "-"}
                                        />
                                    </InfoCard>

                                    <InfoCard data-component={`${dataComponentPrefix}_content_basic_grid_service-card`} title="서비스 정보" className="col-start-2 row-start-1 row-end-5">
                                        <InfoRow
                                            label={t(locale, "clients.form.voucher-type")}
                                            value={client.type || "-"}
                                        />
                                        <InfoRow
                                            label={t(locale, "clients.form.duration")}
                                            value={
                                                client.duration
                                                    ? `${client.duration}일`
                                                    : "-"
                                            }
                                        />
                                        <InfoRow
                                            label={t(locale, "clients.form.start-date")}
                                            value={formatDate(client.startDate)}
                                        />
                                        <InfoRow
                                            label={t(locale, "clients.form.end-date")}
                                            value={formatDate(client.endDate)}
                                        />
                                        <InfoRow
                                            label={t(locale, "clients.form.full-price")}
                                            value={formatPrice(
                                                client.fullPrice
                                            )}
                                        />
                                        <InfoRow
                                            label={t(locale, "clients.form.grant")}
                                            value={formatPrice(client.grant)}
                                        />
                                        <InfoRow
                                            label={t(locale, "clients.form.actual-price")}
                                            value={formatPrice(
                                                client.actualPrice
                                            )}
                                        />
                                    </InfoCard>
                                </div>
                            ),
                        },
                        {
                            key: "contracts",
                            children: (
                                <ClientContractsList
                                    docs={clientContractDocs}
                                    isLoading={isClientContractsLoading}
                                    isError={isClientContractsError}
                                    dataComponentPrefix={dataComponentPrefix}
                                />
                            ),
                        },
                        {
                            key: "messages",
                            children: (
                                <ClientMessageHistoryList
                                    records={clientMessageHistory}
                                    canLookupMessages={clientId !== null || clientPhoneKey.length > 0}
                                    isLoading={isMessageHistoryLoading}
                                    isError={isMessageHistoryError}
                                    clientName={client.name}
                                    selectedRecordId={selectedMessageHistoryId}
                                    onSelectRecord={handleSelectClientMessageHistoryRecord}
                                    dataComponentPrefix={dataComponentPrefix}
                                />
                            ),
                        },
                        {
                            key: "service-records",
                            children: (
                                <ClientServiceRecordsTab
                                    data-component={`${dataComponentPrefix}_service-records`}
                                    overview={serviceRecordsQuery.data}
                                    clientId={clientId}
                                    isLoading={serviceRecordsQuery.isLoading}
                                    isError={serviceRecordsQuery.isError}
                                    isRefreshing={
                                        serviceRecordsQuery.isFetching
                                        && !serviceRecordsQuery.isLoading
                                    }
                                    onRefresh={() => void serviceRecordsQuery.refetch()}
                                />
                            ),
                        },
                    ]}
                />
            </DetailPanel>
        </ClientMessageDetailSlide>
    );
}

/**
 * Unified client detail panel shared by /clients and /dashboard.
 *
 * Keyed by `client.id` so that switching the selected client always resets
 * internal tab/message-selection state, matching the previous per-page
 * remount-on-select behavior.
 */
export function ClientDetailPanel(props: ClientDetailPanelProps) {
    return <ClientDetailPanelBody key={props.client.id} {...props} />;
}
